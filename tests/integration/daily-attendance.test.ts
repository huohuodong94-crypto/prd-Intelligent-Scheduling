import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { createClockCode } from "@/features/attendance/server/clock-code";
import {
  confirmDailyExceptions,
  listDailyAttendance,
  listOwnPunches,
  listPunches,
  punchWithCode,
  recalculateDailyAttendance,
  syncAttendancePunchStateFromLatest,
  unconfirmDailyExceptions,
} from "@/features/attendance/server/attendance-service";
import { createManagerProxyApproval, decideApprovals } from "@/features/approvals/server/approval-service";
import { getDashboardSummary } from "@/features/dashboard/server/dashboard-service";
import { prisma, resetTestDb } from "../helpers/test-db";

const employee: SessionUser = { id: "t7-employee", name: "员工", phone: "13870000001", role: "employee", storeId: "t7-store" };

beforeEach(async () => {
  await resetTestDb();
  await prisma.store.create({ data: { id: "t7-store", name: "T7 店", code: "T7" } });
  await prisma.user.create({ data: { ...employee, employeeNo: "T7-001", position: "sales" } });
});
afterAll(() => prisma.$disconnect());

describe("Task 7 SQLite punch service", () => {
  it("uses the employee session, rejects matched-window replay and adjacent same direction", async () => {
    const secret = "task7-integration-secret";
    const now = new Date("2026-07-20T09:10:00+08:00");
    const code = createClockCode("t7-store", now, secret).code;
    const row = await punchWithCode(employee, { direction: "in", code }, now, secret);
    expect(row).toMatchObject({ userId: employee.id, storeId: "t7-store", direction: "in", viaCode: true });
    await expect(punchWithCode(employee, { direction: "out", code }, now, secret)).rejects.toMatchObject({ status: 409, code: "replay" });
    const next = new Date(now.getTime() + 60_000);
    await expect(punchWithCode(employee, { direction: "in", code: createClockCode("t7-store", next, secret).code }, next, secret)).rejects.toMatchObject({ status: 409, code: "same_direction" });
  });

  it("bootstraps direction from an existing latest record when punch state is absent", async () => {
    const secret = "task7-integration-secret";
    const now = new Date("2026-07-20T09:10:00+08:00");
    await prisma.attendanceRecord.create({ data: { userId: employee.id, storeId: "t7-store", time: new Date(now.getTime() - 60_000), direction: "in", viaCode: false, corrected: true } });
    expect(await prisma.attendancePunchState.findUnique({ where: { userId: employee.id } })).toBeNull();
    await expect(punchWithCode(employee, { direction: "in", code: createClockCode("t7-store", now, secret).code }, now, secret)).rejects.toMatchObject({ status: 409, code: "same_direction" });
    expect(await prisma.attendanceRecord.count({ where: { userId: employee.id } })).toBe(1);
  });

  it("does not let an invalid legacy latest record block the first valid dynamic-code punch", async () => {
    const secret = "task7-integration-secret";
    const now = new Date("2026-07-20T09:10:00+08:00");
    await prisma.attendanceRecord.create({ data: {
      userId: employee.id,
      storeId: "t7-store",
      time: new Date(now.getTime() - 60_000),
      direction: "in",
      viaCode: false,
      corrected: false,
    } });

    const row = await punchWithCode(employee, { direction: "in", code: createClockCode("t7-store", now, secret).code }, now, secret);

    expect(row).toMatchObject({ direction: "in", viaCode: true, corrected: false });
    expect(await prisma.attendancePunchState.findUniqueOrThrow({ where: { userId: employee.id } })).toMatchObject({ lastDirection: "in", version: 1 });
  });

  it("syncs punch state from the latest dynamic-code or corrected canonical fact while ignoring newer legacy records", async () => {
    await prisma.attendanceRecord.createMany({ data: [
      { userId: employee.id, storeId: "t7-store", time: new Date("2026-07-20T09:00:00+08:00"), direction: "in", viaCode: true, corrected: false },
      { userId: employee.id, storeId: "t7-store", time: new Date("2026-07-20T10:00:00+08:00"), direction: "out", viaCode: false, corrected: false },
    ] });
    await prisma.$transaction((tx) => syncAttendancePunchStateFromLatest(tx, employee.id, "t7-store"));
    expect(await prisma.attendancePunchState.findUniqueOrThrow({ where: { userId: employee.id } })).toMatchObject({ lastDirection: "in", version: 1 });

    await prisma.attendancePunchState.delete({ where: { userId: employee.id } });
    await prisma.attendanceRecord.deleteMany({ where: { userId: employee.id } });
    await prisma.attendanceRecord.createMany({ data: [
      { userId: employee.id, storeId: "t7-store", time: new Date("2026-07-20T11:00:00+08:00"), direction: "out", viaCode: false, corrected: true },
      { userId: employee.id, storeId: "t7-store", time: new Date("2026-07-20T12:00:00+08:00"), direction: "in", viaCode: false, corrected: false },
    ] });
    await prisma.$transaction((tx) => syncAttendancePunchStateFromLatest(tx, employee.id, "t7-store"));
    expect(await prisma.attendancePunchState.findUniqueOrThrow({ where: { userId: employee.id } })).toMatchObject({ lastDirection: "out", version: 1 });
  });

  it("allows exactly one concurrent use of the same matched window", async () => {
    const secret = "task7-integration-secret";
    const now = new Date("2026-07-20T09:10:00+08:00");
    const input = { direction: "in" as const, code: createClockCode("t7-store", now, secret).code };
    const settled = await Promise.allSettled([
      punchWithCode(employee, input, now, secret),
      punchWithCode(employee, input, now, secret),
    ]);
    expect(settled.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    const loser = settled.find((row) => row.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toMatchObject({ status: 409 });
    expect(await prisma.attendanceRecord.count({ where: { userId: employee.id } })).toBe(1);
    expect(await prisma.attendancePunchState.findUniqueOrThrow({ where: { userId: employee.id } })).toMatchObject({ lastDirection: "in", version: 1 });
  });

  it("keeps state and records consistent under adjacent-direction CAS contention", async () => {
    const secret = "task7-integration-secret";
    const first = new Date("2026-07-20T09:10:00+08:00");
    await punchWithCode(employee, { direction: "in", code: createClockCode("t7-store", first, secret).code }, first, secret);
    const a = new Date(first.getTime() + 60_000);
    const b = new Date(first.getTime() + 120_000);
    const settled = await Promise.allSettled([
      punchWithCode(employee, { direction: "out", code: createClockCode("t7-store", a, secret).code }, a, secret),
      punchWithCode(employee, { direction: "out", code: createClockCode("t7-store", b, secret).code }, b, secret),
    ]);
    expect(settled.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect((settled.find((row) => row.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    expect(await prisma.attendanceRecord.count({ where: { userId: employee.id } })).toBe(2);
    expect(await prisma.attendancePunchState.findUniqueOrThrow({ where: { userId: employee.id } })).toMatchObject({ lastDirection: "out", version: 2 });
  });

  it("computes daily attendance from dynamic-code punches and approved corrections but ignores legacy raw records", async () => {
    const manager: SessionUser = { id: "t7-manager", name: "经理", phone: "13870000002", role: "manager", storeId: "t7-store" };
    await prisma.user.create({ data: manager });
    const plan = await prisma.schedulePlan.create({ data: { storeId: "t7-store", weekOf: "2026-07-20", mode: "work5rest2", status: "published", version: 1, createdById: manager.id, publishedAt: new Date() } });
    await prisma.schedule.createMany({ data: [
      { storeId: "t7-store", planId: plan.id, userId: employee.id, date: new Date("2026-07-20T00:00:00+08:00"), weekOf: plan.weekOf, shiftType: "morning" },
      { storeId: "t7-store", planId: plan.id, userId: employee.id, date: new Date("2026-07-21T00:00:00+08:00"), weekOf: plan.weekOf, shiftType: "morning" },
      { storeId: "t7-store", planId: plan.id, userId: employee.id, date: new Date("2026-07-22T00:00:00+08:00"), weekOf: plan.weekOf, shiftType: "morning" },
    ] });
    await prisma.attendanceRecord.createMany({ data: [
      { userId: employee.id, storeId: "t7-store", time: new Date("2026-07-20T09:00:00+08:00"), direction: "in", viaCode: false, corrected: false },
      { userId: employee.id, storeId: "t7-store", time: new Date("2026-07-20T13:00:00+08:00"), direction: "out", viaCode: false, corrected: false },
      { userId: employee.id, storeId: "t7-store", time: new Date("2026-07-21T09:00:00+08:00"), direction: "in", viaCode: true, corrected: false },
      { userId: employee.id, storeId: "t7-store", time: new Date("2026-07-21T13:00:00+08:00"), direction: "out", viaCode: true, corrected: false },
    ] });
    await prisma.punchCorrection.createMany({ data: [
      { userId: employee.id, date: new Date("2026-07-22T00:00:00+08:00"), requestedTime: new Date("2026-07-22T09:00:00+08:00"), direction: "in", status: "approved" },
      { userId: employee.id, date: new Date("2026-07-22T00:00:00+08:00"), requestedTime: new Date("2026-07-22T13:00:00+08:00"), direction: "out", status: "approved" },
    ] });
    const scope = { user: manager, storeId: "t7-store" };

    await recalculateDailyAttendance(scope, { from: "2026-07-20", to: "2026-07-22" });

    expect((await listDailyAttendance(scope, { from: "2026-07-20", to: "2026-07-20" })).map((row) => row.type)).toEqual(["missing_in", "missing_out"]);
    expect(await listDailyAttendance(scope, { from: "2026-07-21", to: "2026-07-21" })).toEqual([]);
    expect(await listDailyAttendance(scope, { from: "2026-07-22", to: "2026-07-22" })).toEqual([]);
  });

  it("persists current exception overlays and keeps confirmed disappeared rows only as audit", async () => {
    const manager: SessionUser = { id: "t7-manager", name: "经理", phone: "13870000002", role: "manager", storeId: "t7-store" };
    await prisma.user.create({ data: manager });
    const plan = await prisma.schedulePlan.create({ data: { storeId: "t7-store", weekOf: "2026-07-20", mode: "work5rest2", status: "published", version: 1, createdById: manager.id, publishedAt: new Date() } });
    await prisma.schedule.create({ data: { storeId: "t7-store", planId: plan.id, userId: employee.id, date: new Date("2026-07-20T00:00:00+08:00"), weekOf: plan.weekOf, shiftType: "morning" } });
    const scope = { user: manager, storeId: "t7-store" };
    await recalculateDailyAttendance(scope, { from: "2026-07-20", to: "2026-07-20" });
    let rows = await listDailyAttendance(scope, { from: "2026-07-20", to: "2026-07-20" });
    expect(rows.map((row) => row.type)).toEqual(["missing_in", "missing_out"]);
    const missingIn = rows.find((row) => row.type === "missing_in")!;
    await confirmDailyExceptions(scope, [{ id: missingIn.id, revision: missingIn.revision }]);
    await prisma.attendanceRecord.createMany({ data: [
      { userId: employee.id, storeId: "t7-store", time: new Date("2026-07-20T09:00:00+08:00"), direction: "in", viaCode: true },
      { userId: employee.id, storeId: "t7-store", time: new Date("2026-07-20T13:00:00+08:00"), direction: "out", viaCode: true },
    ] });
    await recalculateDailyAttendance(scope, { from: "2026-07-20", to: "2026-07-20" });
    rows = await listDailyAttendance(scope, { from: "2026-07-20", to: "2026-07-20" });
    expect(rows).toEqual([]);
    expect(await prisma.attendanceExceptionConfirmation.findUniqueOrThrow({ where: { id: missingIn.id } })).toMatchObject({ status: "confirmed", active: false, revision: 2 });
    expect(await prisma.attendanceExceptionConfirmation.count({ where: { status: "unconfirmed" } })).toBe(0);

    await prisma.attendanceRecord.deleteMany({ where: { userId: employee.id } });
    await recalculateDailyAttendance(scope, { from: "2026-07-20", to: "2026-07-20" });
    rows = await listDailyAttendance(scope, { from: "2026-07-20", to: "2026-07-20" });
    const reappeared = rows.find((row) => row.type === "missing_in")!;
    expect(reappeared).toMatchObject({ id: missingIn.id, status: "unconfirmed", revision: 3 });
    await expect(confirmDailyExceptions(scope, [{ id: missingIn.id, revision: 1 }])).rejects.toMatchObject({ status: 409 });
    expect(await prisma.attendanceExceptionConfirmation.findUniqueOrThrow({ where: { id: missingIn.id } })).toMatchObject({ status: "unconfirmed", revision: 3 });
    expect(await prisma.attendanceExceptionConfirmation.findUniqueOrThrow({ where: { id: missingIn.id } })).toMatchObject({ active: true, revision: 3, confirmedById: null, confirmedAt: null });
    expect(await prisma.attendanceAuditEvent.count({ where: { subjectId: missingIn.id, action: { in: ["daily.disappeared", "daily.reappeared"] } } })).toBe(2);
  });

  it("uses all-or-nothing same-type CAS for confirm and unconfirm", async () => {
    const manager: SessionUser = { id: "t7-manager", name: "经理", phone: "13870000002", role: "manager", storeId: "t7-store" };
    await prisma.user.create({ data: manager });
    const scope = { user: manager, storeId: "t7-store" };
    const date = new Date("2026-07-20T00:00:00+08:00");
    const secondEmployee = await prisma.user.create({ data: { id: "t7-employee-2", name: "员工二", phone: "13870000004", role: "employee", storeId: "t7-store", employeeNo: "T7-002", position: "sales" } });
    const rows = await Promise.all([
      prisma.attendanceExceptionConfirmation.create({ data: { storeId: "t7-store", userId: employee.id, date, type: "late" } }),
      prisma.attendanceExceptionConfirmation.create({ data: { storeId: "t7-store", userId: secondEmployee.id, date, type: "late" } }),
    ]);
    await confirmDailyExceptions(scope, rows.map((row) => ({ id: row.id, revision: row.revision })));
    const confirmed = await prisma.attendanceExceptionConfirmation.findMany({ where: { id: { in: rows.map((row) => row.id) } }, orderBy: { userId: "asc" } });
    expect(confirmed.every((row) => row.status === "confirmed" && row.revision === 2)).toBe(true);
    await expect(unconfirmDailyExceptions(scope, rows.map((row) => ({ id: row.id, revision: 1 })))).rejects.toMatchObject({ status: 409 });
    expect(await prisma.attendanceExceptionConfirmation.count({ where: { id: { in: rows.map((row) => row.id) }, status: "confirmed", revision: 2 } })).toBe(2);
    await unconfirmDailyExceptions(scope, confirmed.map((row) => ({ id: row.id, revision: row.revision })));
    const roundTrip = await prisma.attendanceExceptionConfirmation.findMany({ where: { id: { in: rows.map((row) => row.id) } }, orderBy: { userId: "asc" } });
    expect(roundTrip.every((row) => row.status === "unconfirmed" && row.revision === 3 && row.confirmedAt === null && row.confirmedById === null)).toBe(true);
    await expect(confirmDailyExceptions(scope, [
      { id: roundTrip[0].id, revision: 1 },
      { id: roundTrip[1].id, revision: roundTrip[1].revision },
    ])).rejects.toMatchObject({ status: 409 });
    expect(await prisma.attendanceExceptionConfirmation.count({ where: { id: { in: rows.map((row) => row.id) }, status: "unconfirmed", revision: 3 } })).toBe(2);
    const transitions = await prisma.attendanceAuditEvent.findMany({ where: { subjectId: { in: rows.map((row) => row.id) }, action: { in: ["daily.confirmed", "daily.unconfirmed"] } }, orderBy: { createdAt: "asc" } });
    expect(transitions.map((event) => JSON.parse(event.metadataJson ?? "{}"))).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromRevision: 1, toRevision: 2 }),
      expect.objectContaining({ fromRevision: 2, toRevision: 3 }),
    ]));
  });

  it("allows only one concurrent transition for the same revision", async () => {
    const manager: SessionUser = { id: "t7-manager", name: "经理", phone: "13870000002", role: "manager", storeId: "t7-store" };
    await prisma.user.create({ data: { ...manager, position: null } });
    const scope = { user: manager, storeId: "t7-store" };
    const row = await prisma.attendanceExceptionConfirmation.create({ data: { storeId: "t7-store", userId: employee.id, date: new Date("2026-07-20T00:00:00+08:00"), type: "late" } });
    const settled = await Promise.allSettled([
      confirmDailyExceptions(scope, [{ id: row.id, revision: row.revision }]),
      confirmDailyExceptions(scope, [{ id: row.id, revision: row.revision }]),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((settled.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    expect(await prisma.attendanceExceptionConfirmation.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "confirmed", revision: 2 });
    expect(await prisma.attendanceAuditEvent.count({ where: { subjectId: row.id, action: "daily.confirmed" } })).toBe(1);
  });

  it("rolls back mixed-type and cross-store transitions", async () => {
    const manager: SessionUser = { id: "t7-manager", name: "经理", phone: "13870000002", role: "manager", storeId: "t7-store" };
    const foreignStore = await prisma.store.create({ data: { id: "t7-foreign-store", name: "外店", code: "T7F" } });
    const foreign = await prisma.user.create({ data: { id: "t7-foreign", name: "外店员工", phone: "13870000003", role: "employee", storeId: foreignStore.id, employeeNo: "T7F-001", position: "sales" } });
    await prisma.user.create({ data: { ...manager, position: null } });
    const scope = { user: manager, storeId: "t7-store" };
    const date = new Date("2026-07-20T00:00:00+08:00");
    const mixed = await Promise.all([
      prisma.attendanceExceptionConfirmation.create({ data: { storeId: "t7-store", userId: employee.id, date, type: "late" } }),
      prisma.attendanceExceptionConfirmation.create({ data: { storeId: "t7-store", userId: employee.id, date, type: "missing_in" } }),
    ]);
    await expect(confirmDailyExceptions(scope, mixed.map((row) => ({ id: row.id, revision: row.revision })))).rejects.toMatchObject({ status: 409 });
    expect(await prisma.attendanceExceptionConfirmation.count({ where: { id: { in: mixed.map((row) => row.id) }, status: "unconfirmed" } })).toBe(2);
    const foreignRow = await prisma.attendanceExceptionConfirmation.create({ data: { storeId: foreignStore.id, userId: foreign.id, date, type: "late" } });
    await expect(confirmDailyExceptions(scope, [{ id: foreignRow.id, revision: foreignRow.revision }])).rejects.toMatchObject({ status: 403 });
    expect(await prisma.attendanceExceptionConfirmation.findUniqueOrThrow({ where: { id: foreignRow.id } })).toMatchObject({ status: "unconfirmed", revision: 1 });
  });

  it("scopes punch history by store, date, employee, direction and source", async () => {
    const manager: SessionUser = { id: "t7-manager", name: "经理", phone: "13870000002", role: "manager", storeId: "t7-store" };
    const foreignStore = await prisma.store.create({ data: { id: "t7-foreign-store", name: "外店", code: "T7F" } });
    const foreign: SessionUser = { id: "t7-foreign", name: "外店员工", phone: "13870000003", role: "employee", storeId: foreignStore.id };
    await prisma.user.createMany({ data: [{ ...manager, position: null }, { ...foreign, employeeNo: "T7F-001", position: "sales" }] });
    await prisma.attendanceRecord.createMany({ data: [
      { userId: employee.id, storeId: "t7-store", time: new Date("2026-07-20T09:00:00+08:00"), direction: "in", viaCode: true },
      { userId: employee.id, storeId: "t7-store", time: new Date("2026-07-20T13:00:00+08:00"), direction: "out", corrected: true },
      { userId: employee.id, storeId: "t7-store", time: new Date("2026-07-20T15:00:00+08:00"), direction: "in", viaCode: false, corrected: false },
      { userId: foreign.id, storeId: foreignStore.id, time: new Date("2026-07-20T09:00:00+08:00"), direction: "in", viaCode: true },
    ] });
    const scope = { user: manager, storeId: "t7-store" };
    const rows = await listPunches(scope, { from: "2026-07-20", to: "2026-07-20", userId: employee.id, direction: "out", source: "correction" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ storeId: "t7-store", userId: employee.id, direction: "out", source: "correction", valid: true });
    const all = await listPunches(scope, { from: "2026-07-20", to: "2026-07-20", userId: employee.id });
    expect(all.map((row) => ({ source: row.source, valid: row.valid }))).toEqual([
      { source: "legacy", valid: false },
      { source: "correction", valid: true },
      { source: "dynamic_code", valid: true },
    ]);
    const own = await listOwnPunches(employee);
    expect(own.map((row) => ({ source: row.source, valid: row.valid }))).toEqual([
      { source: "legacy", valid: false },
      { source: "correction", valid: true },
      { source: "dynamic_code", valid: true },
    ]);
  });

  it("rejects every invalid recalculation target atomically instead of filtering it", async () => {
    const manager: SessionUser = { id: "t7-manager", name: "经理", phone: "13870000002", role: "manager", storeId: "t7-store" };
    const foreignStore = await prisma.store.create({ data: { id: "t7-foreign-store", name: "外店", code: "T7F" } });
    const foreign = await prisma.user.create({ data: { id: "t7-foreign", name: "外店员工", phone: "13870000003", role: "employee", storeId: foreignStore.id, employeeNo: "T7F-001", position: "sales" } });
    await prisma.user.create({ data: { ...manager, position: null } });
    const scope = { user: manager, storeId: "t7-store" };
    const beforeAudit = await prisma.attendanceAuditEvent.count();
    await expect(recalculateDailyAttendance(scope, { from: "2026-07-20", to: "2026-07-20", userIds: [employee.id, foreign.id] })).rejects.toMatchObject({ status: 403 });
    await expect(recalculateDailyAttendance(scope, { from: "2026-07-20", to: "2026-07-20", userIds: [manager.id] })).rejects.toMatchObject({ status: 403 });
    await expect(recalculateDailyAttendance(scope, { from: "2026-07-20", to: "2026-07-20", userIds: ["does-not-exist"] })).rejects.toMatchObject({ status: 404 });
    expect(await prisma.attendanceExceptionConfirmation.count()).toBe(0);
    expect(await prisma.attendanceAuditEvent.count()).toBe(beforeAudit);
  });

  it("creates same-store pending proxy requests and recalculates only after a decision", async () => {
    const manager: SessionUser = { id: "t7-manager", name: "经理", phone: "13870000002", role: "manager", storeId: "t7-store" };
    await prisma.user.create({ data: { ...manager, position: null } });
    const plan = await prisma.schedulePlan.create({ data: { storeId: "t7-store", weekOf: "2026-07-20", mode: "work5rest2", status: "published", version: 1, createdById: manager.id, publishedAt: new Date() } });
    await prisma.schedule.create({ data: { storeId: "t7-store", planId: plan.id, userId: employee.id, date: new Date("2026-07-20T00:00:00+08:00"), weekOf: plan.weekOf, shiftType: "morning" } });
    const scope = { user: manager, storeId: "t7-store" };
    await recalculateDailyAttendance(scope, { from: "2026-07-20", to: "2026-07-20" });
    expect(await prisma.attendanceExceptionConfirmation.count({ where: { active: true } })).toBe(2);
    const leave = await createManagerProxyApproval(scope, { action: "proxy_leave", userId: employee.id, type: "annual", startTime: "2026-07-20T09:00:00+08:00", endTime: "2026-07-20T13:00:00+08:00", isFullDay: false, reason: "门店代提" });
    expect(leave).toMatchObject({ userId: employee.id, status: "pending" });
    expect(await prisma.attendanceExceptionConfirmation.count({ where: { active: true } })).toBe(2);
    await decideApprovals(scope, { items: [{ type: "leave", id: leave.id }], decision: "approved", reason: "同意", aiLogIds: [] });
    expect(await prisma.attendanceExceptionConfirmation.count({ where: { active: true } })).toBe(0);
    expect((await getDashboardSummary("t7-store")).attendanceExceptionCount).toBe(0);
  });

  it("recalculates affected dates after approved corrections and rejected proxies", async () => {
    const manager: SessionUser = { id: "t7-manager", name: "经理", phone: "13870000002", role: "manager", storeId: "t7-store" };
    await prisma.user.create({ data: { ...manager, position: null } });
    const plan = await prisma.schedulePlan.create({ data: { storeId: "t7-store", weekOf: "2026-07-20", mode: "work5rest2", status: "published", version: 1, createdById: manager.id, publishedAt: new Date() } });
    await prisma.schedule.createMany({ data: [
      { storeId: "t7-store", planId: plan.id, userId: employee.id, date: new Date("2026-07-20T00:00:00+08:00"), weekOf: plan.weekOf, shiftType: "morning" },
      { storeId: "t7-store", planId: plan.id, userId: employee.id, date: new Date("2026-07-21T00:00:00+08:00"), weekOf: plan.weekOf, shiftType: "morning" },
    ] });
    const scope = { user: manager, storeId: "t7-store" };
    await recalculateDailyAttendance(scope, { from: "2026-07-20", to: "2026-07-21" });
    const correction = await createManagerProxyApproval(scope, { action: "proxy_punch_correction", userId: employee.id, date: "2026-07-20", direction: "in", requestedTime: "2026-07-20T09:00:00+08:00", reason: "漏打卡" });
    expect(await prisma.attendanceExceptionConfirmation.count({ where: { date: new Date("2026-07-20T00:00:00+08:00"), active: true } })).toBe(2);
    await decideApprovals(scope, { items: [{ type: "punch_correction", id: correction.id }], decision: "approved", reason: "确认漏卡", aiLogIds: [] });
    expect(await prisma.attendanceExceptionConfirmation.findMany({ where: { date: new Date("2026-07-20T00:00:00+08:00"), active: true }, select: { type: true } })).toEqual([{ type: "missing_out" }]);

    const rejected = await createManagerProxyApproval(scope, { action: "proxy_punch_correction", userId: employee.id, date: "2026-07-21", direction: "in", requestedTime: "2026-07-21T09:00:00+08:00", reason: "待核实" });
    const beforeAudit = await prisma.attendanceAuditEvent.count({ where: { action: "daily.recalculated" } });
    await decideApprovals(scope, { items: [{ type: "punch_correction", id: rejected.id }], decision: "rejected", reason: "证据不足", aiLogIds: [] });
    expect(await prisma.attendanceExceptionConfirmation.count({ where: { date: new Date("2026-07-21T00:00:00+08:00"), active: true } })).toBe(2);
    expect(await prisma.attendanceAuditEvent.count({ where: { action: "daily.recalculated" } })).toBe(beforeAudit + 1);
  });

  it("rejects proxy targets outside the manager's employee scope", async () => {
    const manager: SessionUser = { id: "t7-manager", name: "经理", phone: "13870000002", role: "manager", storeId: "t7-store" };
    const foreignStore = await prisma.store.create({ data: { id: "t7-foreign-store", name: "外店", code: "T7F" } });
    const foreign: SessionUser = { id: "t7-foreign", name: "外店员工", phone: "13870000003", role: "employee", storeId: foreignStore.id };
    await prisma.user.createMany({ data: [{ ...manager, position: null }, { ...foreign, employeeNo: "T7F-001", position: "sales" }] });
    const scope = { user: manager, storeId: "t7-store" };
    await expect(createManagerProxyApproval(scope, { action: "proxy_punch_correction", userId: foreign.id, date: "2026-07-20", direction: "in", requestedTime: "2026-07-20T09:00:00+08:00", reason: "越店" })).rejects.toMatchObject({ status: 403 });
    await expect(createManagerProxyApproval(scope, { action: "proxy_punch_correction", userId: manager.id, date: "2026-07-20", direction: "in", requestedTime: "2026-07-20T09:00:00+08:00", reason: "错误目标" })).rejects.toMatchObject({ status: 403 });
  });

  it("counts only current active unconfirmed exceptions on the dashboard", async () => {
    const manager: SessionUser = { id: "t7-manager", name: "经理", phone: "13870000002", role: "manager", storeId: "t7-store" };
    await prisma.user.create({ data: { ...manager, position: null } });
    const date = new Date("2026-07-20T00:00:00+08:00");
    await prisma.attendanceExceptionConfirmation.createMany({ data: [
      { storeId: "t7-store", userId: employee.id, date, type: "late", status: "unconfirmed", active: true },
      { storeId: "t7-store", userId: employee.id, date, type: "missing_in", status: "unconfirmed", active: false },
      { storeId: "t7-store", userId: employee.id, date, type: "missing_out", status: "confirmed", active: true },
    ] });
    expect((await getDashboardSummary("t7-store")).attendanceExceptionCount).toBe(1);
  });
});
