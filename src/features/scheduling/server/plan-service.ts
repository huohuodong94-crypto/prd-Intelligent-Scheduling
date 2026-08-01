import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { POSITIONS, SHIFTS, SHIFT_TIMES, type Position, type Shift } from "@/lib/config";
import { mondayOf, toDateStr, weekDays } from "@/lib/dates";
import type { StoreScope } from "@/lib/authorization";
import {
  localDateSchema,
  type RequiredByPosition,
  type SchedulePlanDetail,
  type SchedulePlanSummary,
  type WorkMode,
} from "@/lib/contracts/scheduling";

export class PlanDomainError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PlanDomainError";
  }
}

export class PlanConflictError extends PlanDomainError {
  constructor(message = "该门店本周已存在排班计划") {
    super(message, 409);
    this.name = "PlanConflictError";
  }
}

export function normalizePlanWeek(weekOf: string): string {
  if (!localDateSchema.safeParse(weekOf).success || mondayOf(weekOf) !== weekOf) {
    throw new PlanDomainError("排班计划必须从周一开始", 400);
  }
  return weekOf;
}

function assertManagerMutation(scope: StoreScope, requestedStoreId?: string) {
  if (scope.user.role !== "manager") {
    throw new PlanDomainError("只有店长可以修改排班计划", 403);
  }
  if (scope.user.storeId !== scope.storeId) {
    throw new PlanDomainError("店长只能操作所属门店", 403);
  }
  if (requestedStoreId && requestedStoreId !== scope.storeId) {
    throw new PlanDomainError("无权操作其他门店", 403);
  }
}

function summary(plan: {
  id: string;
  storeId: string;
  weekOf: string;
  mode: string;
  status: string;
  version: number;
  publishedAt: Date | null;
}): SchedulePlanSummary {
  return {
    id: plan.id,
    storeId: plan.storeId,
    weekOf: plan.weekOf,
    mode: plan.mode as WorkMode,
    status: plan.status as SchedulePlanSummary["status"],
    version: plan.version,
    publishedAt: plan.publishedAt?.toISOString() ?? null,
  };
}

export async function listPlans(scope: StoreScope): Promise<SchedulePlanSummary[]> {
  const plans = await prisma.schedulePlan.findMany({
    where: { storeId: scope.storeId },
    orderBy: { weekOf: "desc" },
  });
  return plans.map(summary);
}

export async function createPlan(
  scope: StoreScope,
  input: { storeId?: string; weekOf: string; mode: WorkMode },
): Promise<SchedulePlanSummary> {
  assertManagerMutation(scope, input.storeId);
  const weekOf = normalizePlanWeek(input.weekOf);
  try {
    const plan = await prisma.schedulePlan.create({
      data: {
        storeId: scope.storeId,
        weekOf,
        mode: input.mode,
        status: "draft",
        version: 0,
        createdById: scope.user.id,
      },
    });
    return summary(plan);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new PlanConflictError();
    }
    throw error;
  }
}

export async function getPlanDetail(
  scope: StoreScope,
  id: string,
): Promise<SchedulePlanDetail> {
  const plan = await prisma.schedulePlan.findUnique({ where: { id } });
  if (!plan) throw new PlanDomainError("排班计划不存在", 404);
  if (plan.storeId !== scope.storeId) {
    throw new PlanDomainError("无权访问其他门店的排班计划", 403);
  }

  const days = weekDays(plan.weekOf);
  const weekStart = new Date(`${days[0]}T00:00:00`);
  const weekEnd = new Date(`${days[6]}T23:59:59.999`);
  const [operatingDays, employees, staffing] = await Promise.all([
    prisma.storeOperatingDay.findMany({
      where: { storeId: scope.storeId },
      orderBy: { dayOfWeek: "asc" },
    }),
    prisma.user.findMany({
      where: {
        storeId: scope.storeId,
        role: "employee",
        position: { in: [...POSITIONS] },
        workGroupMemberships: {
          some: {
            effectiveFrom: { lte: weekEnd },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: weekStart } }],
            workGroup: { active: true },
            workArea: { active: true },
          },
        },
      },
      select: {
        id: true,
        name: true,
        storeId: true,
        role: true,
        position: true,
        maxWeeklyHours: true,
        workGroupMemberships: {
          select: {
            effectiveFrom: true,
            effectiveTo: true,
            workGroup: { select: { active: true } },
            workArea: { select: { active: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.minStaffingConfig.findMany({
      where: { storeId: scope.storeId },
      select: { dayOfWeek: true, timeSlot: true, position: true, minHeadcount: true },
    }),
  ]);
  const employeeIds = employees.map((employee) => employee.id);
  const [slots, leaves, schedules] = await Promise.all([
    prisma.unavailableSlot.findMany({
      where: {
        userId: { in: employeeIds },
        date: { gte: weekStart, lte: weekEnd },
      },
      orderBy: [{ date: "asc" }, { timeSlot: "asc" }],
    }),
    prisma.leaveRequest.findMany({
      where: {
        userId: { in: employeeIds },
        status: "approved",
        startTime: { lte: weekEnd },
        endTime: { gte: weekStart },
      },
    }),
    prisma.schedule.findMany({
      where: { planId: plan.id, storeId: scope.storeId },
      orderBy: [{ date: "asc" }, { shiftType: "asc" }],
    }),
  ]);

  const unavailable: SchedulePlanDetail["unavailable"] = slots.map((slot) => ({
    id: slot.id,
    userId: slot.userId,
    date: toDateStr(slot.date),
    timeSlot: slot.timeSlot as Shift,
    reason: slot.reason,
    source: "unavailable",
  }));
  for (const leave of leaves) {
    for (const date of days) {
      for (const shift of SHIFTS) {
        const times = SHIFT_TIMES[shift];
        const shiftStart = new Date(`${date}T00:00:00`);
        shiftStart.setHours(times.start);
        const shiftEnd = new Date(`${date}T00:00:00`);
        shiftEnd.setHours(times.end);
        if (leave.startTime < shiftEnd && leave.endTime > shiftStart) {
          unavailable.push({
            id: `leave:${leave.id}:${date}:${shift}`,
            userId: leave.userId,
            date,
            timeSlot: shift,
            reason: leave.reason,
            source: "approved_leave",
          });
        }
      }
    }
  }

  const openByDay = new Map(operatingDays.map((day) => [day.dayOfWeek, day.isOpen]));
  const requiredByPosition: RequiredByPosition = {};
  for (const row of staffing) {
    if (!SHIFTS.includes(row.timeSlot as Shift) || !POSITIONS.includes(row.position as Position)) {
      continue;
    }
    for (const date of days) {
      const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
      if (dayOfWeek !== row.dayOfWeek || openByDay.get(dayOfWeek) === false) continue;
      requiredByPosition[date] ??= {};
      requiredByPosition[date][row.timeSlot as Shift] ??= {};
      requiredByPosition[date][row.timeSlot as Shift]![row.position as Position] =
        row.minHeadcount;
    }
  }

  return {
    ...summary(plan),
    days,
    operatingDays: operatingDays.map((day) => ({
      dayOfWeek: day.dayOfWeek,
      isOpen: day.isOpen,
      openTime: day.openTime,
      closeTime: day.closeTime,
    })),
    employees: employees.map((employee) => ({
      id: employee.id,
      name: employee.name,
      storeId: employee.storeId!,
      role: "employee",
      position: employee.position as Position,
      maxWeeklyHours: employee.maxWeeklyHours,
      memberships: employee.workGroupMemberships.map((membership) => ({
        effectiveFrom: toDateStr(membership.effectiveFrom),
        effectiveTo: membership.effectiveTo ? toDateStr(membership.effectiveTo) : null,
        workGroupActive: membership.workGroup.active,
        workAreaActive: membership.workArea.active,
      })),
    })),
    approvedLeaves: leaves.map((leave) => ({
      userId: leave.userId,
      status: "approved",
      startTime: leave.startTime.toISOString(),
      endTime: leave.endTime.toISOString(),
    })),
    unavailable,
    requiredByPosition,
    schedules: schedules.map((schedule) => ({
      userId: schedule.userId,
      date: toDateStr(schedule.date),
      shiftType: schedule.shiftType as Shift,
      source: schedule.source,
    })),
  };
}

export async function updatePlanMode(
  scope: StoreScope,
  input: { id: string; mode: WorkMode; version?: number },
): Promise<SchedulePlanSummary> {
  assertManagerMutation(scope);
  const existing = await prisma.schedulePlan.findUnique({ where: { id: input.id } });
  if (!existing) throw new PlanDomainError("排班计划不存在", 404);
  if (existing.storeId !== scope.storeId) {
    throw new PlanDomainError("无权操作其他门店", 403);
  }
  if (existing.status === "published") {
    throw new PlanConflictError("已发布计划不可修改工作制");
  }
  const expectedVersion = input.version ?? existing.version;
  const changed = await prisma.schedulePlan.updateMany({
    where: {
      id: input.id,
      storeId: scope.storeId,
      status: { not: "published" },
      version: expectedVersion,
    },
    data: {
      mode: input.mode,
      status: "draft",
      recommendationJson: null,
      recommendationAiLogId: null,
      version: { increment: 1 },
    },
  });
  if (changed.count !== 1) {
    throw new PlanConflictError("排班计划版本已变化，请刷新后重试");
  }
  return summary(
    await prisma.schedulePlan.findUniqueOrThrow({ where: { id: input.id } }),
  );
}

const INVALIDATED_PLAN_DATA = {
  status: "draft",
  recommendationJson: null,
  recommendationAiLogId: null,
  version: { increment: 1 },
} as const;

export async function mutatePlanInput<T>(
  scope: StoreScope,
  input: { planId: string; version: number },
  mutate: (
    tx: Prisma.TransactionClient,
    plan: { id: string; storeId: string; weekOf: string; version: number },
  ) => Promise<T>,
): Promise<{ result: T; plan: SchedulePlanSummary }> {
  assertManagerMutation(scope);
  return prisma.$transaction(async (tx) => {
    const plan = await tx.schedulePlan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new PlanDomainError("排班计划不存在", 404);
    if (plan.storeId !== scope.storeId) {
      throw new PlanDomainError("无权操作其他门店", 403);
    }
    if (plan.status === "published") {
      throw new PlanConflictError("已发布计划不可修改");
    }
    if (plan.version !== input.version) {
      throw new PlanConflictError("排班计划版本已变化，请刷新后重试");
    }

    const result = await mutate(tx, plan);
    const changed = await tx.schedulePlan.updateMany({
      where: {
        id: plan.id,
        storeId: scope.storeId,
        status: { not: "published" },
        version: input.version,
      },
      data: INVALIDATED_PLAN_DATA,
    });
    if (changed.count !== 1) {
      throw new PlanConflictError("排班计划版本已变化，请刷新后重试");
    }
    return {
      result,
      plan: summary(
        await tx.schedulePlan.findUniqueOrThrow({ where: { id: plan.id } }),
      ),
    };
  });
}

export async function invalidatePlansForDate(
  tx: Prisma.TransactionClient,
  storeId: string,
  date: Date,
) {
  const weekOf = mondayOf(toDateStr(date));
  await tx.schedulePlan.updateMany({
    where: { storeId, weekOf, status: { not: "published" } },
    data: INVALIDATED_PLAN_DATA,
  });
  return tx.schedulePlan.findMany({
    where: { storeId, weekOf, status: { not: "published" } },
    select: { id: true, version: true },
  });
}

export async function saveRecommendation(
  scope: StoreScope,
  input: {
    planId: string;
    version: number;
    recommendation: unknown;
    metric: { provider?: string; model?: string; totalCells: number };
    rawLogs?: {
      parse?: { inputText: string; outputText: string; provider?: string; model?: string };
      explain?: { inputText: string; outputText: string; provider?: string; model?: string };
    };
  },
): Promise<SchedulePlanSummary & { parseLogId?: string; aiLogId?: string }> {
  assertManagerMutation(scope);
  return prisma.$transaction(async (tx) => {
    const plan = await tx.schedulePlan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new PlanDomainError("排班计划不存在", 404);
    if (plan.storeId !== scope.storeId) {
      throw new PlanDomainError("无权操作其他门店", 403);
    }
    if (plan.status === "published") {
      throw new PlanConflictError("已发布计划不可重新生成推荐");
    }
    if (plan.version !== input.version) {
      throw new PlanConflictError("排班计划版本已变化，请刷新后重试");
    }

    const createRawLog = async (payload: {
      inputText: string;
      outputText: string;
      provider?: string;
      model?: string;
    }) =>
      tx.aiInteractionLog.create({
        data: {
          userId: scope.user.id,
          storeId: scope.storeId,
          planId: plan.id,
          feature: "schedule_advisor",
          provider: payload.provider ?? null,
          model: payload.model ?? null,
          inputText: payload.inputText,
          outputText: payload.outputText,
        },
      });
    const parseLog = input.rawLogs?.parse
      ? await createRawLog(input.rawLogs.parse)
      : null;
    const explainLog = input.rawLogs?.explain
      ? await createRawLog(input.rawLogs.explain)
      : null;

    const metric = await tx.aiInteractionLog.create({
      data: {
        userId: scope.user.id,
        storeId: scope.storeId,
        planId: plan.id,
        eventKind: "schedule_plan_metric",
        feature: "schedule_advisor",
        provider: input.metric.provider ?? null,
        model: input.metric.model ?? null,
        inputText: "schedule_plan_metric",
        outputText: JSON.stringify(input.recommendation),
      },
    });
    const changed = await tx.schedulePlan.updateMany({
      where: {
        id: plan.id,
        storeId: scope.storeId,
        status: { not: "published" },
        version: input.version,
      },
      data: {
        recommendationJson: JSON.stringify(input.recommendation),
        recommendationAiLogId: metric.id,
        status: "recommended",
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) {
      throw new PlanConflictError("排班计划版本已变化，请刷新后重试");
    }
    return {
      ...summary(await tx.schedulePlan.findUniqueOrThrow({ where: { id: plan.id } })),
      parseLogId: parseLog?.id,
      aiLogId: explainLog?.id,
    };
  });
}
