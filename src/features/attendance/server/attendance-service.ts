import { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/auth";
import type { StoreScope } from "@/lib/authorization";
import type { PunchHistoryQuery } from "@/lib/contracts/attendance";
import type { MonthlyInvalidationChange } from "@/lib/contracts/monthly-attendance";
import { prisma } from "@/lib/db";
import { shanghaiDateOnly, shanghaiDateValue } from "@/lib/dates";
import { calculateDailyAttendance, type AttendanceExceptionType, type DailyAttendanceResult } from "./calculate-daily-attendance";
import { verifyClockCode } from "./clock-code";
import { invalidateMonthlyConfirmations } from "./invalidate-monthly-confirmation";

export class AttendanceServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

const effectiveAttendanceRecordWhere = {
  OR: [{ viaCode: true }, { corrected: true }],
} satisfies Prisma.AttendanceRecordWhereInput;

async function advancePunchState(
  tx: Prisma.TransactionClient,
  userId: string,
  storeId: string,
  direction: "in" | "out",
) {
  const state = await tx.attendancePunchState.findUnique({ where: { userId } });
  const latest = state ? null : await tx.attendanceRecord.findFirst({
    where: { userId, storeId, ...effectiveAttendanceRecordWhere }, orderBy: [{ time: "desc" }, { id: "desc" }], select: { direction: true },
  });
  if ((state?.lastDirection ?? latest?.direction) === direction) {
    throw new AttendanceServiceError("不能连续提交相同打卡方向", 409, "same_direction");
  }
  if (state) {
    const changed = await tx.attendancePunchState.updateMany({
      where: { userId, version: state.version },
      data: { lastDirection: direction, version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new AttendanceServiceError("打卡状态已变化", 409, "stale");
  } else {
    await tx.attendancePunchState.create({ data: { userId, storeId, lastDirection: direction } });
  }
}

export async function syncAttendancePunchStateFromLatest(
  tx: Prisma.TransactionClient,
  userId: string,
  storeId: string,
) {
  const latest = await tx.attendanceRecord.findFirst({
    where: { userId, storeId, ...effectiveAttendanceRecordWhere }, orderBy: [{ time: "desc" }, { id: "desc" }], select: { direction: true },
  });
  if (!latest || (latest.direction !== "in" && latest.direction !== "out")) return;
  const state = await tx.attendancePunchState.findUnique({ where: { userId } });
  if (!state) {
    await tx.attendancePunchState.create({ data: { userId, storeId, lastDirection: latest.direction } });
    return;
  }
  if (state.lastDirection === latest.direction) return;
  const changed = await tx.attendancePunchState.updateMany({
    where: { userId, version: state.version },
    data: { lastDirection: latest.direction, version: { increment: 1 } },
  });
  if (changed.count !== 1) throw new AttendanceServiceError("打卡状态已变化", 409, "stale");
}

export async function punchWithCodeInTransaction(
  tx: Prisma.TransactionClient,
  user: SessionUser,
  input: { direction: "in" | "out"; code: string },
  now: Date,
  secret: string,
) {
  if (user.role !== "employee") throw new AttendanceServiceError("仅员工可以打卡", 403, "forbidden");
  if (!user.storeId) throw new AttendanceServiceError("当前账号未绑定门店", 400, "missing_store");
  if (!/^(in|out)$/.test(input.direction) || !/^\d{6}$/.test(input.code)) throw new AttendanceServiceError("动态码或打卡方向无效", 400, "invalid_input");
  const match = verifyClockCode(user.storeId, input.code, now, secret);
  if (!match) throw new AttendanceServiceError("动态码无效或已过期", 400, "invalid_code");
  const clockWindow = String(match.matchedWindow);
  const replay = await tx.attendanceRecord.findFirst({ where: { userId: user.id, clockWindow }, select: { id: true } });
  if (replay) throw new AttendanceServiceError("该动态码已使用", 409, "replay");
  await advancePunchState(tx, user.id, user.storeId, input.direction);
  const record = await tx.attendanceRecord.create({ data: {
    userId: user.id, storeId: user.storeId, time: now, direction: input.direction,
    viaCode: true, corrected: false, clockWindow,
  } });
  await tx.attendanceAuditEvent.create({ data: {
    storeId: user.storeId, actorId: user.id, userId: user.id, action: "punch.created", subjectId: record.id,
    metadataJson: JSON.stringify({ direction: input.direction, viaCode: true }),
  } });
  await invalidateMonthlyConfirmations(tx, {
    storeId: user.storeId,
    changes: [{
      userId: user.id,
      localDate: shanghaiDateOnly(now),
      reason: "punch_created",
      actorId: user.id,
      sourceRef: `punch:${record.id}`,
    }],
  });
  return record;
}

export async function punchWithCode(
  user: SessionUser,
  input: { direction: "in" | "out"; code: string },
  now: Date,
  secret: string,
) {
  try {
    return await prisma.$transaction(
      (tx) => punchWithCodeInTransaction(tx, user, input, now, secret),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof AttendanceServiceError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
      throw new AttendanceServiceError("打卡状态已变化", 409, error.code === "P2002" ? "replay" : "stale");
    }
    throw error;
  }
}

export async function listPunches(scope: StoreScope, query: PunchHistoryQuery = {}) {
  if (scope.user.role !== "manager" && scope.user.role !== "admin") throw new AttendanceServiceError("无权限查看打卡记录", 403, "forbidden");
  const time = query.from || query.to ? {
    ...(query.from ? { gte: shanghaiDateValue(query.from) } : {}),
    ...(query.to ? { lt: new Date(shanghaiDateValue(query.to).getTime() + 86_400_000) } : {}),
  } : undefined;
  const rows = await prisma.attendanceRecord.findMany({
    where: {
      storeId: scope.storeId,
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.direction ? { direction: query.direction } : {}),
      ...(time ? { time } : {}),
      ...(query.source === "dynamic_code" ? { viaCode: true, corrected: false } : {}),
      ...(query.source === "correction" ? { corrected: true } : {}),
      ...(query.source === "legacy" ? { viaCode: false, corrected: false } : {}),
    },
    include: { user: { select: { name: true } } },
    orderBy: [{ time: "desc" }, { id: "desc" }],
  });
  return rows.map((row) => ({
    id: row.id, userId: row.userId, employeeName: row.user.name, storeId: row.storeId,
    time: row.time.toISOString(), direction: row.direction as "in" | "out",
    source: row.corrected ? "correction" as const : row.viaCode ? "dynamic_code" as const : "legacy" as const,
    valid: row.viaCode || row.corrected,
  }));
}

export async function listOwnPunches(user: SessionUser) {
  if (user.role !== "employee") throw new AttendanceServiceError("仅员工可以查看本人打卡记录", 403, "forbidden");
  const rows = await prisma.attendanceRecord.findMany({ where: { userId: user.id }, orderBy: [{ time: "desc" }, { id: "desc" }], take: 30 });
  return rows.map((row) => ({
    id: row.id, userId: row.userId, storeId: row.storeId, time: row.time.toISOString(),
    direction: row.direction as "in" | "out", viaCode: row.viaCode,
    source: row.corrected ? "correction" as const : row.viaCode ? "dynamic_code" as const : "legacy" as const,
    valid: row.viaCode || row.corrected,
  }));
}

export type DailyQuery = { from: string; to: string; userId?: string; type?: string; status?: string };
export type ComputedDailyAttendance = { userId: string; employeeName: string; date: string; result: DailyAttendanceResult };
export type AttendanceFactBundle = {
  dateList: string[];
  users: Array<{ id: string; name: string }>;
  schedules: Array<{ id: string; userId: string; date: Date; shiftType: string }>;
  punches: Array<{ id: string; userId: string; time: Date; direction: string }>;
  leaves: Array<{ id: string; userId: string; startTime: Date; endTime: Date }>;
  corrections: Array<{ id: string; userId: string; requestedTime: Date; direction: string }>;
};

function days(from: string, to: string): string[] {
  let start: number;
  let end: number;
  try {
    start = shanghaiDateValue(from).getTime();
    end = shanghaiDateValue(to).getTime();
  } catch {
    throw new AttendanceServiceError("日期范围无效或超过 31 天", 400, "invalid_date_range");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !Number.isFinite(start) || start > end || end - start > 31 * 86_400_000) {
    throw new AttendanceServiceError("日期范围无效或超过 31 天", 400, "invalid_date_range");
  }
  const result: string[] = [];
  for (let time = start; time <= end; time += 86_400_000) result.push(shanghaiDateOnly(new Date(time)));
  return result;
}

export async function loadDailyAttendanceFactsInTransaction(
  db: Prisma.TransactionClient | typeof prisma,
  scope: StoreScope,
  query: DailyQuery,
  targetUserIds?: string[],
): Promise<AttendanceFactBundle> {
  const dateList = days(query.from, query.to);
  const start = shanghaiDateValue(dateList[0]);
  const end = new Date(shanghaiDateValue(dateList.at(-1)!).getTime() + 86_400_000);
  const users = await db.user.findMany({ where: {
    storeId: scope.storeId,
    role: "employee",
    ...(targetUserIds ? { id: { in: targetUserIds } } : query.userId ? { id: query.userId } : {}),
  }, select: { id: true, name: true } });
  const userIds = users.map((row) => row.id);
  const [schedules, attendanceRecords, leaves, approvedCorrections] = await Promise.all([
    db.schedule.findMany({ where: { storeId: scope.storeId, userId: { in: userIds }, date: { gte: start, lt: end }, plan: { is: { status: "published" } } }, select: { id: true, userId: true, date: true, shiftType: true } }),
    db.attendanceRecord.findMany({ where: { storeId: scope.storeId, userId: { in: userIds }, time: { gte: start, lt: end }, OR: [{ viaCode: true }, { corrected: true }] }, select: { id: true, userId: true, time: true, direction: true, viaCode: true, corrected: true } }),
    db.leaveRequest.findMany({ where: { userId: { in: userIds }, status: "approved", startTime: { lt: end }, endTime: { gt: start } }, select: { id: true, userId: true, startTime: true, endTime: true } }),
    db.punchCorrection.findMany({ where: { userId: { in: userIds }, status: "approved", requestedTime: { gte: start, lt: end } }, select: { id: true, userId: true, requestedTime: true, direction: true } }),
  ]);
  const correctionKey = (row: { userId: string; requestedTime: Date; direction: string }) => `${row.userId}:${row.requestedTime.getTime()}:${row.direction}`;
  const approvedByKey = new Map<string, (typeof approvedCorrections)[number]>();
  for (const row of [...approvedCorrections].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!approvedByKey.has(correctionKey(row))) approvedByKey.set(correctionKey(row), row);
  }
  const fallbackByKey = new Map<string, (typeof attendanceRecords)[number]>();
  for (const row of attendanceRecords.filter((item) => item.corrected).sort((a, b) => a.id.localeCompare(b.id))) {
    const key = correctionKey({ userId: row.userId, requestedTime: row.time, direction: row.direction });
    if (!approvedByKey.has(key) && !fallbackByKey.has(key)) fallbackByKey.set(key, row);
  }
  const punches = attendanceRecords
    .filter((row) => row.viaCode && !row.corrected)
    .map(({ id, userId, time, direction }) => ({ id, userId, time, direction }));
  const corrections = [
    ...[...approvedByKey.values()].map((row) => ({ id: `correction:${row.id}`, userId: row.userId, requestedTime: row.requestedTime, direction: row.direction })),
    ...[...fallbackByKey.values()].map((row) => ({ id: `record:${row.id}`, userId: row.userId, requestedTime: row.time, direction: row.direction })),
  ];
  return { dateList, users, schedules, punches, leaves, corrections };
}

export function calculateDailyRows(facts: AttendanceFactBundle): ComputedDailyAttendance[] {
  const result: ComputedDailyAttendance[] = [];
  for (const user of facts.users) for (const date of facts.dateList) {
    const dayStart = shanghaiDateValue(date).getTime();
    const dayEnd = dayStart + 86_400_000;
    result.push({ userId: user.id, employeeName: user.name, date, result: calculateDailyAttendance({
      date,
      assignments: facts.schedules.filter((row) => row.userId === user.id && shanghaiDateOnly(row.date) === date).map((row) => ({ userId: row.userId, date, shiftType: row.shiftType as "morning" | "afternoon" | "evening" })),
      punches: facts.punches.filter((row) => row.userId === user.id && row.time.getTime() >= dayStart && row.time.getTime() < dayEnd).map((row) => ({ time: row.time, direction: row.direction as "in" | "out" })),
      approvedLeaves: facts.leaves.filter((row) => row.userId === user.id && row.startTime.getTime() < dayEnd && row.endTime.getTime() > dayStart).map((row) => ({ startTime: row.startTime, endTime: row.endTime })),
      approvedCorrections: facts.corrections.filter((row) => row.userId === user.id && row.requestedTime.getTime() >= dayStart && row.requestedTime.getTime() < dayEnd).map((row) => ({ requestedTime: row.requestedTime, direction: row.direction as "in" | "out" })),
    }) });
  }
  return result;
}

export async function computeDailyAttendanceInTransaction(
  db: Prisma.TransactionClient | typeof prisma,
  scope: StoreScope,
  query: DailyQuery,
  targetUserIds?: string[],
) {
  return calculateDailyRows(await loadDailyAttendanceFactsInTransaction(db, scope, query, targetUserIds));
}

type RecalculateQuery = { from: string; to: string; userIds?: string[] };

async function validatedRecalculationTargets(tx: Prisma.TransactionClient, scope: StoreScope, userIds?: string[]) {
  if (!userIds) return undefined;
  const uniqueIds = [...new Set(userIds)];
  if (!uniqueIds.length || uniqueIds.length !== userIds.length) throw new AttendanceServiceError("重算员工列表无效", 400, "invalid_targets");
  const users = await tx.user.findMany({ where: { id: { in: uniqueIds } }, select: { id: true, role: true, storeId: true } });
  if (users.length !== uniqueIds.length) throw new AttendanceServiceError("重算员工不存在", 404, "target_not_found");
  if (users.some((user) => user.role !== "employee" || user.storeId !== scope.storeId)) {
    throw new AttendanceServiceError("只能重算本店员工", 403, "invalid_target_scope");
  }
  return uniqueIds;
}

export async function recalculateDailyAttendanceInTransaction(
  tx: Prisma.TransactionClient,
  scope: StoreScope,
  query: RecalculateQuery,
  options: { skipMonthlyInvalidation?: boolean } = {},
) {
  if (scope.user.role !== "manager") throw new AttendanceServiceError("只有店铺经理可以重新计算", 403, "forbidden");
  const targets = await validatedRecalculationTargets(tx, scope, query.userIds);
  const computed = await computeDailyAttendanceInTransaction(tx, scope, { from: query.from, to: query.to }, targets);
  const rows = computed;
  const monthlyChanges: MonthlyInvalidationChange[] = [];
  for (const row of rows) {
    const date = shanghaiDateValue(row.date);
    const activeTypes = new Set(row.result.exceptions.map((exception) => exception.type));
    const existing = await tx.attendanceExceptionConfirmation.findMany({ where: { storeId: scope.storeId, userId: row.userId, date } });
    const byType = new Map(existing.map((item) => [item.type, item]));
    for (const type of activeTypes) {
      const prior = byType.get(type);
      if (!prior) {
        const created = await tx.attendanceExceptionConfirmation.create({ data: { storeId: scope.storeId, userId: row.userId, date, type } });
        monthlyChanges.push({
          userId: row.userId,
          localDate: row.date,
          reason: "daily_result_changed",
          actorId: scope.user.id,
          sourceRef: `daily:${created.id}`,
        });
      }
      else if (!prior.active) {
        await tx.attendanceExceptionConfirmation.update({ where: { id: prior.id }, data: { active: true, revision: { increment: 1 }, status: "unconfirmed", confirmedById: null, confirmedAt: null } });
        await tx.attendanceAuditEvent.create({ data: { storeId: scope.storeId, actorId: scope.user.id, userId: row.userId, action: "daily.reappeared", subjectId: prior.id, metadataJson: JSON.stringify({ type, date: row.date, nextRevision: prior.revision + 1 }) } });
        monthlyChanges.push({
          userId: row.userId,
          localDate: row.date,
          reason: "daily_result_changed",
          actorId: scope.user.id,
          sourceRef: `daily:${prior.id}`,
        });
      }
    }
    const staleUnconfirmed = existing.filter((item) => item.active && item.status === "unconfirmed" && !activeTypes.has(item.type as AttendanceExceptionType));
    for (const prior of staleUnconfirmed) {
      const deleted = await tx.attendanceExceptionConfirmation.deleteMany({ where: { id: prior.id, active: true, status: "unconfirmed" } });
      if (deleted.count === 1) {
        monthlyChanges.push({
          userId: row.userId,
          localDate: row.date,
          reason: "daily_result_changed",
          actorId: scope.user.id,
          sourceRef: `daily:${prior.id}`,
        });
      }
    }
    for (const prior of existing.filter((item) => item.active && item.status === "confirmed" && !activeTypes.has(item.type as AttendanceExceptionType))) {
      await tx.attendanceExceptionConfirmation.update({ where: { id: prior.id }, data: { active: false } });
      await tx.attendanceAuditEvent.create({ data: { storeId: scope.storeId, actorId: scope.user.id, userId: row.userId, action: "daily.disappeared", subjectId: prior.id, metadataJson: JSON.stringify({ type: prior.type, date: row.date, revision: prior.revision }) } });
      monthlyChanges.push({
        userId: row.userId,
        localDate: row.date,
        reason: "daily_result_changed",
        actorId: scope.user.id,
        sourceRef: `daily:${prior.id}`,
      });
    }
  }
  await tx.attendanceAuditEvent.create({ data: { storeId: scope.storeId, actorId: scope.user.id, action: "daily.recalculated", metadataJson: JSON.stringify({ from: query.from, to: query.to, userCount: rows.length }) } });
  if (!options.skipMonthlyInvalidation && monthlyChanges.length) {
    await invalidateMonthlyConfirmations(tx, { storeId: scope.storeId, changes: monthlyChanges });
  }
  return { count: rows.length };
}

export async function recalculateDailyAttendance(scope: StoreScope, query: RecalculateQuery) {
  if (scope.user.role !== "manager") throw new AttendanceServiceError("只有店铺经理可以重新计算", 403, "forbidden");
  try {
    return await prisma.$transaction((tx) => recalculateDailyAttendanceInTransaction(tx, scope, query), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof AttendanceServiceError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw new AttendanceServiceError("考勤事实已变化，请重试", 409, "stale");
    throw error;
  }
}

export async function listDailyAttendance(scope: StoreScope, query: DailyQuery) {
  const computed = await computeDailyAttendanceInTransaction(prisma, scope, query);
  const overlays = await prisma.attendanceExceptionConfirmation.findMany({ where: {
    storeId: scope.storeId, date: { gte: shanghaiDateValue(query.from), lt: new Date(shanghaiDateValue(query.to).getTime() + 86_400_000) },
    active: true, ...(query.userId ? { userId: query.userId } : {}), ...(query.type ? { type: query.type } : {}), ...(query.status ? { status: query.status } : {}),
  } });
  const byKey = new Map(overlays.map((row) => [`${row.userId}:${shanghaiDateOnly(row.date)}:${row.type}`, row]));
  return computed.flatMap((day) => day.result.exceptions.flatMap((exception) => {
    const overlay = byKey.get(`${day.userId}:${day.date}:${exception.type}`);
    if (!overlay || (query.type && query.type !== exception.type) || (query.status && query.status !== overlay.status)) return [];
    return [{ id: overlay.id, revision: overlay.revision, userId: day.userId, employeeName: day.employeeName, date: day.date, type: exception.type, minutes: exception.minutes, status: overlay.status, confirmedAt: overlay.confirmedAt?.toISOString() ?? null }];
  }));
}

export type ExpectedAttendanceRevision = { id: string; revision: number };

export async function transitionDailyExceptionsInTransaction(
  tx: Prisma.TransactionClient,
  scope: StoreScope,
  expectedRows: ExpectedAttendanceRevision[],
  from: "unconfirmed" | "confirmed",
  to: "confirmed" | "unconfirmed",
) {
  if (scope.user.role !== "manager" || !expectedRows.length) throw new AttendanceServiceError("只有店铺经理可以处理异常", 403, "forbidden");
  const expected = new Map<string, number>();
  for (const item of expectedRows) {
    if (!item.id || !Number.isInteger(item.revision) || item.revision < 1 || (expected.has(item.id) && expected.get(item.id) !== item.revision)) throw new AttendanceServiceError("异常版本无效", 409, "stale");
    expected.set(item.id, item.revision);
  }
  const rows = await tx.attendanceExceptionConfirmation.findMany({ where: { id: { in: [...expected.keys()] } }, include: { user: { select: { storeId: true } } } });
  if (rows.length !== expected.size || rows.some((row) => row.revision !== expected.get(row.id))) throw new AttendanceServiceError("异常记录不存在或版本已变化", 409, "stale");
  if (rows.some((row) => row.storeId !== scope.storeId || row.user.storeId !== scope.storeId)) throw new AttendanceServiceError("无权处理其他门店异常", 403, "cross_store");
  if (new Set(rows.map((row) => row.type)).size !== 1 || rows.some((row) => !row.active || row.status !== from)) throw new AttendanceServiceError("只能批量处理同一种且状态一致的当前异常", 409, "stale");
  const monthlyChanges: MonthlyInvalidationChange[] = [];
  for (const row of rows) {
    const changed = await tx.attendanceExceptionConfirmation.updateMany({
      where: { id: row.id, revision: expected.get(row.id), active: true, status: from },
      data: to === "confirmed"
        ? { status: to, confirmedById: scope.user.id, confirmedAt: new Date(), revision: { increment: 1 } }
        : { status: to, confirmedById: null, confirmedAt: null, revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw new AttendanceServiceError("异常状态已变化", 409, "stale");
    const fromRevision = expected.get(row.id)!;
    const localDate = shanghaiDateOnly(row.date);
    await tx.attendanceAuditEvent.create({ data: {
      storeId: scope.storeId,
      actorId: scope.user.id,
      userId: row.userId,
      action: `daily.${to}`,
      subjectId: row.id,
      metadataJson: JSON.stringify({ type: row.type, date: localDate, fromRevision, toRevision: fromRevision + 1 }),
    } });
    monthlyChanges.push({
      userId: row.userId,
      localDate,
      reason: "daily_confirmation_changed",
      actorId: scope.user.id,
      sourceRef: `daily:${row.id}`,
    });
  }
  await invalidateMonthlyConfirmations(tx, { storeId: scope.storeId, changes: monthlyChanges });
  return { count: rows.length };
}

async function transition(scope: StoreScope, expectedRows: ExpectedAttendanceRevision[], from: "unconfirmed" | "confirmed", to: "confirmed" | "unconfirmed") {
  return prisma.$transaction(
    (tx) => transitionDailyExceptionsInTransaction(tx, scope, expectedRows, from, to),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export const confirmDailyExceptions = (scope: StoreScope, rows: ExpectedAttendanceRevision[]) => transition(scope, rows, "unconfirmed", "confirmed");
export const unconfirmDailyExceptions = (scope: StoreScope, rows: ExpectedAttendanceRevision[]) => transition(scope, rows, "confirmed", "unconfirmed");
