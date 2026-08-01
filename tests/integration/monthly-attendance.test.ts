import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireSession: sessionState.requireSession }));

import {
  confirmMonthlyAttendance,
  getMonthlyAttendance,
  MonthlyAttendanceServiceError,
  unconfirmMonthlyAttendance,
} from "@/features/attendance/server/monthly-attendance-service";
import {
  calculateDailyRows,
  confirmDailyExceptions,
  loadDailyAttendanceFactsInTransaction,
  punchWithCode,
  recalculateDailyAttendance,
  unconfirmDailyExceptions,
} from "@/features/attendance/server/attendance-service";
import { createClockCode } from "@/features/attendance/server/clock-code";
import { decideApprovals } from "@/features/approvals/server/approval-service";
import {
  commitImport,
  copyHistory,
  publishSchedule,
  restoreRecommendation,
  saveDraft,
} from "@/features/scheduling/server/schedule-command-service";
import type { StoreScope } from "@/lib/authorization";
import { prisma, resetTestDb } from "../helpers/test-db";

beforeEach(resetTestDb);

async function fixture() {
  const store = await prisma.store.create({ data: { id: "store-a", name: "A", code: "A" } });
  const otherStore = await prisma.store.create({ data: { id: "store-b", name: "B", code: "B" } });
  const manager = await prisma.user.create({ data: { id: "manager-a", phone: "m-a", name: "店长", role: "manager", storeId: store.id } });
  const employee = await prisma.user.create({ data: { id: "employee-a", phone: "e-a", employeeNo: "A001", name: "小王", role: "employee", storeId: store.id, position: "sales" } });
  const otherEmployee = await prisma.user.create({ data: { id: "employee-b", phone: "e-b", employeeNo: "B001", name: "小李", role: "employee", storeId: otherStore.id, position: "sales" } });
  const plan = await prisma.schedulePlan.create({ data: { id: "plan-a", storeId: store.id, weekOf: "2026-07-20", status: "published", version: 1, createdById: manager.id, publishedAt: new Date() } });
  await prisma.schedule.create({ data: { id: "schedule-a", storeId: store.id, userId: employee.id, date: new Date("2026-07-20T00:00:00+08:00"), shiftType: "morning", weekOf: "2026-07-20", planId: plan.id } });
  return { store, otherStore, manager, employee, otherEmployee };
}

function scope(user: { id: string; name: string; role: string; storeId: string | null; phone: string }, storeId: string): StoreScope {
  return { user: user as StoreScope["user"], storeId };
}

async function confirmCurrentExceptions(managerId: string, storeId: string, userId: string) {
  await prisma.attendanceExceptionConfirmation.createMany({ data: ["missing_in", "missing_out"].map((type, index) => ({
    id: `confirmed-${type}-${index}`,
    storeId,
    userId,
    date: new Date("2026-07-20T00:00:00+08:00"),
    type,
    status: "confirmed",
    active: true,
    revision: 2,
    confirmedById: managerId,
    confirmedAt: new Date("2026-07-20T14:00:00+08:00"),
  })) });
}

async function createConfirmedMonth(storeId: string, userId: string, managerId: string, month = "2026-07") {
  return prisma.monthlyAttendanceConfirmation.create({ data: {
    storeId,
    userId,
    month,
    status: "confirmed",
    revision: 1,
    zeroAttendanceAction: "normal_attendance",
    sourceHash: "a".repeat(64),
    sourceSnapshotJson: JSON.stringify({ storeId, userId, month }),
    confirmedById: managerId,
    confirmedAt: new Date("2026-07-19T00:00:00+08:00"),
  } });
}

async function makeSchedulable(storeId: string, managerId: string, userIds: string[]) {
  await prisma.storeOperatingDay.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ storeId, dayOfWeek, isOpen: true, openTime: "09:00", closeTime: "21:00" })) });
  const area = await prisma.workArea.create({ data: { storeId, name: "卖场", code: `AREA-${storeId}` } });
  const group = await prisma.workGroup.create({ data: { storeId, name: "销售组", leaderId: managerId, volumeType: "traffic" } });
  for (const userId of userIds) await prisma.workGroupMember.create({ data: { workGroupId: group.id, userId, workAreaId: area.id, effectiveFrom: new Date("2026-01-01T00:00:00+08:00") } });
}

describe("monthly attendance service", () => {
  it("projects approved canonical leave and correction hours identically for manager and employee self-read", async () => {
    const { store, manager, employee } = await fixture();
    await prisma.leaveRequest.createMany({ data: [
      {
        id: "approved-leave",
        userId: employee.id,
        type: "annual",
        startTime: new Date("2026-07-20T09:00:00+08:00"),
        endTime: new Date("2026-07-20T11:00:00+08:00"),
        isFullDay: false,
        hours: 99,
        status: "approved",
      },
      {
        id: "pending-leave",
        userId: employee.id,
        type: "annual",
        startTime: new Date("2026-07-20T11:00:00+08:00"),
        endTime: new Date("2026-07-20T12:00:00+08:00"),
        isFullDay: false,
        hours: 1,
        status: "pending",
      },
      {
        id: "rejected-leave",
        userId: employee.id,
        type: "annual",
        startTime: new Date("2026-07-20T12:00:00+08:00"),
        endTime: new Date("2026-07-20T13:00:00+08:00"),
        isFullDay: false,
        hours: 1,
        status: "rejected",
      },
    ] });
    await prisma.attendanceRecord.createMany({ data: [
      {
        id: "valid-dynamic-in",
        userId: employee.id,
        storeId: store.id,
        time: new Date("2026-07-20T09:00:00+08:00"),
        direction: "in",
        viaCode: true,
        corrected: false,
        clockWindow: "task9-valid-in",
      },
      {
        id: "invalid-legacy-out",
        userId: employee.id,
        storeId: store.id,
        time: new Date("2026-07-20T12:00:00+08:00"),
        direction: "out",
        viaCode: false,
        corrected: false,
      },
    ] });
    await prisma.punchCorrection.createMany({ data: [
      {
        id: "approved-correction",
        userId: employee.id,
        date: new Date("2026-07-20T00:00:00+08:00"),
        requestedTime: new Date("2026-07-20T13:00:00+08:00"),
        direction: "out",
        status: "approved",
      },
      {
        id: "pending-correction",
        userId: employee.id,
        date: new Date("2026-07-20T00:00:00+08:00"),
        requestedTime: new Date("2026-07-20T12:00:00+08:00"),
        direction: "out",
        status: "pending",
      },
    ] });

    const [managerRow] = await getMonthlyAttendance(scope(manager, store.id), "2026-07");
    const [employeeRow] = await getMonthlyAttendance(scope(employee, store.id), "2026-07", employee.id);

    expect(managerRow).toMatchObject({
      userId: employee.id,
      scheduledHours: 2,
      workedHours: 4,
      leaveHours: 2,
      correctionHours: 4,
    });
    expect(employeeRow).toEqual(managerRow);
  });

  it("keeps Shanghai month bounds half-open when aggregating canonical hours", async () => {
    const { store, manager, employee } = await fixture();
    const plan = await prisma.schedulePlan.create({ data: {
      id: "plan-boundary",
      storeId: store.id,
      weekOf: "2026-07-27",
      status: "published",
      version: 1,
      createdById: manager.id,
      publishedAt: new Date(),
    } });
    await prisma.schedule.createMany({ data: [
      { id: "schedule-july-end", storeId: store.id, userId: employee.id, date: new Date("2026-07-31T00:00:00+08:00"), shiftType: "morning", weekOf: plan.weekOf, planId: plan.id },
      { id: "schedule-august-start", storeId: store.id, userId: employee.id, date: new Date("2026-08-01T00:00:00+08:00"), shiftType: "morning", weekOf: plan.weekOf, planId: plan.id },
    ] });
    await prisma.attendanceRecord.createMany({ data: [
      { id: "july-in", userId: employee.id, storeId: store.id, time: new Date("2026-07-31T09:00:00+08:00"), direction: "in", viaCode: true, corrected: false, clockWindow: "july-in" },
      { id: "july-out", userId: employee.id, storeId: store.id, time: new Date("2026-07-31T13:00:00+08:00"), direction: "out", viaCode: true, corrected: false, clockWindow: "july-out" },
      { id: "august-in", userId: employee.id, storeId: store.id, time: new Date("2026-08-01T09:00:00+08:00"), direction: "in", viaCode: true, corrected: false, clockWindow: "august-in" },
      { id: "august-out", userId: employee.id, storeId: store.id, time: new Date("2026-08-01T13:00:00+08:00"), direction: "out", viaCode: true, corrected: false, clockWindow: "august-out" },
    ] });

    const [july] = await getMonthlyAttendance(scope(manager, store.id), "2026-07");
    const [august] = await getMonthlyAttendance(scope(manager, store.id), "2026-08");

    expect(july).toMatchObject({ scheduledHours: 8, workedHours: 4, leaveHours: 0, correctionHours: 0 });
    expect(august).toMatchObject({ scheduledHours: 4, workedHours: 4, leaveHours: 0, correctionHours: 0 });
  });

  it("counts dynamic and corrected facts, excludes legacy, and deduplicates an approved correction mirror", async () => {
    const { store, manager, employee } = await fixture();
    const plan = await prisma.schedulePlan.findUniqueOrThrow({ where: { id: "plan-a" } });
    await prisma.schedule.create({ data: { id: "schedule-b", storeId: store.id, userId: employee.id, date: new Date("2026-07-21T00:00:00+08:00"), shiftType: "morning", weekOf: "2026-07-20", planId: plan.id } });
    await prisma.attendanceRecord.createMany({ data: [
      { id: "dynamic-20", userId: employee.id, storeId: store.id, time: new Date("2026-07-20T09:00:00+08:00"), direction: "in", viaCode: true, corrected: false, clockWindow: "20-in" },
      { id: "orphan-corrected-20", userId: employee.id, storeId: store.id, time: new Date("2026-07-20T13:00:00+08:00"), direction: "out", viaCode: false, corrected: true },
      { id: "legacy-20", userId: employee.id, storeId: store.id, time: new Date("2026-07-20T08:00:00+08:00"), direction: "in", viaCode: false, corrected: false },
      { id: "dynamic-21", userId: employee.id, storeId: store.id, time: new Date("2026-07-21T09:00:00+08:00"), direction: "in", viaCode: true, corrected: false, clockWindow: "21-in" },
      { id: "approved-mirror-21", userId: employee.id, storeId: store.id, time: new Date("2026-07-21T13:00:00+08:00"), direction: "out", viaCode: false, corrected: true },
    ] });
    await prisma.punchCorrection.create({ data: {
      id: "approved-correction-21",
      userId: employee.id,
      date: new Date("2026-07-21T00:00:00+08:00"),
      requestedTime: new Date("2026-07-21T13:00:00+08:00"),
      direction: "out",
      status: "approved",
    } });

    const facts = await loadDailyAttendanceFactsInTransaction(prisma, scope(manager, store.id), { from: "2026-07-20", to: "2026-07-21" }, [employee.id]);
    expect(facts.punches.map((row) => row.id).sort()).toEqual(["dynamic-20", "dynamic-21"]);
    expect(facts.corrections.map((row) => row.id).sort()).toEqual(["correction:approved-correction-21", "record:orphan-corrected-20"]);
    expect(calculateDailyRows(facts).map((row) => row.result.workedHours)).toEqual([4, 4]);
  });

  it("returns current employees only and employee self-read only", async () => {
    const { store, manager, employee } = await fixture();
    const managerRows = await getMonthlyAttendance(scope(manager, store.id), "2026-07");
    expect(managerRows).toHaveLength(1);
    expect(managerRows[0]).toMatchObject({ userId: employee.id, scheduledHours: 4, workedHours: 0, zeroAttendance: true, revision: 0 });

    const employeeRows = await getMonthlyAttendance(scope(employee, store.id), "2026-07", employee.id);
    expect(employeeRows.map((row) => row.userId)).toEqual([employee.id]);
  });

  it("confirms with source hash CAS, audits the decision, and rejects stale repeat", async () => {
    const { store, manager } = await fixture();
    const managerScope = scope(manager, store.id);
    await confirmCurrentExceptions(manager.id, store.id, "employee-a");
    const [current] = await getMonthlyAttendance(managerScope, "2026-07");
    const result = await confirmMonthlyAttendance(managerScope, {
      month: "2026-07",
      rows: [{ userId: current.userId, zeroAttendanceAction: "normal_attendance", expectedRevision: current.revision, expectedSourceHash: current.sourceHash }],
    }, new Date("2026-07-25T00:00:00+08:00"));
    expect(result).toEqual({ count: 1 });
    expect(await prisma.monthlyAttendanceConfirmation.findFirst()).toMatchObject({ status: "confirmed", revision: 1, zeroAttendanceAction: "normal_attendance", sourceHash: current.sourceHash });
    expect(await prisma.monthlyAttendanceAuditEvent.findFirst()).toMatchObject({ eventType: "confirmed", revision: 1, actorId: manager.id });

    await expect(confirmMonthlyAttendance(managerScope, {
      month: "2026-07",
      rows: [{ userId: current.userId, zeroAttendanceAction: "normal_attendance", expectedRevision: 0, expectedSourceHash: current.sourceHash }],
    }, new Date("2026-07-25T00:00:00+08:00"))).rejects.toBeInstanceOf(MonthlyAttendanceServiceError);
  });

  it("rolls a blocked batch back and uses revision CAS to unconfirm", async () => {
    const { store, manager, employee, otherEmployee } = await fixture();
    const managerScope = scope(manager, store.id);
    await confirmCurrentExceptions(manager.id, store.id, employee.id);
    const [current] = await getMonthlyAttendance(managerScope, "2026-07");
    await expect(confirmMonthlyAttendance(managerScope, {
      month: "2026-07",
      rows: [
        { userId: current.userId, zeroAttendanceAction: "normal_attendance", expectedRevision: 0, expectedSourceHash: current.sourceHash },
        { userId: otherEmployee.id, zeroAttendanceAction: "none", expectedRevision: 0, expectedSourceHash: "foreign" },
      ],
    }, new Date("2026-07-25T00:00:00+08:00"))).rejects.toMatchObject({ status: 403 });
    expect(await prisma.monthlyAttendanceConfirmation.count()).toBe(0);

    await confirmMonthlyAttendance(managerScope, {
      month: "2026-07",
      rows: [{ userId: employee.id, zeroAttendanceAction: "normal_attendance", expectedRevision: 0, expectedSourceHash: current.sourceHash }],
    }, new Date("2026-07-25T00:00:00+08:00"));
    await expect(unconfirmMonthlyAttendance(managerScope, { month: "2026-07", rows: [{ userId: employee.id, expectedRevision: 0 }] })).rejects.toMatchObject({ status: 409 });
    expect(await unconfirmMonthlyAttendance(managerScope, { month: "2026-07", rows: [{ userId: employee.id, expectedRevision: 1 }] })).toEqual({ count: 1 });
  });

  it("rejects future months", async () => {
    const { store, manager } = await fixture();
    await expect(confirmMonthlyAttendance(scope(manager, store.id), {
      month: "2026-08",
      rows: [{ userId: "employee-a", zeroAttendanceAction: "none", expectedRevision: 0, expectedSourceHash: "hash" }],
    }, new Date("2026-07-31T15:59:59.000Z"))).rejects.toMatchObject({ status: 409, code: "future_month" });
  });
});

describe("monthly attendance API scope", () => {
  it("enforces employee self, manager store, and explicit admin read scope", async () => {
    const { store, otherStore, manager, employee } = await fixture();
    const admin = { id: "admin-a", phone: "admin-a", name: "管理员", role: "admin" as const, storeId: null };
    const route = await import("@/app/api/attendance/monthly/route");

    sessionState.requireSession.mockResolvedValue({ user: { ...employee, role: "employee" } });
    const employeeResponse = await route.GET(new Request(`http://localhost/api/attendance/monthly?month=2026-07&storeId=${otherStore.id}&userId=someone-else`));
    expect(employeeResponse.status).toBe(200);
    expect((await employeeResponse.json()).data.map((row: { userId: string }) => row.userId)).toEqual([employee.id]);

    sessionState.requireSession.mockResolvedValue({ user: { ...manager, role: "manager" } });
    expect((await route.GET(new Request(`http://localhost/api/attendance/monthly?month=2026-07&storeId=${otherStore.id}`))).status).toBe(403);
    expect((await route.GET(new Request("http://localhost/api/attendance/monthly?month=2026-07"))).status).toBe(200);

    sessionState.requireSession.mockResolvedValue({ user: admin });
    expect((await route.GET(new Request("http://localhost/api/attendance/monthly?month=2026-07"))).status).toBe(400);
    expect((await route.GET(new Request(`http://localhost/api/attendance/monthly?month=2026-07&storeId=${store.id}`))).status).toBe(200);
  });

  it("allows only the own-store manager to confirm and unconfirm", async () => {
    const { store, manager, employee } = await fixture();
    await confirmCurrentExceptions(manager.id, store.id, employee.id);
    const managerScope = scope(manager, store.id);
    const [current] = await getMonthlyAttendance(managerScope, "2026-07");
    const confirmRoute = await import("@/app/api/attendance/monthly/confirm/route");
    const unconfirmRoute = await import("@/app/api/attendance/monthly/unconfirm/route");

    sessionState.requireSession.mockResolvedValue({ user: { ...manager, role: "manager" } });
    const confirmResponse = await confirmRoute.POST(new Request("http://localhost/api/attendance/monthly/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ month: "2026-07", rows: [{ userId: employee.id, zeroAttendanceAction: "normal_attendance", expectedRevision: 0, expectedSourceHash: current.sourceHash }] }),
    }));
    expect(confirmResponse.status).toBe(200);

    sessionState.requireSession.mockResolvedValue({ user: { ...employee, role: "employee" } });
    expect((await unconfirmRoute.POST(new Request("http://localhost/api/attendance/monthly/unconfirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ month: "2026-07", rows: [{ userId: employee.id, expectedRevision: 1 }] }),
    }))).status).toBe(403);

    sessionState.requireSession.mockResolvedValue({ user: { ...manager, role: "manager" } });
    expect((await unconfirmRoute.POST(new Request("http://localhost/api/attendance/monthly/unconfirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ month: "2026-07", rows: [{ userId: employee.id, expectedRevision: 1 }] }),
    }))).status).toBe(200);
  });
});

describe("atomic upstream monthly invalidation", () => {
  it("invalidates the exact punch month while invalid and replayed punches do not", async () => {
    const { store, manager, employee } = await fixture();
    await createConfirmedMonth(store.id, employee.id, manager.id);
    const secret = "task8-punch-secret";
    const now = new Date("2026-07-20T09:10:00+08:00");
    await expect(punchWithCode({ ...employee, role: "employee" }, { direction: "in", code: "000000" }, now, secret)).rejects.toMatchObject({ code: "invalid_code" });
    expect((await prisma.monthlyAttendanceConfirmation.findFirstOrThrow()).status).toBe("confirmed");
    const code = createClockCode(store.id, now, secret).code;
    await punchWithCode({ ...employee, role: "employee" }, { direction: "in", code }, now, secret);
    expect(await prisma.monthlyAttendanceConfirmation.findFirst()).toMatchObject({ status: "unconfirmed", revision: 2, zeroAttendanceAction: "none" });
    expect(await prisma.monthlyAttendanceAuditEvent.findFirst()).toMatchObject({ reason: "punch_created", actorId: employee.id });
    await expect(punchWithCode({ ...employee, role: "employee" }, { direction: "out", code }, now, secret)).rejects.toMatchObject({ code: "replay" });
    expect(await prisma.monthlyAttendanceAuditEvent.count()).toBe(1);
  });

  it("invalidates only changed daily results and real confirmation transitions", async () => {
    const { store, manager, employee } = await fixture();
    const managerScope = scope(manager, store.id);
    await createConfirmedMonth(store.id, employee.id, manager.id);
    await recalculateDailyAttendance(managerScope, { from: "2026-07-20", to: "2026-07-20", userIds: [employee.id] });
    expect(await prisma.monthlyAttendanceConfirmation.findFirst()).toMatchObject({ status: "unconfirmed", revision: 2 });
    expect(await prisma.monthlyAttendanceAuditEvent.findFirst()).toMatchObject({ reason: "daily_result_changed" });

    await prisma.monthlyAttendanceAuditEvent.deleteMany();
    await prisma.monthlyAttendanceConfirmation.deleteMany();
    await createConfirmedMonth(store.id, employee.id, manager.id);
    await recalculateDailyAttendance(managerScope, { from: "2026-07-20", to: "2026-07-20", userIds: [employee.id] });
    expect((await prisma.monthlyAttendanceConfirmation.findFirstOrThrow()).status).toBe("confirmed");

    const overlay = await prisma.attendanceExceptionConfirmation.findFirstOrThrow({ where: { userId: employee.id, type: "missing_in" } });
    await confirmDailyExceptions(managerScope, [{ id: overlay.id, revision: overlay.revision }]);
    expect(await prisma.monthlyAttendanceConfirmation.findFirst()).toMatchObject({ status: "unconfirmed", revision: 2 });
    expect(await prisma.monthlyAttendanceAuditEvent.findFirst()).toMatchObject({ reason: "daily_confirmation_changed" });

    await prisma.monthlyAttendanceAuditEvent.deleteMany();
    await prisma.monthlyAttendanceConfirmation.deleteMany();
    await createConfirmedMonth(store.id, employee.id, manager.id);
    await unconfirmDailyExceptions(managerScope, [{ id: overlay.id, revision: overlay.revision + 1 }]);
    expect((await prisma.monthlyAttendanceConfirmation.findFirstOrThrow()).status).toBe("unconfirmed");
  });

  it("invalidates first publication pairs while draft saves do not", async () => {
    const { store, manager, employee } = await fixture();
    await makeSchedulable(store.id, manager.id, [employee.id]);
    const draft = await prisma.schedulePlan.create({ data: { storeId: store.id, weekOf: "2026-07-27", status: "draft", version: 0, createdById: manager.id } });
    const assignment = { userId: employee.id, date: "2026-07-27", shiftType: "morning" as const };
    await createConfirmedMonth(store.id, employee.id, manager.id);
    await saveDraft(scope(manager, store.id), { planId: draft.id, version: 0, assignments: [assignment], source: "manual" });
    expect((await prisma.monthlyAttendanceConfirmation.findFirstOrThrow()).status).toBe("confirmed");
    await publishSchedule(scope(manager, store.id), { planId: draft.id, version: 1, assignments: [assignment] });
    expect(await prisma.monthlyAttendanceConfirmation.findFirst()).toMatchObject({ status: "unconfirmed", revision: 2 });
    expect(await prisma.monthlyAttendanceAuditEvent.findFirst()).toMatchObject({ reason: "schedule_changed" });
  });

  it("rolls schedule publication back when monthly audit cannot commit", async () => {
    const { store, manager, employee } = await fixture();
    await makeSchedulable(store.id, manager.id, [employee.id]);
    const draft = await prisma.schedulePlan.create({ data: { storeId: store.id, weekOf: "2026-07-27", status: "draft", version: 0, createdById: manager.id } });
    await createConfirmedMonth(store.id, employee.id, manager.id);
    await expect(publishSchedule(scope({ ...manager, id: "missing-manager" }, store.id), {
      planId: draft.id,
      version: 0,
      assignments: [{ userId: employee.id, date: "2026-07-27", shiftType: "morning" }],
    })).rejects.toThrow();
    expect(await prisma.schedulePlan.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ status: "draft", version: 0 });
    expect(await prisma.schedule.count({ where: { planId: draft.id } })).toBe(0);
    expect((await prisma.monthlyAttendanceConfirmation.findFirstOrThrow()).status).toBe("confirmed");
  });

  it("invalidates approved leave and correction facts but not rejected requests", async () => {
    const { store, manager, employee } = await fixture();
    const managerScope = scope(manager, store.id);
    const rejected = await prisma.leaveRequest.create({ data: { userId: employee.id, type: "annual", startTime: new Date("2026-07-20T09:00:00+08:00"), endTime: new Date("2026-07-20T13:00:00+08:00"), isFullDay: false, hours: 4, status: "pending" } });
    await createConfirmedMonth(store.id, employee.id, manager.id);
    const recalculationAuditCount = await prisma.attendanceAuditEvent.count({ where: { action: "daily.recalculated" } });
    await decideApprovals(managerScope, { items: [{ type: "leave", id: rejected.id }], decision: "rejected", reason: "不符合", aiLogIds: [] });
    expect((await prisma.monthlyAttendanceConfirmation.findFirstOrThrow()).status).toBe("confirmed");
    expect(await prisma.attendanceAuditEvent.count({ where: { action: "daily.recalculated" } })).toBe(recalculationAuditCount + 1);
    expect(await prisma.monthlyAttendanceAuditEvent.count()).toBe(0);

    const leave = await prisma.leaveRequest.create({ data: { userId: employee.id, type: "annual", startTime: new Date("2026-07-21T09:00:00+08:00"), endTime: new Date("2026-07-21T13:00:00+08:00"), isFullDay: false, hours: 4, status: "pending" } });
    await decideApprovals(managerScope, { items: [{ type: "leave", id: leave.id }], decision: "approved", reason: "同意", aiLogIds: [] });
    expect((await prisma.monthlyAttendanceConfirmation.findFirstOrThrow()).status).toBe("unconfirmed");
    expect(await prisma.monthlyAttendanceAuditEvent.findFirst()).toMatchObject({ reason: "leave_approval_changed" });

    await prisma.monthlyAttendanceAuditEvent.deleteMany();
    await prisma.monthlyAttendanceConfirmation.deleteMany();
    await createConfirmedMonth(store.id, employee.id, manager.id);
    const correction = await prisma.punchCorrection.create({ data: { userId: employee.id, date: new Date("2026-07-22T00:00:00+08:00"), requestedTime: new Date("2026-07-22T09:00:00+08:00"), direction: "in", status: "pending" } });
    await decideApprovals(managerScope, { items: [{ type: "punch_correction", id: correction.id }], decision: "approved", reason: "同意", aiLogIds: [] });
    expect((await prisma.monthlyAttendanceConfirmation.findFirstOrThrow()).status).toBe("unconfirmed");
    expect(await prisma.monthlyAttendanceAuditEvent.findFirst()).toMatchObject({ reason: "correction_approval_changed" });
  });

  it("invalidates both employee-date pairs for an approved swap", async () => {
    const { store, manager, employee } = await fixture();
    const target = await prisma.user.create({ data: { id: "employee-target", phone: "e-target", employeeNo: "A002", name: "小陈", role: "employee", storeId: store.id, position: "sales" } });
    await makeSchedulable(store.id, manager.id, [employee.id, target.id]);
    const plan = await prisma.schedulePlan.findUniqueOrThrow({ where: { id: "plan-a" } });
    const targetSchedule = await prisma.schedule.create({ data: { storeId: store.id, planId: plan.id, userId: target.id, date: new Date("2026-07-21T00:00:00+08:00"), shiftType: "morning", weekOf: plan.weekOf } });
    const request = await prisma.shiftSwapRequest.create({ data: { requesterId: employee.id, targetUserId: target.id, reqScheduleId: "schedule-a", tgtScheduleId: targetSchedule.id, status: "pending_manager" } });
    await createConfirmedMonth(store.id, employee.id, manager.id);
    await createConfirmedMonth(store.id, target.id, manager.id);
    await decideApprovals(scope(manager, store.id), { items: [{ type: "shift_swap", id: request.id }], decision: "approved", reason: "同意", aiLogIds: [] });
    expect((await prisma.monthlyAttendanceConfirmation.findMany({ orderBy: { userId: "asc" } })).map((row) => row.status)).toEqual(["unconfirmed", "unconfirmed"]);
    expect((await prisma.monthlyAttendanceAuditEvent.findMany()).map((row) => row.reason)).toEqual(["shift_swap_approved", "shift_swap_approved"]);
  });

  it("treats an approved leave ending at Shanghai midnight as a half-open interval", async () => {
    const { store, manager, employee } = await fixture();
    await createConfirmedMonth(store.id, employee.id, manager.id, "2026-07");
    await createConfirmedMonth(store.id, employee.id, manager.id, "2026-08");
    const leave = await prisma.leaveRequest.create({ data: {
      userId: employee.id,
      type: "annual",
      startTime: new Date("2026-07-31T09:00:00+08:00"),
      endTime: new Date("2026-08-01T00:00:00+08:00"),
      isFullDay: false,
      hours: 8,
      status: "pending",
    } });

    await decideApprovals(scope(manager, store.id), {
      items: [{ type: "leave", id: leave.id }],
      decision: "approved",
      reason: "同意",
      aiLogIds: [],
    });

    expect((await prisma.monthlyAttendanceConfirmation.findMany({ orderBy: { month: "asc" } })).map((row) => [row.month, row.status])).toEqual([
      ["2026-07", "unconfirmed"],
      ["2026-08", "confirmed"],
    ]);
    expect((await prisma.monthlyAttendanceAuditEvent.findMany()).map((row) => row.month)).toEqual(["2026-07"]);
  });

  it("invalidates only the exact cross-month published assignment pairs", async () => {
    const { store, manager, employee } = await fixture();
    const target = await prisma.user.create({ data: {
      id: "employee-target",
      phone: "e-target",
      employeeNo: "A002",
      name: "小陈",
      role: "employee",
      storeId: store.id,
      position: "sales",
    } });
    await makeSchedulable(store.id, manager.id, [employee.id, target.id]);
    const draft = await prisma.schedulePlan.create({ data: {
      storeId: store.id,
      weekOf: "2026-07-27",
      status: "draft",
      version: 0,
      createdById: manager.id,
    } });
    for (const userId of [employee.id, target.id]) for (const month of ["2026-07", "2026-08"]) {
      await createConfirmedMonth(store.id, userId, manager.id, month);
    }

    await publishSchedule(scope(manager, store.id), {
      planId: draft.id,
      version: 0,
      assignments: [
        { userId: employee.id, date: "2026-07-31", shiftType: "morning" },
        { userId: target.id, date: "2026-08-01", shiftType: "morning" },
      ],
    });

    expect((await prisma.monthlyAttendanceConfirmation.findMany({ orderBy: [{ userId: "asc" }, { month: "asc" }] })).map((row) => [row.userId, row.month, row.status])).toEqual([
      [employee.id, "2026-07", "unconfirmed"],
      [employee.id, "2026-08", "confirmed"],
      [target.id, "2026-07", "confirmed"],
      [target.id, "2026-08", "unconfirmed"],
    ]);
    expect((await prisma.monthlyAttendanceAuditEvent.findMany({ orderBy: [{ userId: "asc" }, { month: "asc" }] })).map((row) => `${row.userId}:${row.month}`)).toEqual([
      `${employee.id}:2026-07`,
      `${target.id}:2026-08`,
    ]);
  });

  it("keeps monthly confirmations for copy, import, and recommendation restore draft flows", async () => {
    const { store, manager, employee } = await fixture();
    await makeSchedulable(store.id, manager.id, [employee.id]);
    const draft = await prisma.schedulePlan.create({ data: {
      storeId: store.id,
      weekOf: "2026-07-27",
      status: "draft",
      version: 0,
      createdById: manager.id,
    } });
    await createConfirmedMonth(store.id, employee.id, manager.id);

    await copyHistory(scope(manager, store.id), { planId: draft.id, sourcePlanId: "plan-a", version: 0 });
    await prisma.schedulePlan.update({
      where: { id: draft.id },
      data: { recommendationJson: JSON.stringify({
        assignments: [{ userId: employee.id, date: "2026-07-29", shiftType: "morning" }],
        gaps: [],
        note: "",
        explanation: "",
        status: "feasible",
      }) },
    });
    await restoreRecommendation(scope(manager, store.id), { planId: draft.id, version: 1 });
    const batch = await prisma.scheduleImportBatch.create({ data: {
      storeId: store.id,
      planId: draft.id,
      fileName: "task8-negative.xlsx",
      status: "validated",
      validatedVersion: 2,
      totalRows: 1,
      successRows: 1,
      errorRows: 0,
      errorsJson: "[]",
      normalizedRowsJson: JSON.stringify([{ userId: employee.id, date: "2026-07-30", shiftType: "morning" }]),
      createdById: manager.id,
    } });
    await commitImport(scope(manager, store.id), { batchId: batch.id, version: 2 });

    expect((await prisma.monthlyAttendanceConfirmation.findFirstOrThrow()).status).toBe("confirmed");
    expect(await prisma.monthlyAttendanceAuditEvent.count()).toBe(0);
  });

  it("rolls an approval source mutation back when the SQLite monthly audit insert aborts", async () => {
    const { store, manager, employee } = await fixture();
    await createConfirmedMonth(store.id, employee.id, manager.id);
    const leave = await prisma.leaveRequest.create({ data: {
      userId: employee.id,
      type: "annual",
      startTime: new Date("2026-07-23T09:00:00+08:00"),
      endTime: new Date("2026-07-23T13:00:00+08:00"),
      isFullDay: false,
      hours: 4,
      status: "pending",
    } });
    const balanceBefore = (await prisma.user.findUniqueOrThrow({ where: { id: employee.id } })).annualLeaveBalance;

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER task8_fail_monthly_audit
      BEFORE INSERT ON "MonthlyAttendanceAuditEvent"
      BEGIN
        SELECT RAISE(ABORT, 'task8 injected monthly audit failure');
      END
    `);
    try {
      await expect(decideApprovals(scope(manager, store.id), {
        items: [{ type: "leave", id: leave.id }],
        decision: "approved",
        reason: "同意",
        aiLogIds: [],
      })).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS task8_fail_monthly_audit");
    }

    expect(await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } })).toMatchObject({ status: "pending", decidedById: null });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: employee.id } })).annualLeaveBalance).toBe(balanceBefore);
    expect((await prisma.monthlyAttendanceConfirmation.findFirstOrThrow()).status).toBe("confirmed");
    expect(await prisma.monthlyAttendanceAuditEvent.count()).toBe(0);
    expect(await prisma.attendanceAuditEvent.count({ where: { action: "daily.recalculated" } })).toBe(0);
  });
});
