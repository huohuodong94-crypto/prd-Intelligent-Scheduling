import { Prisma, type SchedulePlan } from "@prisma/client";

import type { Shift } from "@/lib/config";
import { POSITIONS, SHIFTS } from "@/lib/config";
import type { StoreScope } from "@/lib/authorization";
import {
  assignmentSchema,
  parseScheduleRecommendation,
  type ConstraintIssue,
  type ScheduleAssignment,
  type SchedulePlanSummary,
  type WorkMode,
} from "@/lib/contracts/scheduling";
import { prisma } from "@/lib/db";
import { toDateStr, weekDays } from "@/lib/dates";
import { invalidateMonthlyConfirmations } from "@/features/attendance/server/invalidate-monthly-confirmation";
import {
  parseScheduleWorkbook,
  type ImportEmployee,
} from "./import-parser";
import ExcelJS from "exceljs";

import {
  validateHardConstraints,
  type HardConstraintInput,
} from "./hard-constraints";
import type { RequiredByPosition } from "@/lib/contracts/scheduling";

export class ScheduleCommandError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly issues?: ConstraintIssue[],
  ) {
    super(message);
    this.name = "ScheduleCommandError";
  }
}

function assertManager(scope: StoreScope) {
  if (scope.user.role !== "manager" || scope.user.storeId !== scope.storeId) {
    throw new ScheduleCommandError("只有店长可以修改本店班表", 403, "forbidden");
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

function conflict(message = "排班计划版本已变化，请刷新后重试") {
  return new ScheduleCommandError(message, 409, "version_conflict");
}

async function scopedPlan(
  tx: Prisma.TransactionClient,
  scope: StoreScope,
  planId: string,
) {
  const plan = await tx.schedulePlan.findUnique({ where: { id: planId } });
  if (!plan) throw new ScheduleCommandError("排班计划不存在", 404, "plan_not_found");
  if (plan.storeId !== scope.storeId) {
    throw new ScheduleCommandError("无权操作其他门店的排班计划", 403, "cross_store");
  }
  if (plan.status === "published") throw conflict("已发布计划不可修改");
  return plan;
}

async function constraintInput(
  tx: Prisma.TransactionClient,
  plan: SchedulePlan,
  assignments: ScheduleAssignment[],
): Promise<HardConstraintInput> {
  const days = weekDays(plan.weekOf);
  const weekStart = new Date(`${days[0]}T00:00:00`);
  const weekEnd = new Date(`${days[6]}T23:59:59.999`);
  const userIds = [...new Set(assignments.map((assignment) => assignment.userId))];
  const [employees, leaves, unavailable, staffing, operatingDays] = await Promise.all([
    tx.user.findMany({
      where: { id: { in: userIds } },
      include: {
        workGroupMemberships: {
          include: {
            workGroup: { select: { active: true } },
            workArea: { select: { active: true } },
          },
        },
      },
    }),
    tx.leaveRequest.findMany({
      where: {
        userId: { in: userIds },
        status: "approved",
        startTime: { lte: weekEnd },
        endTime: { gte: weekStart },
      },
    }),
    tx.unavailableSlot.findMany({
      where: {
        userId: { in: userIds },
        date: { gte: weekStart, lte: weekEnd },
      },
    }),
    tx.minStaffingConfig.findMany({ where: { storeId: plan.storeId } }),
    tx.storeOperatingDay.findMany({
      where: { storeId: plan.storeId },
      select: { dayOfWeek: true, isOpen: true },
    }),
  ]);
  const openByDay = new Map(operatingDays.map((day) => [day.dayOfWeek, day.isOpen]));
  const closedDates = new Set(
    days.filter(
      (date) => openByDay.get(new Date(`${date}T00:00:00`).getDay()) === false,
    ),
  );
  const requiredByPosition: RequiredByPosition = {};
  for (const row of staffing) {
    if (!SHIFTS.includes(row.timeSlot as Shift) || !POSITIONS.includes(row.position as never)) {
      continue;
    }
    for (const date of days) {
      if (closedDates.has(date)) continue;
      if (new Date(`${date}T00:00:00`).getDay() !== row.dayOfWeek) continue;
      requiredByPosition[date] ??= {};
      requiredByPosition[date][row.timeSlot as Shift] ??= {};
      requiredByPosition[date][row.timeSlot as Shift]![row.position as "cashier" | "sales"] =
        row.minHeadcount;
    }
  }
  return {
    storeId: plan.storeId,
    planId: plan.id,
    weekOf: plan.weekOf,
    mode: plan.mode as WorkMode,
    employees: employees.map((employee) => ({
      id: employee.id,
      storeId: employee.storeId,
      role: employee.role,
      position: employee.position,
      maxWeeklyHours: employee.maxWeeklyHours,
      memberships: employee.workGroupMemberships.map((membership) => ({
        effectiveFrom: toDateStr(membership.effectiveFrom),
        effectiveTo: membership.effectiveTo ? toDateStr(membership.effectiveTo) : null,
        workGroupActive: membership.workGroup.active,
        workAreaActive: membership.workArea.active,
      })),
    })),
    assignments,
    leaves: leaves.map((leave) => ({
      userId: leave.userId,
      status: leave.status,
      startTime: leave.startTime,
      endTime: leave.endTime,
    })),
    unavailable: [
      ...unavailable.map((slot) => ({
        userId: slot.userId,
        date: toDateStr(slot.date),
        shiftType: slot.timeSlot,
      })),
      ...assignments
        .filter((assignment) => closedDates.has(assignment.date))
        .map((assignment) => ({
          userId: assignment.userId,
          date: assignment.date,
          shiftType: assignment.shiftType,
        })),
    ],
    requiredByPosition,
  };
}

async function validateCandidate(
  tx: Prisma.TransactionClient,
  plan: SchedulePlan,
  assignments: ScheduleAssignment[],
) {
  const input = await constraintInput(tx, plan, assignments);
  const issues = validateHardConstraints(input);
  if (issues.length > 0) {
    const knownForeignEmployee = input.employees.some(
      (employee) => employee.storeId !== null && employee.storeId !== plan.storeId,
    );
    if (knownForeignEmployee) {
      throw new ScheduleCommandError(
        "不得为其他门店员工排班",
        403,
        "cross_store",
        issues,
      );
    }
    throw new ScheduleCommandError("班表不满足硬约束", 422, "hard_constraints", issues);
  }
}

async function replaceSchedules(
  tx: Prisma.TransactionClient,
  plan: SchedulePlan,
  assignments: ScheduleAssignment[],
  source: "manual" | "ai_generated",
) {
  await tx.schedule.deleteMany({ where: { planId: plan.id } });
  for (const assignment of assignments) {
    await tx.schedule.create({
      data: {
        storeId: plan.storeId,
        planId: plan.id,
        userId: assignment.userId,
        date: new Date(`${assignment.date}T00:00:00`),
        shiftType: assignment.shiftType,
        weekOf: plan.weekOf,
        source,
      },
    });
  }
}

export type ScheduleWriter = {
  replaceAssignments: (assignments: ScheduleAssignment[]) => Promise<void>;
};

export type ScheduleWriterFactory = (
  tx: Prisma.TransactionClient,
  plan: SchedulePlan,
) => ScheduleWriter;

function prismaScheduleWriter(
  tx: Prisma.TransactionClient,
  plan: SchedulePlan,
): ScheduleWriter {
  return {
    replaceAssignments: (assignments) => replaceSchedules(tx, plan, assignments, "manual"),
  };
}

export function e2eImportFailureRow(fileName: string): number | null {
  return process.env.WFM_E2E_IMPORT_FAILURES === "1" && fileName === "rollback-fixture.xlsx"
    ? 2
    : null;
}

export function createFailingScheduleWriterFactory(failureRow: number): ScheduleWriterFactory {
  return (tx, plan) => ({
    async replaceAssignments(assignments) {
      await tx.schedule.deleteMany({ where: { planId: plan.id } });
      for (const [index, assignment] of assignments.entries()) {
        if (index + 1 === failureRow) {
          throw new ScheduleCommandError("测试导入写入失败", 500, "e2e_import_failure");
        }
        await tx.schedule.create({
          data: {
            storeId: plan.storeId,
            planId: plan.id,
            userId: assignment.userId,
            date: new Date(`${assignment.date}T00:00:00`),
            shiftType: assignment.shiftType,
            weekOf: plan.weekOf,
            source: "manual",
          },
        });
      }
    },
  });
}

async function casPlan(
  tx: Prisma.TransactionClient,
  plan: SchedulePlan,
  version: number,
  data: Prisma.SchedulePlanUpdateManyMutationInput,
) {
  const changed = await tx.schedulePlan.updateMany({
    where: {
      id: plan.id,
      storeId: plan.storeId,
      version,
      status: { in: ["draft", "recommended"] },
    },
    data: { ...data, version: { increment: 1 } },
  });
  if (changed.count !== 1) throw conflict();
}

export function computeRecommendationMetric(
  recommendation: ScheduleAssignment[],
  published: ScheduleAssignment[],
) {
  const key = (assignment: ScheduleAssignment) =>
    `${assignment.userId}\u0000${assignment.date}\u0000${assignment.shiftType}`;
  const recommended = new Set(recommendation.map(key));
  const final = new Set(published.map(key));
  const union = new Set([...recommended, ...final]);
  let editedCells = 0;
  for (const value of union) {
    if (recommended.has(value) !== final.has(value)) editedCells += 1;
  }
  const totalCells = union.size;
  return {
    wasAccepted: true as const,
    wasEdited: editedCells > 0,
    editedCells,
    totalCells,
    editRatio: totalCells === 0 ? null : editedCells / totalCells,
  };
}

export async function saveDraft(
  scope: StoreScope,
  input: {
    planId: string;
    version: number;
    assignments: ScheduleAssignment[];
    source: "manual" | "ai_generated";
  },
) {
  assertManager(scope);
  return prisma.$transaction(async (tx) => {
    const plan = await scopedPlan(tx, scope, input.planId);
    if (plan.version !== input.version) throw conflict();
    await validateCandidate(tx, plan, input.assignments);
    await casPlan(tx, plan, input.version, {
      status: input.source === "ai_generated" ? "recommended" : "draft",
      publishedAt: null,
    });
    await replaceSchedules(tx, plan, input.assignments, input.source);
    const updated = await tx.schedulePlan.findUniqueOrThrow({ where: { id: plan.id } });
    return { saved: input.assignments.length, plan: summary(updated) };
  });
}

async function recordPublishMetric(
  tx: Prisma.TransactionClient,
  plan: SchedulePlan,
  assignments: ScheduleAssignment[],
) {
  const recommendation = parseScheduleRecommendation(plan.recommendationJson);
  const canonical = plan.recommendationAiLogId
    ? await tx.aiInteractionLog.findUnique({ where: { id: plan.recommendationAiLogId } })
    : null;
  if (
    recommendation &&
    canonical &&
    canonical.eventKind === "schedule_plan_metric" &&
    canonical.storeId === plan.storeId &&
    canonical.planId === plan.id
  ) {
    const metric = computeRecommendationMetric(recommendation.assignments, assignments);
    await tx.aiInteractionLog.update({ where: { id: canonical.id }, data: metric });
    return { status: "recorded" as const, ...metric };
  }
  const reason = !recommendation
    ? "canonical_recommendation_missing_or_invalid"
    : "canonical_metric_pointer_missing_or_invalid";
  await tx.aiInteractionLog.create({
    data: {
      userId: plan.createdById,
      storeId: plan.storeId,
      planId: plan.id,
      eventKind: "schedule_metric_missing",
      feature: "schedule_advisor",
      inputText: "schedule_publish",
      outputText: JSON.stringify({ reason }),
    },
  });
  return { status: "missing" as const, reason };
}

function changedPublishedAssignmentPairs(
  before: ScheduleAssignment[],
  after: ScheduleAssignment[],
) {
  const key = (assignment: ScheduleAssignment) =>
    `${assignment.userId}\u0000${assignment.date}\u0000${assignment.shiftType}`;
  const beforeFacts = new Map(before.map((assignment) => [key(assignment), assignment]));
  const afterFacts = new Map(after.map((assignment) => [key(assignment), assignment]));
  const pairs = new Map<string, { userId: string; localDate: string }>();
  for (const factKey of new Set([...beforeFacts.keys(), ...afterFacts.keys()])) {
    if (beforeFacts.has(factKey) === afterFacts.has(factKey)) continue;
    const assignment = beforeFacts.get(factKey) ?? afterFacts.get(factKey)!;
    pairs.set(`${assignment.userId}\u0000${assignment.date}`, {
      userId: assignment.userId,
      localDate: assignment.date,
    });
  }
  return [...pairs.values()];
}

export async function publishScheduleInTransaction(
  tx: Prisma.TransactionClient,
  scope: StoreScope,
  input: { planId: string; version: number; assignments: ScheduleAssignment[] },
) {
  assertManager(scope);
  const plan = await scopedPlan(tx, scope, input.planId);
  if (plan.version !== input.version) throw conflict();
  await validateCandidate(tx, plan, input.assignments);
  const metric = await recordPublishMetric(tx, plan, input.assignments);
  const beforePublished: ScheduleAssignment[] = [];
  await casPlan(tx, plan, input.version, {
    status: "published",
    publishedAt: new Date(),
  });
  await replaceSchedules(tx, plan, input.assignments, "manual");
  const changedPairs = changedPublishedAssignmentPairs(beforePublished, input.assignments);
  if (changedPairs.length) {
    await invalidateMonthlyConfirmations(tx, {
      storeId: scope.storeId,
      changes: changedPairs.map((pair) => ({
        ...pair,
        reason: "schedule_changed" as const,
        actorId: scope.user.id,
        sourceRef: `schedule-plan:${plan.id}`,
      })),
    });
  }
  const updated = await tx.schedulePlan.findUniqueOrThrow({ where: { id: plan.id } });
  return { published: input.assignments.length, plan: summary(updated), metric };
}

export async function publishSchedule(
  scope: StoreScope,
  input: { planId: string; version: number; assignments: ScheduleAssignment[] },
) {
  assertManager(scope);
  return prisma.$transaction((tx) => publishScheduleInTransaction(tx, scope, input));
}

export async function copyHistory(
  scope: StoreScope,
  input: { planId: string; sourcePlanId: string; version: number },
) {
  assertManager(scope);
  return prisma.$transaction(async (tx) => {
    const target = await scopedPlan(tx, scope, input.planId);
    if (target.version !== input.version) throw conflict();
    const source = await tx.schedulePlan.findUnique({
      where: { id: input.sourcePlanId },
      include: { schedules: true },
    });
    if (!source) throw new ScheduleCommandError("历史班表不存在", 404, "source_not_found");
    if (source.storeId !== scope.storeId) {
      throw new ScheduleCommandError("不得复制其他门店班表", 403, "cross_store");
    }
    if (source.status !== "published") {
      throw new ScheduleCommandError("只能复制已发布班表", 409, "source_not_published");
    }
    const sourceDays = weekDays(source.weekOf);
    const targetDays = weekDays(target.weekOf);
    const assignments = source.schedules.map((row) => {
      const index = sourceDays.indexOf(toDateStr(row.date));
      if (index < 0) {
        throw new ScheduleCommandError("历史班表包含跨周数据", 422, "week_range");
      }
      return assignmentSchema.parse({
        userId: row.userId,
        date: targetDays[index],
        shiftType: row.shiftType,
      });
    });
    await validateCandidate(tx, target, assignments);
    await casPlan(tx, target, input.version, { status: "draft", publishedAt: null });
    await replaceSchedules(tx, target, assignments, "manual");
    const updated = await tx.schedulePlan.findUniqueOrThrow({ where: { id: target.id } });
    return { copied: assignments.length, plan: summary(updated) };
  });
}

export async function restoreRecommendation(
  scope: StoreScope,
  input: { planId: string; version: number },
) {
  assertManager(scope);
  return prisma.$transaction(async (tx) => {
    const plan = await scopedPlan(tx, scope, input.planId);
    if (plan.version !== input.version) throw conflict();
    const recommendation = parseScheduleRecommendation(plan.recommendationJson);
    if (!recommendation) {
      throw new ScheduleCommandError("服务端推荐不存在或已损坏", 409, "recommendation_missing");
    }
    await validateCandidate(tx, plan, recommendation.assignments);
    await casPlan(tx, plan, input.version, { status: "recommended", publishedAt: null });
    await replaceSchedules(tx, plan, recommendation.assignments, "ai_generated");
    const updated = await tx.schedulePlan.findUniqueOrThrow({ where: { id: plan.id } });
    return {
      restored: recommendation.assignments.length,
      assignments: recommendation.assignments,
      plan: summary(updated),
    };
  });
}

export async function commitImport(
  scope: StoreScope,
  input: { batchId: string; version: number },
  writerFactory?: ScheduleWriterFactory,
) {
  assertManager(scope);
  const initial = await prisma.scheduleImportBatch.findUnique({ where: { id: input.batchId } });
  if (!initial) throw new ScheduleCommandError("导入批次不存在", 404, "batch_not_found");
  if (initial.storeId !== scope.storeId) {
    throw new ScheduleCommandError("无权访问其他门店导入批次", 403, "cross_store");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const batch = await tx.scheduleImportBatch.findUniqueOrThrow({
        where: { id: input.batchId },
      });
      if (batch.status !== "validated" || batch.errorRows !== 0) {
        throw new ScheduleCommandError("导入批次不可应用", 409, "batch_not_importable");
      }
      const plan = await scopedPlan(tx, scope, batch.planId);
      if (
        input.version !== batch.validatedVersion ||
        plan.version !== batch.validatedVersion
      ) {
        throw conflict("导入批次基于旧版本，请重新校验文件");
      }
      const parsed = assignmentSchema.array().safeParse(JSON.parse(batch.normalizedRowsJson));
      if (!parsed.success) {
        throw new ScheduleCommandError("导入快照已损坏", 409, "snapshot_invalid");
      }
      await validateCandidate(tx, plan, parsed.data);
      await casPlan(tx, plan, input.version, { status: "draft", publishedAt: null });
      const writer = (writerFactory ?? prismaScheduleWriter)(tx, plan);
      await writer.replaceAssignments(parsed.data);
      await tx.scheduleImportBatch.update({
        where: { id: batch.id },
        data: { status: "imported" },
      });
      const updated = await tx.schedulePlan.findUniqueOrThrow({ where: { id: plan.id } });
      return { imported: parsed.data.length, plan: summary(updated) };
    });
  } catch (caught) {
    await markImportFailedIfValidated(
      input.batchId,
      scope.storeId,
      caught instanceof Error ? caught.message : "导入应用失败",
    );
    throw caught;
  }
}

export async function markImportFailedIfValidated(
  id: string,
  storeId: string,
  message: string,
) {
  const changed = await prisma.scheduleImportBatch.updateMany({
    where: { id, storeId, status: "validated" },
    data: {
      status: "failed",
      errorsJson: JSON.stringify([
        {
          severity: "error",
          row: 0,
          column: "应用",
          value: "",
          code: "apply_failed",
          suggestion: message,
        },
      ]),
    },
  });
  return changed.count;
}

export async function validateImportFile(
  scope: StoreScope,
  input: {
    planId: string;
    version: number;
    fileName: string;
    buffer: Buffer;
  },
) {
  assertManager(scope);
  return prisma.$transaction(async (tx) => {
    const plan = await scopedPlan(tx, scope, input.planId);
    if (plan.version !== input.version) throw conflict();
    const rows = await tx.user.findMany({
      where: {
        storeId: scope.storeId,
        role: "employee",
        employeeNo: { not: null },
        position: { in: [...POSITIONS] },
      },
      select: { id: true, employeeNo: true, name: true, position: true },
      orderBy: { employeeNo: "asc" },
    });
    const employees = rows.map((row) => ({
      id: row.id,
      employeeNo: row.employeeNo!,
      name: row.name,
      position: row.position as ImportEmployee["position"],
    }));
    const parsed = await parseScheduleWorkbook(input.buffer, plan.weekOf, employees);
    if (parsed.errors.length === 0) {
      const constraintIssues = validateHardConstraints(
        await constraintInput(tx, plan, parsed.assignments),
      );
      for (const issue of constraintIssues) {
        parsed.errors.push({
          severity: "error",
          row: 0,
          column: issue.date ?? "班表",
          value: issue.userId ?? "",
          code: issue.code,
          suggestion: issue.message,
        });
      }
      if (constraintIssues.length > 0) parsed.errorRows = Math.max(1, parsed.errorRows);
    }
    const batch = await tx.scheduleImportBatch.create({
      data: {
        storeId: scope.storeId,
        planId: plan.id,
        fileName: input.fileName,
        status: "validated",
        validatedVersion: input.version,
        totalRows: parsed.totalRows,
        successRows: parsed.successRows,
        errorRows: parsed.errorRows,
        errorsJson: JSON.stringify(parsed.errors),
        normalizedRowsJson: JSON.stringify(parsed.normalizedRows),
        createdById: scope.user.id,
      },
    });
    return {
      batchId: batch.id,
      importable: parsed.errors.length === 0 ? parsed.successRows : 0,
      totalRows: parsed.totalRows,
      successRows: parsed.successRows,
      errorRows: parsed.errorRows,
      warnings: parsed.warnings,
      errors: parsed.errors,
    };
  });
}

export async function exportScheduleWorkbook(scope: StoreScope, planId: string) {
  const plan = await prisma.schedulePlan.findUnique({
    where: { id: planId },
    include: {
      schedules: true,
      store: {
        include: {
          users: {
            where: {
              role: "employee",
              employeeNo: { not: null },
              position: { in: [...POSITIONS] },
            },
            orderBy: { employeeNo: "asc" },
          },
        },
      },
    },
  });
  if (!plan) throw new ScheduleCommandError("排班计划不存在", 404, "plan_not_found");
  if (plan.storeId !== scope.storeId) {
    throw new ScheduleCommandError("无权导出其他门店班表", 403, "cross_store");
  }
  const dates = weekDays(plan.weekOf);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("班表");
  sheet.addRow(["员工工号", "姓名", "岗位", ...dates, "周工时"]);
  for (const employee of plan.store.users) {
    const values = dates.map((date) => {
      const shifts = plan.schedules
        .filter((row) => row.userId === employee.id && toDateStr(row.date) === date)
        .map((row) => row.shiftType as Shift)
        .sort((left, right) => SHIFTS.indexOf(left) - SHIFTS.indexOf(right));
      const labels: Record<Shift, string> = {
        morning: "早班",
        afternoon: "午班",
        evening: "晚班",
      };
      return shifts.map((shift) => labels[shift]).join("+");
    });
    const hours = plan.schedules.filter((row) => row.userId === employee.id).length * 4;
    sheet.addRow([employee.employeeNo, employee.name, employee.position, ...values, hours]);
  }
  sheet.views = [{ state: "frozen", xSplit: 3, ySplit: 1 }];
  sheet.getRow(1).font = { bold: true };
  sheet.columns = [
    { width: 16 },
    { width: 16 },
    { width: 12 },
    ...dates.map(() => ({ width: 15 })),
    { width: 10 },
  ];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
