import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import type { StoreScope } from "@/lib/authorization";
import { getAttendanceNow } from "@/lib/config";
import {
  validateMonthlyConfirmation,
  type MonthlyAttendanceRow,
  type MonthlyConfirmInput,
  type MonthlySourceSnapshot,
  type MonthlyUnconfirmInput,
} from "@/lib/contracts/monthly-attendance";
import { monthOnlySchema } from "@/lib/contracts/store";
import { shanghaiDateOnly, shanghaiMonthBounds as monthBounds, shanghaiMonthForInstant } from "@/lib/dates";
import { prisma } from "@/lib/db";
import {
  calculateDailyRows,
  loadDailyAttendanceFactsInTransaction,
} from "./attendance-service";

export class MonthlyAttendanceServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly details?: unknown) {
    super(message);
  }
}

export function shanghaiMonthBounds(month: string) {
  return monthBounds(monthOnlySchema.parse(month));
}

export function assertMonthNotFuture(month: string, now = getAttendanceNow()) {
  monthOnlySchema.parse(month);
  if (month > shanghaiMonthForInstant(now)) {
    throw new MonthlyAttendanceServiceError("future month cannot be confirmed", 409, "future_month");
  }
}

function byStableJson<T>(left: T, right: T) {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function canonicalSnapshot(snapshot: MonthlySourceSnapshot): MonthlySourceSnapshot {
  return {
    storeId: snapshot.storeId,
    userId: snapshot.userId,
    month: snapshot.month,
    schedules: snapshot.schedules.map((row) => ({ id: row.id, localDate: row.localDate, shiftType: row.shiftType })).sort(byStableJson),
    punches: snapshot.punches.map((row) => ({ id: row.id, time: row.time, direction: row.direction })).sort(byStableJson),
    leaves: snapshot.leaves.map((row) => ({ id: row.id, startTime: row.startTime, endTime: row.endTime })).sort(byStableJson),
    corrections: snapshot.corrections.map((row) => ({ id: row.id, requestedTime: row.requestedTime, direction: row.direction })).sort(byStableJson),
    days: snapshot.days.map((row) => ({
      localDate: row.localDate,
      scheduledHours: row.scheduledHours,
      workedHours: row.workedHours,
      exceptions: row.exceptions.map((item) => ({ type: item.type, minutes: item.minutes })).sort(byStableJson),
    })).sort(byStableJson),
    confirmations: snapshot.confirmations.map((row) => ({
      id: row.id,
      localDate: row.localDate,
      type: row.type,
      status: row.status,
      revision: row.revision,
    })).sort(byStableJson),
  };
}

export function serializeMonthlySnapshot(snapshot: MonthlySourceSnapshot) {
  return JSON.stringify(canonicalSnapshot(snapshot));
}

export function hashMonthlySnapshot(snapshot: MonthlySourceSnapshot) {
  return createHash("sha256").update(serializeMonthlySnapshot(snapshot)).digest("hex");
}

type MonthlyDb = Prisma.TransactionClient | typeof prisma;
type BuiltMonthlyRow = { row: MonthlyAttendanceRow; snapshot: MonthlySourceSnapshot };

async function buildMonthlyRows(
  db: MonthlyDb,
  scope: StoreScope,
  month: string,
  targetUserIds?: string[],
): Promise<BuiltMonthlyRow[]> {
  const { start, end } = shanghaiMonthBounds(month);
  const from = `${month}-01`;
  const to = shanghaiDateOnly(new Date(end.getTime() - 1));
  const facts = await loadDailyAttendanceFactsInTransaction(db, scope, { from, to }, targetUserIds);
  const calculated = calculateDailyRows(facts);
  const userIds = facts.users.map((user) => user.id);
  const [overlays, confirmations] = await Promise.all([
    db.attendanceExceptionConfirmation.findMany({
      where: { storeId: scope.storeId, userId: { in: userIds }, date: { gte: start, lt: end }, active: true },
      select: { id: true, userId: true, date: true, type: true, status: true, revision: true },
    }),
    db.monthlyAttendanceConfirmation.findMany({
      where: { storeId: scope.storeId, userId: { in: userIds }, month },
      include: {
        confirmedBy: { select: { name: true } },
        auditEvents: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
      },
    }),
  ]);
  const confirmationByUser = new Map(confirmations.map((row) => [row.userId, row]));
  return facts.users.map((user) => {
    const days = calculated.filter((row) => row.userId === user.id);
    const currentExceptionKeys = new Set(days.flatMap((day) => day.result.exceptions.map((item) => `${day.date}:${item.type}`)));
    const currentOverlays = overlays.filter((overlay) => overlay.userId === user.id && currentExceptionKeys.has(`${shanghaiDateOnly(overlay.date)}:${overlay.type}`));
    const unconfirmedExceptionCount = [...currentExceptionKeys].filter((key) => {
      const overlay = currentOverlays.find((item) => `${shanghaiDateOnly(item.date)}:${item.type}` === key);
      return overlay?.status !== "confirmed";
    }).length;
    const snapshot: MonthlySourceSnapshot = canonicalSnapshot({
      storeId: scope.storeId,
      userId: user.id,
      month,
      schedules: facts.schedules.filter((row) => row.userId === user.id).map((row) => ({ id: row.id, localDate: shanghaiDateOnly(row.date), shiftType: row.shiftType })),
      punches: facts.punches.filter((row) => row.userId === user.id).map((row) => ({ id: row.id, time: row.time.toISOString(), direction: row.direction })),
      leaves: facts.leaves.filter((row) => row.userId === user.id).map((row) => ({ id: row.id, startTime: row.startTime.toISOString(), endTime: row.endTime.toISOString() })),
      corrections: facts.corrections.filter((row) => row.userId === user.id).map((row) => ({ id: row.id, requestedTime: row.requestedTime.toISOString(), direction: row.direction })),
      days: days.map((day) => ({
        localDate: day.date,
        scheduledHours: day.result.scheduledHours,
        workedHours: day.result.workedHours,
        exceptions: day.result.exceptions.map((item) => ({ type: item.type, minutes: item.minutes })),
      })),
      confirmations: currentOverlays.map((overlay) => ({
        id: overlay.id,
        localDate: shanghaiDateOnly(overlay.date),
        type: overlay.type,
        status: overlay.status,
        revision: overlay.revision,
      })),
    });
    const confirmation = confirmationByUser.get(user.id);
    const latestAudit = confirmation?.auditEvents[0];
    const scheduledHours = days.reduce((total, day) => total + day.result.scheduledHours, 0);
    const workedHours = days.reduce((total, day) => total + day.result.workedHours, 0);
    const leaveHours = days.reduce((total, day) => total + day.result.leaveHours, 0);
    const correctionHours = days.reduce((total, day) => total + day.result.correctionHours, 0);
    return {
      snapshot,
      row: {
        userId: user.id,
        employeeName: user.name,
        month,
        scheduledHours,
        workedHours,
        leaveHours,
        correctionHours,
        exceptionCount: currentExceptionKeys.size,
        unconfirmedExceptionCount,
        zeroAttendance: scheduledHours > 0 && workedHours === 0,
        zeroAttendanceAction: (confirmation?.zeroAttendanceAction ?? "none") as MonthlyAttendanceRow["zeroAttendanceAction"],
        status: (confirmation?.status ?? "unconfirmed") as MonthlyAttendanceRow["status"],
        confirmedByName: confirmation?.confirmedBy?.name ?? null,
        confirmedAt: confirmation?.confirmedAt?.toISOString() ?? null,
        revision: confirmation?.revision ?? 0,
        sourceHash: hashMonthlySnapshot(snapshot),
        needsReconfirmation: confirmation?.status === "unconfirmed" && latestAudit?.eventType === "invalidated",
        lastInvalidationReason: latestAudit?.eventType === "invalidated" ? latestAudit.reason : null,
      },
    };
  });
}

function assertReadScope(scope: StoreScope, selfUserId?: string) {
  if (scope.user.role === "employee") {
    if (!scope.user.storeId || scope.storeId !== scope.user.storeId || (selfUserId && selfUserId !== scope.user.id)) {
      throw new MonthlyAttendanceServiceError("只能查看本人月度考勤", 403, "forbidden");
    }
    return [scope.user.id];
  }
  if (!['manager', 'admin'].includes(scope.user.role)) throw new MonthlyAttendanceServiceError("无权查看月度考勤", 403, "forbidden");
  return selfUserId ? [selfUserId] : undefined;
}

export async function getMonthlyAttendance(scope: StoreScope, month: string, selfUserId?: string) {
  const targetUserIds = assertReadScope(scope, selfUserId);
  return (await buildMonthlyRows(prisma, scope, month, targetUserIds)).map((item) => item.row);
}

function assertManager(scope: StoreScope) {
  if (scope.user.role !== "manager" || !scope.user.storeId || scope.storeId !== scope.user.storeId) {
    throw new MonthlyAttendanceServiceError("只有本店经理可以确认月度考勤", 403, "forbidden");
  }
}

async function assertSelectedEmployees(tx: Prisma.TransactionClient, scope: StoreScope, userIds: string[]) {
  if (new Set(userIds).size !== userIds.length) throw new MonthlyAttendanceServiceError("员工不得重复", 400, "duplicate_user");
  const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, role: true, storeId: true } });
  if (users.length !== userIds.length) throw new MonthlyAttendanceServiceError("员工不存在", 404, "employee_not_found");
  if (users.some((user) => user.role !== "employee" || user.storeId !== scope.storeId)) {
    throw new MonthlyAttendanceServiceError("只能处理本店当前员工", 403, "cross_store");
  }
}

export async function confirmMonthlyAttendance(scope: StoreScope, input: MonthlyConfirmInput, now = getAttendanceNow()) {
  assertManager(scope);
  assertMonthNotFuture(input.month, now);
  try {
    return await prisma.$transaction(async (tx) => {
      const userIds = input.rows.map((row) => row.userId);
      await assertSelectedEmployees(tx, scope, userIds);
      const built = await buildMonthlyRows(tx, scope, input.month, userIds);
      const byUser = new Map(built.map((item) => [item.row.userId, item]));
      const requested = input.rows.map((item) => {
        const current = byUser.get(item.userId);
        if (!current) throw new MonthlyAttendanceServiceError("员工不存在", 404, "employee_not_found");
        if (current.row.status === "confirmed" || current.row.revision !== item.expectedRevision || current.row.sourceHash !== item.expectedSourceHash) {
          throw new MonthlyAttendanceServiceError("月度考勤数据已变化，请刷新", 409, "stale", { userId: item.userId });
        }
        return { ...current, requested: item, row: { ...current.row, zeroAttendanceAction: item.zeroAttendanceAction } };
      });
      const validation = validateMonthlyConfirmation(requested.map((item) => item.row));
      if (!validation.ok) throw new MonthlyAttendanceServiceError("月度考勤存在阻断项", 409, "blocked", validation.blocked);
      const confirmedAt = now;
      for (const item of requested) {
        const sourceSnapshotJson = serializeMonthlySnapshot(item.snapshot);
        const existing = item.row.revision > 0
          ? await tx.monthlyAttendanceConfirmation.findUnique({ where: { userId_month: { userId: item.row.userId, month: input.month } } })
          : null;
        let confirmationId: string;
        let nextRevision: number;
        if (!existing) {
          if (item.requested.expectedRevision !== 0) throw new MonthlyAttendanceServiceError("月度考勤版本已变化", 409, "stale");
          const created = await tx.monthlyAttendanceConfirmation.create({ data: {
            storeId: scope.storeId,
            userId: item.row.userId,
            month: input.month,
            status: "confirmed",
            zeroAttendanceAction: item.requested.zeroAttendanceAction,
            revision: 1,
            sourceHash: item.row.sourceHash,
            sourceSnapshotJson,
            confirmedById: scope.user.id,
            confirmedAt,
          } });
          confirmationId = created.id;
          nextRevision = 1;
        } else {
          const changed = await tx.monthlyAttendanceConfirmation.updateMany({
            where: { id: existing.id, storeId: scope.storeId, userId: item.row.userId, month: input.month, status: "unconfirmed", revision: item.requested.expectedRevision },
            data: {
              status: "confirmed",
              zeroAttendanceAction: item.requested.zeroAttendanceAction,
              revision: { increment: 1 },
              sourceHash: item.row.sourceHash,
              sourceSnapshotJson,
              confirmedById: scope.user.id,
              confirmedAt,
            },
          });
          if (changed.count !== 1) throw new MonthlyAttendanceServiceError("月度考勤版本已变化", 409, "stale");
          confirmationId = existing.id;
          nextRevision = item.requested.expectedRevision + 1;
        }
        await tx.monthlyAttendanceAuditEvent.create({ data: {
          confirmationId,
          storeId: scope.storeId,
          userId: item.row.userId,
          month: input.month,
          eventType: "confirmed",
          fromStatus: existing ? "unconfirmed" : "absent",
          toStatus: "confirmed",
          revision: nextRevision,
          zeroAttendanceAction: item.requested.zeroAttendanceAction,
          actorId: scope.user.id,
          reason: "manager_confirmed",
          sourceRef: `monthly:${input.month}`,
          sourceHash: item.row.sourceHash,
          sourceSnapshotJson,
        } });
      }
      return { count: requested.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof MonthlyAttendanceServiceError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
      throw new MonthlyAttendanceServiceError("月度考勤版本已变化", 409, "stale");
    }
    throw error;
  }
}

export async function unconfirmMonthlyAttendance(scope: StoreScope, input: MonthlyUnconfirmInput) {
  assertManager(scope);
  try {
    return await prisma.$transaction(async (tx) => {
      const userIds = input.rows.map((row) => row.userId);
      await assertSelectedEmployees(tx, scope, userIds);
      const expected = new Map(input.rows.map((row) => [row.userId, row.expectedRevision]));
      const rows = await tx.monthlyAttendanceConfirmation.findMany({ where: { storeId: scope.storeId, month: input.month, userId: { in: userIds } } });
      if (rows.length !== userIds.length || rows.some((row) => row.status !== "confirmed" || row.revision !== expected.get(row.userId))) {
        throw new MonthlyAttendanceServiceError("月度考勤状态已变化", 409, "stale");
      }
      for (const row of rows) {
        const changed = await tx.monthlyAttendanceConfirmation.updateMany({
          where: { id: row.id, storeId: scope.storeId, month: input.month, userId: row.userId, status: "confirmed", revision: row.revision },
          data: { status: "unconfirmed", revision: { increment: 1 }, zeroAttendanceAction: "none", confirmedById: null, confirmedAt: null, sourceHash: null, sourceSnapshotJson: null },
        });
        if (changed.count !== 1) throw new MonthlyAttendanceServiceError("月度考勤状态已变化", 409, "stale");
        await tx.monthlyAttendanceAuditEvent.create({ data: {
          confirmationId: row.id,
          storeId: scope.storeId,
          userId: row.userId,
          month: input.month,
          eventType: "unconfirmed",
          fromStatus: "confirmed",
          toStatus: "unconfirmed",
          revision: row.revision + 1,
          zeroAttendanceAction: row.zeroAttendanceAction,
          actorId: scope.user.id,
          reason: "manager_unconfirmed",
          sourceRef: `monthly:${input.month}`,
          sourceHash: row.sourceHash,
          sourceSnapshotJson: row.sourceSnapshotJson,
        } });
      }
      return { count: rows.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof MonthlyAttendanceServiceError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new MonthlyAttendanceServiceError("月度考勤状态已变化", 409, "stale");
    }
    throw error;
  }
}
