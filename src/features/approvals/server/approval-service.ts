import { Prisma, type SchedulePlan } from "@prisma/client";

import type { SessionUser } from "@/lib/auth";
import type { StoreScope } from "@/lib/authorization";
import {
  approvalDecisionSchema,
  createPunchCorrectionSchema,
  createShiftSwapSchema,
  type AiAdvice,
  type ApprovalDecisionInput,
  type ApprovalIdentity,
  type ApprovalItem,
  type ApprovalQuery,
  type ApprovalType,
  type CreatePunchCorrectionInput,
  type CreateShiftSwapInput,
  type NormalizedApprovalDecisionInput,
} from "@/lib/contracts/approvals";
import type {
  RequiredByPosition,
  ScheduleAssignment,
  WorkMode,
} from "@/lib/contracts/scheduling";
import { proxyAttendanceRequestSchema, type ProxyAttendanceRequest } from "@/lib/contracts/attendance";
import type { MonthlyInvalidationChange } from "@/lib/contracts/monthly-attendance";
import { POSITIONS, SHIFTS, type Position, type Shift } from "@/lib/config";
import { prisma } from "@/lib/db";
import {
  AttendanceServiceError,
  recalculateDailyAttendanceInTransaction,
  syncAttendancePunchStateFromLatest,
} from "@/features/attendance/server/attendance-service";
import { toDateStr, weekDays } from "@/lib/dates";
import { validateHardConstraints } from "@/features/scheduling/server/hard-constraints";
import { invalidateMonthlyConfirmations } from "@/features/attendance/server/invalidate-monthly-confirmation";

export class ApprovalServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApprovalServiceError";
  }
}

const pendingStatus: Record<ApprovalType, string> = {
  leave: "pending",
  punch_correction: "pending",
  shift_swap: "pending_manager",
};

function failValidation(error: { issues: Array<{ message: string }> }): never {
  throw new ApprovalServiceError(error.issues[0]?.message ?? "参数错误", 400, "invalid_input");
}

export function normalizeDecision(input: ApprovalDecisionInput): NormalizedApprovalDecisionInput {
  const parsed = approvalDecisionSchema.safeParse(input);
  if (!parsed.success) failValidation(parsed.error);
  const seen = new Set<string>();
  return {
    ...parsed.data,
    items: parsed.data.items.filter((item) => {
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

export function normalizeManagerStatus(type: ApprovalType, status: string) {
  if (status === pendingStatus[type]) return "pending" as const;
  if (status === "approved" || status === "rejected") return status;
  return null;
}

export function normalizeAiAdvice(raw: unknown): AiAdvice {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (
      value &&
      typeof value === "object" &&
      (value as { suggestion?: unknown }).suggestion &&
      ["compliant", "suspicious"].includes(
        String((value as { suggestion: unknown }).suggestion),
      ) &&
      typeof (value as { reason?: unknown }).reason === "string"
    ) {
      return {
        suggestion: (value as AiAdvice).suggestion,
        reason: (value as AiAdvice).reason.trim().slice(0, 500) || "模型未提供理由，建议人工核实。",
      };
    }
  } catch {
    // Safe fallback below.
  }
  return { suggestion: "suspicious", reason: "AI 输出无效，建议经理人工核实。" };
}

export async function requestAiAdvice(input: {
  generate: (prompt: string) => Promise<string>;
  prompt: string;
  decide?: (...args: never[]) => unknown;
}) {
  return normalizeAiAdvice(await input.generate(input.prompt));
}

function assertManager(scope: StoreScope) {
  if (scope.user.role !== "manager" || scope.user.storeId !== scope.storeId) {
    throw new ApprovalServiceError("只有店长可以处理本店审批", 403, "forbidden");
  }
}

function assertEmployee(user: SessionUser) {
  if (user.role !== "employee" || !user.storeId) {
    throw new ApprovalServiceError("只有员工可以提交本人申请", 403, "forbidden");
  }
}

function calculateProxyLeaveHours(start: Date, end: Date, isFullDay: boolean) {
  if (end.getTime() < start.getTime()) throw new ApprovalServiceError("结束时间不能早于开始时间", 400, "invalid_range");
  if (isFullDay) {
    const startDate = new Date(`${localDate(start)}T00:00:00+08:00`).getTime();
    const endDate = new Date(`${localDate(end)}T00:00:00+08:00`).getTime();
    return Math.floor((endDate - startDate) / 86_400_000 + 1) * 8;
  }
  return Math.round(((end.getTime() - start.getTime()) / 3_600_000) * 10) / 10;
}

function localDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

type LoadedApproval =
  | { type: "leave"; id: string; storeId: string; status: string; row: any }
  | { type: "punch_correction"; id: string; storeId: string; status: string; row: any }
  | { type: "shift_swap"; id: string; storeId: string; status: string; row: any };

function addAffectedDate(target: Map<string, Set<string>>, date: string, userId: string) {
  const users = target.get(date) ?? new Set<string>();
  users.add(userId);
  target.set(date, users);
}

function addAffectedDateRange(target: Map<string, Set<string>>, start: Date, end: Date, userId: string) {
  if (end.getTime() <= start.getTime()) return;
  const first = new Date(`${localDate(start)}T00:00:00+08:00`).getTime();
  for (let time = first; time < end.getTime(); time += 86_400_000) {
    addAffectedDate(target, localDate(new Date(time)), userId);
  }
}

function affectedAttendanceDates(items: LoadedApproval[]) {
  const affected = new Map<string, Set<string>>();
  for (const item of items) {
    if (item.type === "leave") addAffectedDateRange(affected, item.row.startTime, item.row.endTime, item.row.userId);
    else if (item.type === "punch_correction") addAffectedDate(affected, localDate(item.row.requestedTime), item.row.userId);
    else {
      for (const date of [localDate(item.row.reqSchedule.date), localDate(item.row.tgtSchedule.date)]) {
        addAffectedDate(affected, date, item.row.requesterId);
        addAffectedDate(affected, date, item.row.targetUserId);
      }
    }
  }
  return affected;
}

function approvalMonthlyInvalidationChanges(
  items: LoadedApproval[],
  actorId: string,
): MonthlyInvalidationChange[] {
  const changes: MonthlyInvalidationChange[] = [];
  for (const item of items) {
    if (item.type === "leave") {
      const dates = new Map<string, Set<string>>();
      addAffectedDateRange(dates, item.row.startTime, item.row.endTime, item.row.userId);
      for (const localDate of dates.keys()) {
        changes.push({
          userId: item.row.userId,
          localDate,
          reason: "leave_approval_changed",
          actorId,
          sourceRef: `leave:${item.id}`,
        });
      }
    } else if (item.type === "punch_correction") {
      changes.push({
        userId: item.row.userId,
        localDate: localDate(item.row.requestedTime),
        reason: "correction_approval_changed",
        actorId,
        sourceRef: `correction:${item.id}`,
      });
    } else {
      const localDates = [localDate(item.row.reqSchedule.date), localDate(item.row.tgtSchedule.date)];
      for (const date of localDates) for (const userId of [item.row.requesterId, item.row.targetUserId]) {
        changes.push({
          userId,
          localDate: date,
          reason: "shift_swap_approved",
          actorId,
          sourceRef: `shift-swap:${item.id}`,
        });
      }
    }
  }
  return changes;
}

async function loadApproval(tx: Prisma.TransactionClient, item: ApprovalIdentity): Promise<LoadedApproval> {
  if (item.type === "leave") {
    const row = await tx.leaveRequest.findUnique({ where: { id: item.id }, include: { user: true } });
    if (!row || !row.user.storeId) throw new ApprovalServiceError("审批单不存在", 404, "not_found");
    return { type: item.type, id: row.id, storeId: row.user.storeId, status: row.status, row };
  }
  if (item.type === "punch_correction") {
    const row = await tx.punchCorrection.findUnique({ where: { id: item.id }, include: { user: true } });
    if (!row || !row.user.storeId) throw new ApprovalServiceError("审批单不存在", 404, "not_found");
    return { type: item.type, id: row.id, storeId: row.user.storeId, status: row.status, row };
  }
  const row = await tx.shiftSwapRequest.findUnique({
    where: { id: item.id },
    include: {
      requester: true,
      targetUser: true,
      reqSchedule: { include: { plan: true } },
      tgtSchedule: { include: { plan: true } },
    },
  });
  if (!row || !row.reqSchedule.storeId) throw new ApprovalServiceError("审批单不存在", 404, "not_found");
  return { type: item.type, id: row.id, storeId: row.reqSchedule.storeId, status: row.status, row };
}

function loggedSuggestion(outputText: string): AiAdvice["suggestion"] | null {
  try {
    const value = JSON.parse(outputText) as { suggestion?: unknown; reason?: unknown };
    if (
      value &&
      typeof value === "object" &&
      (value.suggestion === "compliant" || value.suggestion === "suspicious") &&
      typeof value.reason === "string"
    ) {
      return value.suggestion;
    }
  } catch {
    // Invalid historical evidence is rejected before any decision side effect.
  }
  return null;
}

async function constraintInput(
  tx: Prisma.TransactionClient,
  plan: SchedulePlan,
  assignments: ScheduleAssignment[],
) {
  const days = weekDays(plan.weekOf);
  const start = new Date(`${days[0]}T00:00:00+08:00`);
  const end = new Date(`${days[6]}T23:59:59.999+08:00`);
  const userIds = [...new Set(assignments.map((row) => row.userId))];
  const [employees, leaves, unavailable, staffing, operatingDays] = await Promise.all([
    tx.user.findMany({
      where: { id: { in: userIds } },
      include: { workGroupMemberships: { include: { workGroup: { select: { active: true } }, workArea: { select: { active: true } } } } },
    }),
    tx.leaveRequest.findMany({ where: { userId: { in: userIds }, status: "approved", startTime: { lte: end }, endTime: { gte: start } } }),
    tx.unavailableSlot.findMany({ where: { userId: { in: userIds }, date: { gte: start, lte: end } } }),
    tx.minStaffingConfig.findMany({ where: { storeId: plan.storeId } }),
    tx.storeOperatingDay.findMany({ where: { storeId: plan.storeId }, select: { dayOfWeek: true, isOpen: true } }),
  ]);
  const openByDay = new Map(operatingDays.map((row) => [row.dayOfWeek, row.isOpen]));
  const closedDates = new Set(days.filter((date) => openByDay.get(new Date(`${date}T00:00:00+08:00`).getDay()) === false));
  const requiredByPosition: RequiredByPosition = {};
  for (const row of staffing) {
    if (!SHIFTS.includes(row.timeSlot as Shift) || !POSITIONS.includes(row.position as Position)) continue;
    for (const date of days) {
      if (closedDates.has(date) || new Date(`${date}T00:00:00+08:00`).getDay() !== row.dayOfWeek) continue;
      requiredByPosition[date] ??= {};
      requiredByPosition[date][row.timeSlot as Shift] ??= {};
      requiredByPosition[date][row.timeSlot as Shift]![row.position as Position] = row.minHeadcount;
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
    leaves,
    unavailable: [
      ...unavailable.map((slot) => ({ userId: slot.userId, date: toDateStr(slot.date), shiftType: slot.timeSlot })),
      ...assignments.filter((row) => closedDates.has(row.date)).map((row) => ({ userId: row.userId, date: row.date, shiftType: row.shiftType })),
    ],
    requiredByPosition,
  };
}

async function validateSwap(
  tx: Prisma.TransactionClient,
  row: any,
) {
  const { req, tgt, plan } = assertSwapInvariants(row);
  const schedules = await tx.schedule.findMany({ where: { planId: req.planId } });
  const assignments = schedules.map((schedule) => ({
    userId: schedule.id === req.id ? row.targetUserId : schedule.id === tgt.id ? row.requesterId : schedule.userId,
    date: localDate(schedule.date),
    shiftType: schedule.shiftType as Shift,
  }));
  const input = await constraintInput(tx, plan, assignments);
  const issues = validateHardConstraints(input);
  if (issues.length) throw new ApprovalServiceError("换班后班表不满足硬约束", 422, "hard_constraints");
  return { req, tgt, plan, issues };
}

function assertSwapInvariants(row: any) {
  const req = row.reqSchedule;
  const tgt = row.tgtSchedule;
  if (
    req.storeId !== tgt.storeId ||
    req.weekOf !== tgt.weekOf ||
    !req.planId ||
    req.planId !== tgt.planId ||
    req.plan?.status !== "published" ||
    tgt.plan?.status !== "published" ||
    req.userId !== row.requesterId ||
    tgt.userId !== row.targetUserId ||
    row.requester.position !== row.targetUser.position
  ) {
    throw new ApprovalServiceError("换班必须同店、同周、同岗位且来自已发布班表", 409, "invalid_swap");
  }
  return { req, tgt, plan: req.plan as SchedulePlan };
}

async function validateSwapBatch(
  tx: Prisma.TransactionClient,
  items: LoadedApproval[],
  batchApprovedLeaves: any[],
) {
  const groups = new Map<string, { plan: SchedulePlan; rows: any[] }>();
  const usedSchedules = new Set<string>();
  for (const item of items) {
    if (item.type !== "shift_swap") continue;
    const { req, tgt, plan } = assertSwapInvariants(item.row);
    if (usedSchedules.has(req.id) || usedSchedules.has(tgt.id)) {
      throw new ApprovalServiceError("同一班次不能在一个批次中重复换班", 409, "duplicate_schedule");
    }
    usedSchedules.add(req.id); usedSchedules.add(tgt.id);
    const group = groups.get(plan.id) ?? { plan, rows: [] };
    group.rows.push(item.row); groups.set(plan.id, group);
  }
  for (const group of groups.values()) {
    const schedules = await tx.schedule.findMany({ where: { planId: group.plan.id } });
    const users = new Map(schedules.map((schedule) => [schedule.id, schedule.userId]));
    for (const row of group.rows) {
      users.set(row.reqSchedule.id, row.targetUserId);
      users.set(row.tgtSchedule.id, row.requesterId);
    }
    const assignments = schedules.map((schedule) => ({
      userId: users.get(schedule.id)!,
      date: localDate(schedule.date),
      shiftType: schedule.shiftType as Shift,
    }));
    const input = await constraintInput(tx, group.plan, assignments);
    const issues = validateHardConstraints({
      ...input,
      leaves: [
        ...input.leaves,
        ...batchApprovedLeaves.map((leave) => ({
          userId: leave.userId,
          status: "approved",
          startTime: leave.startTime,
          endTime: leave.endTime,
        })),
      ],
    });
    if (issues.length) throw new ApprovalServiceError("换班后班表不满足硬约束", 422, "hard_constraints");
  }
  return groups;
}

export async function decideApprovalsInTransaction(
  tx: Prisma.TransactionClient,
  scope: StoreScope,
  input: NormalizedApprovalDecisionInput,
) {
  assertManager(scope);
    const loaded: LoadedApproval[] = [];
    for (const identity of input.items) loaded.push(await loadApproval(tx, identity));
    for (const item of loaded) {
      if (item.storeId !== scope.storeId) throw new ApprovalServiceError("无权处理其他门店单据", 403, "cross_store");
      if (item.status !== pendingStatus[item.type]) throw new ApprovalServiceError("单据状态已变化，请核对后重试", 409, "stale");
    }
    const aiLogs = input.aiLogIds.length
      ? await tx.aiInteractionLog.findMany({ where: { id: { in: input.aiLogIds } } })
      : [];
    if (input.aiLogIds.length) {
      if (aiLogs.length !== new Set(input.aiLogIds).size) throw new ApprovalServiceError("AI 建议记录无效", 400, "invalid_ai_log");
      const selected = new Set(input.items.map((item) => `${item.type}:${item.id}`));
      for (const log of aiLogs) {
        if (log.feature !== "audit_checker" || log.storeId !== scope.storeId || !log.approvalType || !log.approvalId || log.eventKind !== `approval:${log.approvalType}:${log.approvalId}` || !selected.has(`${log.approvalType}:${log.approvalId}`) || !loggedSuggestion(log.outputText)) {
          throw new ApprovalServiceError("AI 建议与所选单据不匹配", 400, "invalid_ai_log");
        }
      }
    }
    if (input.decision === "approved") {
      for (const item of loaded) {
        if (item.type === "punch_correction" && localDate(item.row.requestedTime) !== localDate(item.row.date)) {
          throw new ApprovalServiceError("补卡时间与申请日期不一致", 409, "invalid_correction_date");
        }
      }
    }
    const swapPlans = input.decision === "approved"
      ? await validateSwapBatch(tx, loaded, loaded.filter((item) => item.type === "leave").map((item) => item.row))
      : new Map<string, { plan: SchedulePlan; rows: any[] }>();
    const leaveTotals = new Map<string, { userId: string; type: string; hours: number }>();
    if (input.decision === "approved") {
      for (const item of loaded) if (item.type === "leave") {
        const key = `${item.row.userId}:${item.row.type}`;
        const current = leaveTotals.get(key) ?? { userId: item.row.userId, type: item.row.type, hours: 0 };
        current.hours += item.row.hours;
        leaveTotals.set(key, current);
      }
      for (const total of leaveTotals.values()) {
        const field = total.type === "annual" ? "annualLeaveBalance" : "sickLeaveBalance";
        const changed = await tx.user.updateMany({ where: { id: total.userId, storeId: scope.storeId, [field]: { gte: total.hours } }, data: { [field]: { decrement: total.hours } } });
        if (changed.count !== 1) throw new ApprovalServiceError("假期余额不足", 409, "insufficient_balance");
      }
    }
    const decidedAt = new Date();
    for (const item of loaded) {
      if (item.type === "shift_swap" && input.decision === "approved") {
        const { req, tgt, plan } = assertSwapInvariants(item.row);
        const reqChanged = await tx.schedule.updateMany({ where: { id: req.id, userId: item.row.requesterId, planId: plan.id }, data: { userId: item.row.targetUserId, source: "swap" } });
        const tgtChanged = await tx.schedule.updateMany({ where: { id: tgt.id, userId: item.row.targetUserId, planId: plan.id }, data: { userId: item.row.requesterId, source: "swap" } });
        if (reqChanged.count !== 1 || tgtChanged.count !== 1) throw new ApprovalServiceError("班表状态已变化，请刷新后重试", 409, "stale_schedule");
        item.row.engineCheckResult = JSON.stringify({ valid: true, issues: [] });
      }
      const data = { status: input.decision, decidedById: scope.user.id, decidedAt, decisionReason: input.reason };
      const changed = item.type === "leave"
        ? await tx.leaveRequest.updateMany({ where: { id: item.id, status: "pending" }, data })
        : item.type === "punch_correction"
          ? await tx.punchCorrection.updateMany({ where: { id: item.id, status: "pending" }, data })
          : await tx.shiftSwapRequest.updateMany({ where: { id: item.id, status: "pending_manager" }, data: { ...data, engineCheckResult: item.row.engineCheckResult } });
      if (changed.count !== 1) throw new ApprovalServiceError("单据状态已变化，请核对后重试", 409, "stale");
      if (item.type === "punch_correction" && input.decision === "approved") {
        await tx.attendanceRecord.create({ data: { userId: item.row.userId, storeId: scope.storeId, time: item.row.requestedTime, direction: item.row.direction, viaCode: false, corrected: true } });
        await syncAttendancePunchStateFromLatest(tx, item.row.userId, scope.storeId);
      }
    }
    for (const { plan } of swapPlans.values()) {
      const changed = await tx.schedulePlan.updateMany({ where: { id: plan.id, version: plan.version, status: "published" }, data: { version: { increment: 1 } } });
      if (changed.count !== 1) throw new ApprovalServiceError("班表状态已变化，请刷新后重试", 409, "stale_schedule");
    }
    if (input.aiLogIds.length) {
      for (const log of aiLogs) {
        const accepted = (loggedSuggestion(log.outputText) === "compliant") === (input.decision === "approved");
        await tx.aiInteractionLog.update({ where: { id: log.id }, data: { wasAccepted: accepted } });
      }
    }
    const approvedItems = input.decision === "approved" ? loaded : [];
    for (const [date, userIds] of affectedAttendanceDates(loaded)) {
      await recalculateDailyAttendanceInTransaction(
        tx,
        scope,
        { from: date, to: date, userIds: [...userIds] },
        { skipMonthlyInvalidation: true },
      );
    }
    const monthlyChanges = approvalMonthlyInvalidationChanges(approvedItems, scope.user.id);
    if (monthlyChanges.length) {
      await invalidateMonthlyConfirmations(tx, { storeId: scope.storeId, changes: monthlyChanges });
    }
    return { status: input.decision, count: loaded.length };
}

export async function decideApprovals(scope: StoreScope, raw: ApprovalDecisionInput) {
  assertManager(scope);
  const input = normalizeDecision(raw);
  try {
    return await prisma.$transaction(
      (tx) => decideApprovalsInTransaction(tx, scope, input),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof ApprovalServiceError) throw error;
    if (error instanceof AttendanceServiceError) throw new ApprovalServiceError(error.message, error.status, error.code);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new ApprovalServiceError("审批期间考勤事实已变化，请重试", 409, "stale");
    }
    throw error;
  }
}

export async function listApprovals(scope: StoreScope, query: ApprovalQuery): Promise<ApprovalItem[]> {
  if (!["manager", "admin"].includes(scope.user.role)) throw new ApprovalServiceError("无权限访问审批中心", 403, "forbidden");
  const history = query.status === "history";
  const [leaves, corrections, swaps] = await Promise.all([
    !query.type || query.type === "leave" ? prisma.leaveRequest.findMany({ where: { user: { storeId: scope.storeId }, status: history ? { in: ["approved", "rejected"] } : "pending" }, include: { user: true }, orderBy: { createdAt: "desc" } }) : [],
    !query.type || query.type === "punch_correction" ? prisma.punchCorrection.findMany({ where: { user: { storeId: scope.storeId }, status: history ? { in: ["approved", "rejected"] } : "pending" }, include: { user: true }, orderBy: { createdAt: "desc" } }) : [],
    !query.type || query.type === "shift_swap" ? prisma.shiftSwapRequest.findMany({ where: { reqSchedule: { storeId: scope.storeId }, status: history ? { in: ["approved", "rejected"] } : "pending_manager" }, include: { requester: true, targetUser: true, reqSchedule: true, tgtSchedule: true }, orderBy: { createdAt: "desc" } }) : [],
  ]);
  const items: ApprovalItem[] = [
    ...leaves.map((row) => ({ id: row.id, type: "leave" as const, storeId: row.user.storeId!, userId: row.userId, employeeName: row.user.name, submittedAt: row.createdAt.toISOString(), status: normalizeManagerStatus("leave", row.status) as ApprovalItem["status"], summary: `${row.type === "annual" ? "年假" : "病假"} ${row.hours} 小时`, aiSuggestion: row.aiComplianceSuggestion as ApprovalItem["aiSuggestion"], aiReason: row.aiComplianceReason, decidedAt: row.decidedAt?.toISOString() ?? null, decisionReason: row.decisionReason })),
    ...corrections.map((row) => ({ id: row.id, type: "punch_correction" as const, storeId: row.user.storeId!, userId: row.userId, employeeName: row.user.name, submittedAt: row.createdAt.toISOString(), status: normalizeManagerStatus("punch_correction", row.status) as ApprovalItem["status"], summary: `${localDate(row.date)} ${row.direction === "in" ? "上班" : "下班"}补卡`, aiSuggestion: row.aiSuggestion as ApprovalItem["aiSuggestion"], aiReason: row.aiReason, decidedAt: row.decidedAt?.toISOString() ?? null, decisionReason: row.decisionReason })),
    ...swaps.map((row) => ({ id: row.id, type: "shift_swap" as const, storeId: row.reqSchedule.storeId, userId: row.requesterId, employeeName: row.requester.name, submittedAt: row.createdAt.toISOString(), status: normalizeManagerStatus("shift_swap", row.status) as ApprovalItem["status"], summary: `与 ${row.targetUser.name} 换班（${localDate(row.reqSchedule.date)} ↔ ${localDate(row.tgtSchedule.date)}）`, aiSuggestion: row.aiSuggestion as ApprovalItem["aiSuggestion"], aiReason: row.aiReason, decidedAt: row.decidedAt?.toISOString() ?? null, decisionReason: row.decisionReason })),
  ];
  return items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

export async function createPunchCorrection(user: SessionUser, raw: CreatePunchCorrectionInput) {
  assertEmployee(user);
  const parsed = createPunchCorrectionSchema.safeParse(raw);
  if (!parsed.success) failValidation(parsed.error);
  const requestedTime = new Date(parsed.data.requestedTime);
  if (localDate(requestedTime) !== parsed.data.date) throw new ApprovalServiceError("补卡时间必须属于申请日期", 400, "date_mismatch");
  return prisma.punchCorrection.create({ data: { userId: user.id, date: new Date(`${parsed.data.date}T00:00:00+08:00`), direction: parsed.data.direction, requestedTime, reason: parsed.data.reason, status: "pending" } });
}

export async function createManagerProxyApproval(scope: StoreScope, raw: ProxyAttendanceRequest) {
  assertManager(scope);
  const parsed = proxyAttendanceRequestSchema.safeParse(raw);
  if (!parsed.success) failValidation(parsed.error);
  const target = await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, role: true, storeId: true, annualLeaveBalance: true, sickLeaveBalance: true } });
  if (!target || target.role !== "employee" || target.storeId !== scope.storeId) throw new ApprovalServiceError("只能代同店员工提交申请", 403, "cross_store_or_role");
  if (parsed.data.action === "proxy_punch_correction") {
    const requestedTime = new Date(parsed.data.requestedTime);
    if (localDate(requestedTime) !== parsed.data.date) throw new ApprovalServiceError("补卡时间必须属于申请日期", 400, "date_mismatch");
    return prisma.punchCorrection.create({ data: {
      userId: target.id, date: new Date(`${parsed.data.date}T00:00:00+08:00`), direction: parsed.data.direction,
      requestedTime, reason: parsed.data.reason, status: "pending",
    } });
  }
  const startTime = new Date(parsed.data.startTime);
  const endTime = new Date(parsed.data.endTime);
  const hours = calculateProxyLeaveHours(startTime, endTime, parsed.data.isFullDay);
  const pending = await prisma.leaveRequest.aggregate({ where: { userId: target.id, type: parsed.data.type, status: "pending" }, _sum: { hours: true } });
  const balance = parsed.data.type === "annual" ? target.annualLeaveBalance : target.sickLeaveBalance;
  if (hours <= 0 || hours > balance - (pending._sum.hours ?? 0)) throw new ApprovalServiceError("假期余额不足或请假时长无效", 409, "insufficient_balance");
  return prisma.leaveRequest.create({ data: {
    userId: target.id, type: parsed.data.type, startTime, endTime, isFullDay: parsed.data.isFullDay,
    hours, reason: parsed.data.reason, status: "pending",
  } });
}

export async function listPunchCorrections(user: SessionUser) {
  assertEmployee(user);
  return prisma.punchCorrection.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
}

export async function createShiftSwap(user: SessionUser, raw: CreateShiftSwapInput) {
  assertEmployee(user);
  const parsed = createShiftSwapSchema.safeParse(raw);
  if (!parsed.success) failValidation(parsed.error);
  if (parsed.data.targetUserId === user.id) throw new ApprovalServiceError("不能与自己换班", 400, "invalid_target");
  return prisma.$transaction(async (tx) => {
    const reqSchedule = await tx.schedule.findUnique({ where: { id: parsed.data.reqScheduleId }, include: { plan: true, user: true } });
    const tgtSchedule = await tx.schedule.findUnique({ where: { id: parsed.data.tgtScheduleId }, include: { plan: true, user: true } });
    if (!reqSchedule || !tgtSchedule) throw new ApprovalServiceError("班次不存在", 404, "not_found");
    const row = { requesterId: user.id, targetUserId: parsed.data.targetUserId, requester: reqSchedule.user, targetUser: tgtSchedule.user, reqSchedule, tgtSchedule };
    await validateSwap(tx, row);
    return tx.shiftSwapRequest.create({ data: { requesterId: user.id, targetUserId: parsed.data.targetUserId, reqScheduleId: reqSchedule.id, tgtScheduleId: tgtSchedule.id, status: "pending_target", engineCheckResult: JSON.stringify({ valid: true, issues: [] }) } });
  });
}

export async function acceptTargetSwap(user: SessionUser, requestId: string) {
  assertEmployee(user);
  const row = await prisma.shiftSwapRequest.findUnique({ where: { id: requestId } });
  if (!row) throw new ApprovalServiceError("换班申请不存在", 404, "not_found");
  if (row.targetUserId !== user.id) throw new ApprovalServiceError("只有目标员工可以接受换班", 403, "forbidden");
  const changed = await prisma.shiftSwapRequest.updateMany({ where: { id: requestId, targetUserId: user.id, status: "pending_target" }, data: { status: "pending_manager" } });
  if (changed.count !== 1) throw new ApprovalServiceError("换班申请状态已变化", 409, "stale");
  return prisma.shiftSwapRequest.findUniqueOrThrow({ where: { id: requestId } });
}

export async function listShiftSwaps(user: SessionUser) {
  assertEmployee(user);
  return prisma.shiftSwapRequest.findMany({ where: { OR: [{ requesterId: user.id }, { targetUserId: user.id }] }, include: { requester: true, targetUser: true, reqSchedule: true, tgtSchedule: true }, orderBy: { createdAt: "desc" } });
}

export async function getApprovalAiContext(scope: StoreScope, identity: ApprovalIdentity) {
  assertManager(scope);
  return prisma.$transaction(async (tx) => {
    const item = await loadApproval(tx, identity);
    if (item.storeId !== scope.storeId) throw new ApprovalServiceError("无权访问其他门店单据", 403, "cross_store");
    if (item.status !== pendingStatus[item.type]) throw new ApprovalServiceError("单据状态已变化，请核对后重试", 409, "stale");
    if (item.type === "leave") {
      const balance = item.row.type === "annual" ? item.row.user.annualLeaveBalance : item.row.user.sickLeaveBalance;
      return { item, query: `${item.row.type} 请假 合规 时长 余额`, detail: `员工：${item.row.user.name}\n类型：${item.row.type}\n时长：${item.row.hours} 小时\n事由：${item.row.reason ?? "未填写"}\n余额：${balance} 小时`, mockContext: { approvalType: item.type, leave: { type: item.row.type, hours: item.row.hours, balance, reason: item.row.reason ?? undefined } } };
    }
    if (item.type === "punch_correction") return { item, query: "补卡 合规 考勤", detail: `员工：${item.row.user.name}\n日期：${localDate(item.row.date)}\n方向：${item.row.direction}\n时间：${item.row.requestedTime.toISOString()}\n原因：${item.row.reason ?? "未填写"}`, mockContext: { approvalType: item.type, correction: { date: localDate(item.row.date), requestedTime: item.row.requestedTime.toISOString(), reason: item.row.reason } } };
    return { item, query: "换班 合规 排班", detail: `申请人：${item.row.requester.name}\n目标员工：${item.row.targetUser.name}\n原班次：${localDate(item.row.reqSchedule.date)} ${item.row.reqSchedule.shiftType}\n目标班次：${localDate(item.row.tgtSchedule.date)} ${item.row.tgtSchedule.shiftType}`, mockContext: { approvalType: item.type, swap: { engineCheckResult: item.row.engineCheckResult } } };
  });
}

export async function saveApprovalAdvice(scope: StoreScope, identity: ApprovalIdentity, advice: AiAdvice, log: { provider: string; model: string; inputText: string; outputText: string }) {
  assertManager(scope);
  return prisma.$transaction(async (tx) => {
    const item = await loadApproval(tx, identity);
    if (item.storeId !== scope.storeId) throw new ApprovalServiceError("无权访问其他门店单据", 403, "cross_store");
    const where = { id: identity.id, status: pendingStatus[identity.type] };
    const changed = identity.type === "leave"
      ? await tx.leaveRequest.updateMany({ where, data: { aiComplianceSuggestion: advice.suggestion, aiComplianceReason: advice.reason } })
      : identity.type === "punch_correction"
        ? await tx.punchCorrection.updateMany({ where, data: { aiSuggestion: advice.suggestion, aiReason: advice.reason } })
        : await tx.shiftSwapRequest.updateMany({ where, data: { aiSuggestion: advice.suggestion, aiReason: advice.reason } });
    if (changed.count !== 1) throw new ApprovalServiceError("单据状态已变化，请核对后重试", 409, "stale");
    const saved = await tx.aiInteractionLog.create({ data: { userId: scope.user.id, storeId: scope.storeId, approvalType: identity.type, approvalId: identity.id, eventKind: `approval:${identity.type}:${identity.id}`, feature: "audit_checker", provider: log.provider, model: log.model, inputText: log.inputText, outputText: log.outputText } });
    return saved.id;
  });
}
