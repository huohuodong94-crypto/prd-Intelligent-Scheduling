import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireSession: sessionState.requireSession }));

import { getMonthlyReport, getSchedulingReport } from "@/features/reports/server/report-service";
import type { StoreScope } from "@/lib/authorization";
import { prisma, resetTestDb } from "../helpers/test-db";

beforeEach(resetTestDb);

function scope(user: { id: string; phone: string; name: string; role: "manager" | "admin" | "employee"; storeId: string | null }, storeId: string): StoreScope {
  return { user, storeId };
}

async function fixture() {
  const store = await prisma.store.create({ data: { id: "store-a", name: "A", code: "A" } });
  const otherStore = await prisma.store.create({ data: { id: "store-b", name: "B", code: "B" } });
  const manager = await prisma.user.create({ data: { id: "manager-a", phone: "manager-a", name: "店长", role: "manager", storeId: store.id } });
  const otherManager = await prisma.user.create({ data: { id: "manager-b", phone: "manager-b", name: "外店店长", role: "manager", storeId: otherStore.id } });
  const employee = await prisma.user.create({ data: { id: "employee-a", phone: "employee-a", employeeNo: "A001", name: "小王", role: "employee", storeId: store.id, position: "sales", salesAbility: "high", performanceBand: "always" } });
  const cashier = await prisma.user.create({ data: { id: "employee-b", phone: "employee-b", employeeNo: "A002", name: "小李", role: "employee", storeId: store.id, position: "cashier", salesAbility: "low", performanceBand: "sometimes" } });
  const otherEmployee = await prisma.user.create({ data: { id: "employee-c", phone: "employee-c", employeeNo: "B001", name: "外店员工", role: "employee", storeId: otherStore.id, position: "sales", salesAbility: "mid", performanceBand: "frequently" } });
  const plan = await prisma.schedulePlan.create({ data: { id: "plan-a", storeId: store.id, weekOf: "2026-07-20", status: "published", version: 1, createdById: manager.id, publishedAt: new Date() } });
  const otherPlan = await prisma.schedulePlan.create({ data: { id: "plan-b", storeId: otherStore.id, weekOf: "2026-07-20", status: "published", version: 1, createdById: otherManager.id, publishedAt: new Date() } });
  await prisma.schedule.createMany({ data: [
    { id: "schedule-sales", storeId: store.id, userId: employee.id, date: new Date("2026-07-20T00:00:00+08:00"), shiftType: "morning", weekOf: plan.weekOf, planId: plan.id },
    { id: "schedule-cashier", storeId: store.id, userId: cashier.id, date: new Date("2026-07-20T00:00:00+08:00"), shiftType: "morning", weekOf: plan.weekOf, planId: plan.id },
    { id: "schedule-manager", storeId: store.id, userId: manager.id, date: new Date("2026-07-20T00:00:00+08:00"), shiftType: "morning", weekOf: plan.weekOf, planId: plan.id },
    { id: "schedule-other", storeId: otherStore.id, userId: otherEmployee.id, date: new Date("2026-07-20T00:00:00+08:00"), shiftType: "morning", weekOf: otherPlan.weekOf, planId: otherPlan.id },
  ] });
  await prisma.trafficForecast.createMany({ data: [
    { id: "forecast-morning", planId: plan.id, date: new Date("2026-07-20T00:00:00+08:00"), timeSlot: "morning", predicted: 30, adjusted: 24 },
    { id: "forecast-afternoon", planId: plan.id, date: new Date("2026-07-20T00:00:00+08:00"), timeSlot: "afternoon", predicted: 10 },
  ] });
  await prisma.v2SConfig.create({ data: { storeId: store.id, dayOfWeek: 1, v2sLower: 5, v2sUpper: 10 } });
  await prisma.minStaffingConfig.createMany({ data: [
    { storeId: store.id, dayOfWeek: 1, timeSlot: "morning", position: "sales", minHeadcount: 1 },
    { storeId: store.id, dayOfWeek: 1, timeSlot: "morning", position: "cashier", minHeadcount: 1 },
    { storeId: store.id, dayOfWeek: 1, timeSlot: "afternoon", position: "sales", minHeadcount: 1 },
    { storeId: store.id, dayOfWeek: 1, timeSlot: "afternoon", position: "cashier", minHeadcount: 1 },
  ] });
  return { store, otherStore, manager, otherManager, employee, cashier, plan, otherPlan };
}

describe("report services", () => {
  it("projects monthly report fields only from the canonical monthly service result", async () => {
    const { store, manager, employee, plan } = await fixture();
    await prisma.leaveRequest.create({ data: { id: "leave-a", userId: employee.id, type: "annual", startTime: new Date("2026-07-20T09:00:00+08:00"), endTime: new Date("2026-07-20T11:00:00+08:00"), isFullDay: false, hours: 99, status: "approved" } });
    await prisma.attendanceRecord.create({ data: { id: "punch-in", userId: employee.id, storeId: store.id, time: new Date("2026-07-20T09:00:00+08:00"), direction: "in", viaCode: true, corrected: false, clockWindow: "report-in" } });
    await prisma.punchCorrection.create({ data: { id: "correction-out", userId: employee.id, date: new Date("2026-07-20T00:00:00+08:00"), requestedTime: new Date("2026-07-20T13:00:00+08:00"), direction: "out", status: "approved" } });
    expect(plan.status).toBe("published");

    const report = await getMonthlyReport(scope({ ...manager, role: "manager" }, store.id), "2026-07");

    expect(report.rows.find((row) => row.userId === employee.id)).toMatchObject({
      scheduledHours: 2,
      workedHours: 4,
      leaveHours: 2,
      correctionHours: 4,
      confirmationStatus: "unconfirmed",
    });
    expect(report.totals).toEqual(report.rows.reduce((totals, row) => ({
      scheduledHours: totals.scheduledHours + row.scheduledHours,
      workedHours: totals.workedHours + row.workedHours,
      leaveHours: totals.leaveHours + row.leaveHours,
      correctionHours: totals.correctionHours + row.correctionHours,
      exceptionCount: totals.exceptionCount + row.exceptionCount,
    }), { scheduledHours: 0, workedHours: 0, leaveHours: 0, correctionHours: 0, exceptionCount: 0 }));
  });

  it("uses the exact published plan, stored forecast and canonical AI pointer while excluding managers and unrelated logs", async () => {
    const { store, otherStore, manager, employee, cashier, plan, otherPlan } = await fixture();
    const metric = await prisma.aiInteractionLog.create({ data: {
      id: "canonical-metric", userId: manager.id, storeId: store.id, planId: plan.id,
      feature: "schedule_advisor", eventKind: "schedule_plan_metric", inputText: "ignore",
      outputText: JSON.stringify({ wasAccepted: true, editRatio: 1 }), wasAccepted: false,
      wasEdited: true, editRatio: 0,
    } });
    await prisma.schedulePlan.update({ where: { id: plan.id }, data: { recommendationAiLogId: metric.id } });
    await prisma.aiInteractionLog.createMany({ data: [
      { id: "raw-parse", userId: manager.id, storeId: store.id, planId: plan.id, feature: "schedule_advisor", inputText: "parse", outputText: "{}", wasAccepted: true, editRatio: 1 },
      { id: "missing-metric", userId: manager.id, storeId: store.id, planId: plan.id, feature: "schedule_advisor", eventKind: "schedule_metric_missing", inputText: "missing", outputText: "{}", wasAccepted: true, editRatio: 1 },
      { id: "wrong-feature", userId: manager.id, storeId: store.id, planId: plan.id, feature: "assistant", eventKind: "schedule_plan_metric", inputText: "wrong", outputText: "{}", wasAccepted: true, editRatio: 1 },
      { id: "legacy-null", userId: manager.id, storeId: null, planId: null, feature: "schedule_advisor", eventKind: "schedule_plan_metric", inputText: "legacy", outputText: "{}", wasAccepted: true, editRatio: 1 },
      { id: "wrong-store-pointer", userId: manager.id, storeId: otherStore.id, planId: plan.id, feature: "schedule_advisor", eventKind: "schedule_plan_metric", inputText: "wrong store", outputText: "{}", wasAccepted: true, editRatio: 1 },
      { id: "wrong-plan-pointer", userId: manager.id, storeId: store.id, planId: otherPlan.id, feature: "schedule_advisor", eventKind: "schedule_plan_metric", inputText: "wrong plan", outputText: "{}", wasAccepted: true, editRatio: 1 },
    ] });
    const wrongWeekPlan = await prisma.schedulePlan.create({ data: { id: "plan-wrong-week", storeId: store.id, weekOf: "2026-07-27", status: "published", version: 1, createdById: manager.id, publishedAt: new Date() } });
    const wrongWeekMetric = await prisma.aiInteractionLog.create({ data: { id: "wrong-week-metric", userId: manager.id, storeId: store.id, planId: wrongWeekPlan.id, feature: "schedule_advisor", eventKind: "schedule_plan_metric", inputText: "wrong week", outputText: "{}", wasAccepted: true, editRatio: 1 } });
    await prisma.schedulePlan.update({ where: { id: wrongWeekPlan.id }, data: { recommendationAiLogId: wrongWeekMetric.id } });

    const report = await getSchedulingReport(scope({ ...manager, role: "manager" }, store.id), "2026-07-20");

    expect(report.employeeRows.map((row) => row.userId).sort()).toEqual([cashier.id, employee.id].sort());
    expect(report.employeeRows).not.toContainEqual(expect.objectContaining({ userId: manager.id }));
    expect(report.gaps).toContainEqual({ date: "2026-07-20", shift: "morning", position: "sales", required: 2, assigned: 1, shortfall: 1 });
    expect(report.v2s).toContainEqual({ date: "2026-07-20", shift: "morning", visitors: 24, staff: 2, actualV2S: 12, lower: 5, upper: 10 });
    expect(report.v2s).toContainEqual({ date: "2026-07-20", shift: "afternoon", visitors: 10, staff: 0, actualV2S: null, lower: 5, upper: 10 });
    expect(report.abilityBalance).toContainEqual({ date: "2026-07-20", shift: "morning", high: 1, mid: 0, low: 1 });
    expect(report.ai).toEqual({ generatedPlans: 1, acceptedPlans: 0, editedPlans: 1, acceptanceRate: 0, averageEditRatio: 0 });

    const emptyAi = { generatedPlans: 0, acceptedPlans: 0, editedPlans: 0, acceptanceRate: null, averageEditRatio: null };
    for (const recommendationAiLogId of [null, "raw-parse", "missing-metric", "wrong-feature", "legacy-null", "wrong-store-pointer", "wrong-plan-pointer"]) {
      await prisma.schedulePlan.update({ where: { id: plan.id }, data: { recommendationAiLogId } });
      expect((await getSchedulingReport(scope({ ...manager, role: "manager" }, store.id), "2026-07-20")).ai).toEqual(emptyAi);
    }
  });
});

describe("report route authorization and query validation", () => {
  it("enforces manager, explicit admin and employee denial consistently across new and legacy routes", async () => {
    const { store, otherStore, manager, employee } = await fixture();
    const admin = await prisma.user.create({ data: { id: "admin-a", phone: "admin-a", name: "管理员", role: "admin", storeId: store.id } });
    const monthlyRoute = await import("@/app/api/reports/monthly/route");
    const schedulingRoute = await import("@/app/api/reports/scheduling/route");
    const legacyRoute = await import("@/app/api/reports/route");

    sessionState.requireSession.mockResolvedValue({ user: { ...manager, role: "manager" } });
    expect((await monthlyRoute.GET(new Request("http://localhost/api/reports/monthly?month=2026-07"))).status).toBe(200);
    expect((await monthlyRoute.GET(new Request(`http://localhost/api/reports/monthly?month=2026-07&storeId=${store.id}`))).status).toBe(200);
    expect((await monthlyRoute.GET(new Request(`http://localhost/api/reports/monthly?month=2026-07&storeId=${otherStore.id}`))).status).toBe(403);
    expect((await schedulingRoute.GET(new Request("http://localhost/api/reports/scheduling?weekOf=2026-07-20"))).status).toBe(200);
    expect((await monthlyRoute.GET(new Request("http://localhost/api/reports/monthly?month=2026-13"))).status).toBe(400);
    expect((await schedulingRoute.GET(new Request("http://localhost/api/reports/scheduling?weekOf=2026-07-21"))).status).toBe(400);
    expect((await schedulingRoute.GET(new Request("http://localhost/api/reports/scheduling?weekOf=2026-02-30"))).status).toBe(400);

    const current = await monthlyRoute.GET(new Request(`http://localhost/api/reports/monthly?month=2026-07&storeId=${store.id}`));
    const legacy = await legacyRoute.GET(new Request(`http://localhost/api/reports?month=2026-07&storeId=${store.id}`));
    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toEqual(await current.json());

    sessionState.requireSession.mockResolvedValue({ user: { ...admin, role: "admin" } });
    expect((await monthlyRoute.GET(new Request("http://localhost/api/reports/monthly?month=2026-07"))).status).toBe(400);
    expect((await schedulingRoute.GET(new Request("http://localhost/api/reports/scheduling?weekOf=2026-07-20"))).status).toBe(400);
    expect((await legacyRoute.GET(new Request("http://localhost/api/reports?month=2026-07"))).status).toBe(400);
    expect((await monthlyRoute.GET(new Request("http://localhost/api/reports/monthly?month=2026-07&storeId=missing"))).status).toBe(404);
    expect((await monthlyRoute.GET(new Request(`http://localhost/api/reports/monthly?month=2026-07&storeId=${store.id}`))).status).toBe(200);

    sessionState.requireSession.mockResolvedValue({ user: { ...employee, role: "employee" } });
    expect((await monthlyRoute.GET(new Request("http://localhost/api/reports/monthly?month=2026-07"))).status).toBe(403);
    expect((await schedulingRoute.GET(new Request("http://localhost/api/reports/scheduling?weekOf=2026-07-20"))).status).toBe(403);
    expect((await legacyRoute.GET(new Request("http://localhost/api/reports?month=2026-07"))).status).toBe(403);
  });
});
