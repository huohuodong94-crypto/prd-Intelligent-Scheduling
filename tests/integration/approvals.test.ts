import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/lib/auth";

const authState = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    getSession: vi.fn(async () => authState.user),
    requireSession: vi.fn(async (roles?: SessionUser["role"][]) => {
      if (!authState.user) return { error: "未登录", status: 401 };
      if (roles && !roles.includes(authState.user.role)) return { error: "无权限访问该功能", status: 403 };
      return { user: authState.user };
    }),
  };
});
import {
  ApprovalServiceError,
  acceptTargetSwap,
  createPunchCorrection,
  createShiftSwap,
  decideApprovals,
  saveApprovalAdvice,
} from "@/features/approvals/server/approval-service";
import { prisma, resetTestDb } from "../helpers/test-db";
import { getDashboardSummary } from "@/features/dashboard/server/dashboard-service";
import * as approvalsRoute from "@/app/api/approvals/route";
import * as decideRoute from "@/app/api/approvals/decide/route";
import * as aiRoute from "@/app/api/approvals/ai-check/route";
import * as leaveRoute from "@/app/api/leave/route";
import * as correctionRoute from "@/app/api/punch-corrections/route";
import * as swapRoute from "@/app/api/shift-swaps/route";

function actor(id: string, role: SessionUser["role"], storeId: string | null): SessionUser {
  return { id, role, storeId, name: id, phone: `task6-${id}` };
}

async function fixture() {
  const storeA = await prisma.store.create({ data: { id: "task6-a", name: "A 店", code: "TASK6-A" } });
  const storeB = await prisma.store.create({ data: { id: "task6-b", name: "B 店", code: "TASK6-B" } });
  const manager = actor("task6-manager", "manager", storeA.id);
  const admin = actor("task6-admin", "admin", null);
  const employee = actor("task6-e1", "employee", storeA.id);
  const target = actor("task6-e2", "employee", storeA.id);
  const foreign = actor("task6-e3", "employee", storeB.id);
  for (const user of [manager, admin, employee, target, foreign]) {
    await prisma.user.create({
      data: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        role: user.role,
        storeId: user.storeId,
        employeeNo: user.role === "employee" ? `NO-${user.id}` : null,
        position: user.role === "employee" ? "sales" : null,
        annualLeaveBalance: 80,
        sickLeaveBalance: 40,
      },
    });
  }
  for (const [store, leader, members] of [
    [storeA, manager, [employee, target]],
    [storeB, admin, [foreign]],
  ] as const) {
    const area = await prisma.workArea.create({ data: { id: `area-${store.id}`, storeId: store.id, name: "卖场", code: "FLOOR" } });
    const group = await prisma.workGroup.create({ data: { id: `group-${store.id}`, storeId: store.id, name: "销售组", leaderId: leader.id, volumeType: "traffic" } });
    for (const member of members) {
      await prisma.workGroupMember.create({ data: { workGroupId: group.id, userId: member.id, workAreaId: area.id, effectiveFrom: new Date("2026-01-01T00:00:00") } });
    }
    await prisma.storeOperatingDay.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ storeId: store.id, dayOfWeek, isOpen: true, openTime: "09:00", closeTime: "21:00" })) });
  }
  const plan = await prisma.schedulePlan.create({ data: { id: "task6-plan", storeId: storeA.id, weekOf: "2026-07-20", mode: "work5rest2", status: "published", version: 1, publishedAt: new Date("2026-07-19T00:00:00+08:00"), createdById: manager.id } });
  const reqSchedule = await prisma.schedule.create({ data: { id: "task6-req", storeId: storeA.id, planId: plan.id, userId: employee.id, date: new Date("2026-07-20T00:00:00+08:00"), shiftType: "morning", weekOf: plan.weekOf } });
  const tgtSchedule = await prisma.schedule.create({ data: { id: "task6-tgt", storeId: storeA.id, planId: plan.id, userId: target.id, date: new Date("2026-07-21T00:00:00+08:00"), shiftType: "evening", weekOf: plan.weekOf } });
  return { storeA, storeB, manager, admin, employee, target, foreign, plan, reqSchedule, tgtSchedule };
}

beforeEach(async () => { await resetTestDb(); authState.user = null; });
afterAll(() => prisma.$disconnect());

describe("Task 6 unified approval transaction", () => {
  it("commits a mixed batch with aggregate balance, one corrected row and a full-plan swap", async () => {
    const f = await fixture();
    const leave = await prisma.leaveRequest.create({ data: { userId: f.employee.id, type: "annual", startTime: new Date("2026-07-22T09:00:00+08:00"), endTime: new Date("2026-07-22T17:00:00+08:00"), isFullDay: true, hours: 8, status: "pending" } });
    const correction = await prisma.punchCorrection.create({ data: { userId: f.employee.id, date: new Date("2026-07-23T00:00:00+08:00"), direction: "in", requestedTime: new Date("2026-07-23T09:03:00+08:00"), reason: "漏打卡" } });
    const swap = await prisma.shiftSwapRequest.create({ data: { requesterId: f.employee.id, targetUserId: f.target.id, reqScheduleId: f.reqSchedule.id, tgtScheduleId: f.tgtSchedule.id, status: "pending_manager" } });

    await decideApprovals({ user: f.manager, storeId: f.storeA.id }, { items: [{ type: "leave", id: leave.id }, { type: "punch_correction", id: correction.id }, { type: "shift_swap", id: swap.id }], decision: "approved", reason: "核对无误", aiLogIds: [] });

    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.employee.id } })).annualLeaveBalance).toBe(72);
    const attendance = await prisma.attendanceRecord.findMany({ where: { userId: f.employee.id, corrected: true } });
    expect(attendance).toHaveLength(1);
    expect(attendance[0]).toMatchObject({ viaCode: false, direction: "in" });
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(attendance[0].time)).toBe("2026-07-23");
    expect(await prisma.schedule.findUniqueOrThrow({ where: { id: f.reqSchedule.id } })).toMatchObject({ userId: f.target.id, source: "swap" });
    expect(await prisma.schedulePlan.findUniqueOrThrow({ where: { id: f.plan.id } })).toMatchObject({ version: 2 });
  });

  it("rolls back every effect when one selected record is cross-store", async () => {
    const f = await fixture();
    const local = await prisma.leaveRequest.create({ data: { userId: f.employee.id, type: "annual", startTime: new Date(), endTime: new Date(), isFullDay: true, hours: 8 } });
    const foreign = await prisma.leaveRequest.create({ data: { userId: f.foreign.id, type: "annual", startTime: new Date(), endTime: new Date(), isFullDay: true, hours: 8 } });
    await expect(decideApprovals({ user: f.manager, storeId: f.storeA.id }, { items: [{ type: "leave", id: local.id }, { type: "leave", id: foreign.id }], decision: "approved", reason: null, aiLogIds: [] })).rejects.toMatchObject({ status: 403 });
    expect(await prisma.leaveRequest.findUniqueOrThrow({ where: { id: local.id } })).toMatchObject({ status: "pending" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.employee.id } })).annualLeaveBalance).toBe(80);
  });

  it("uses per-record CAS so a duplicate decision returns 409 without a second decrement", async () => {
    const f = await fixture();
    const leave = await prisma.leaveRequest.create({ data: { userId: f.employee.id, type: "annual", startTime: new Date(), endTime: new Date(), isFullDay: true, hours: 8 } });
    const input = { items: [{ type: "leave" as const, id: leave.id }], decision: "approved" as const, reason: null, aiLogIds: [] };
    await decideApprovals({ user: f.manager, storeId: f.storeA.id }, input);
    await expect(decideApprovals({ user: f.manager, storeId: f.storeA.id }, input)).rejects.toMatchObject({ status: 409 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.employee.id } })).annualLeaveBalance).toBe(72);
  });

  it("requires target confirmation and full hard constraints before swap approval", async () => {
    const f = await fixture();
    const created = await createShiftSwap(f.employee, { reqScheduleId: f.reqSchedule.id, targetUserId: f.target.id, tgtScheduleId: f.tgtSchedule.id });
    await expect(decideApprovals({ user: f.manager, storeId: f.storeA.id }, { items: [{ type: "shift_swap", id: created.id }], decision: "approved", reason: null, aiLogIds: [] })).rejects.toMatchObject({ status: 409 });
    await expect(acceptTargetSwap(f.employee, created.id)).rejects.toMatchObject({ status: 403 });
    await acceptTargetSwap(f.target, created.id);
    expect(await prisma.shiftSwapRequest.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ status: "pending_manager" });
  });

  it("rejects manager approval when the full plan became invalid after target acceptance", async () => {
    const f = await fixture();
    const swap = await prisma.shiftSwapRequest.create({ data: { requesterId: f.employee.id, targetUserId: f.target.id, reqScheduleId: f.reqSchedule.id, tgtScheduleId: f.tgtSchedule.id, status: "pending_target" } });
    await acceptTargetSwap(f.target, swap.id);
    await prisma.unavailableSlot.create({ data: { userId: f.target.id, date: new Date("2026-07-20T00:00:00+08:00"), timeSlot: "morning", reason: "临时不可供班" } });
    await expect(decideApprovals({ user: f.manager, storeId: f.storeA.id }, { items: [{ type: "shift_swap", id: swap.id }], decision: "approved", reason: null, aiLogIds: [] })).rejects.toMatchObject({ status: 422, code: "hard_constraints" });
    expect(await prisma.shiftSwapRequest.findUniqueOrThrow({ where: { id: swap.id } })).toMatchObject({ status: "pending_manager" });
    expect(await prisma.schedulePlan.findUniqueOrThrow({ where: { id: f.plan.id } })).toMatchObject({ version: 1 });
  });

  it("validates two swaps on one resulting plan and increments its version only once", async () => {
    const f = await fixture();
    const req2 = await prisma.schedule.create({ data: { storeId: f.storeA.id, planId: f.plan.id, userId: f.employee.id, date: new Date("2026-07-22T00:00:00+08:00"), shiftType: "afternoon", weekOf: f.plan.weekOf } });
    const tgt2 = await prisma.schedule.create({ data: { storeId: f.storeA.id, planId: f.plan.id, userId: f.target.id, date: new Date("2026-07-23T00:00:00+08:00"), shiftType: "evening", weekOf: f.plan.weekOf } });
    const [one, two] = await Promise.all([
      prisma.shiftSwapRequest.create({ data: { requesterId: f.employee.id, targetUserId: f.target.id, reqScheduleId: f.reqSchedule.id, tgtScheduleId: f.tgtSchedule.id, status: "pending_manager" } }),
      prisma.shiftSwapRequest.create({ data: { requesterId: f.employee.id, targetUserId: f.target.id, reqScheduleId: req2.id, tgtScheduleId: tgt2.id, status: "pending_manager" } }),
    ]);
    await decideApprovals({ user: f.manager, storeId: f.storeA.id }, { items: [{ type: "shift_swap", id: one.id }, { type: "shift_swap", id: two.id }], decision: "approved", reason: "同意", aiLogIds: [] });
    expect(await prisma.shiftSwapRequest.count({ where: { id: { in: [one.id, two.id] }, status: "approved" } })).toBe(2);
    expect(await prisma.schedulePlan.findUniqueOrThrow({ where: { id: f.plan.id } })).toMatchObject({ version: 2 });
  });

  it("aggregates two leave rows and rolls back the mixed batch when their total exceeds balance", async () => {
    const f = await fixture();
    const [one, two, correction] = await Promise.all([
      prisma.leaveRequest.create({ data: { userId: f.employee.id, type: "annual", startTime: new Date(), endTime: new Date(), isFullDay: true, hours: 50 } }),
      prisma.leaveRequest.create({ data: { userId: f.employee.id, type: "annual", startTime: new Date(), endTime: new Date(), isFullDay: true, hours: 40 } }),
      prisma.punchCorrection.create({ data: { userId: f.employee.id, date: new Date("2026-07-23T00:00:00+08:00"), direction: "in", requestedTime: new Date("2026-07-23T09:00:00+08:00"), reason: "漏打卡" } }),
    ]);
    await expect(decideApprovals({ user: f.manager, storeId: f.storeA.id }, { items: [{ type: "leave", id: one.id }, { type: "leave", id: two.id }, { type: "punch_correction", id: correction.id }], decision: "approved", reason: null, aiLogIds: [] })).rejects.toMatchObject({ status: 409, code: "insufficient_balance" });
    expect(await prisma.leaveRequest.count({ where: { id: { in: [one.id, two.id] }, status: "pending" } })).toBe(2);
    expect(await prisma.punchCorrection.findUniqueOrThrow({ where: { id: correction.id } })).toMatchObject({ status: "pending" });
    expect(await prisma.attendanceRecord.count({ where: { corrected: true } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.employee.id } })).annualLeaveBalance).toBe(80);
  });

  it("validates swaps against leave approved in the same mixed batch and rolls everything back", async () => {
    const f = await fixture();
    const leave = await prisma.leaveRequest.create({ data: { userId: f.employee.id, type: "annual", startTime: new Date("2026-07-21T16:00:00+08:00"), endTime: new Date("2026-07-21T22:00:00+08:00"), isFullDay: false, hours: 6 } });
    const swap = await prisma.shiftSwapRequest.create({ data: { requesterId: f.employee.id, targetUserId: f.target.id, reqScheduleId: f.reqSchedule.id, tgtScheduleId: f.tgtSchedule.id, status: "pending_manager" } });
    await expect(decideApprovals({ user: f.manager, storeId: f.storeA.id }, { items: [{ type: "leave", id: leave.id }, { type: "shift_swap", id: swap.id }], decision: "approved", reason: null, aiLogIds: [] })).rejects.toMatchObject({ status: 422, code: "hard_constraints" });
    expect(await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } })).toMatchObject({ status: "pending" });
    expect(await prisma.shiftSwapRequest.findUniqueOrThrow({ where: { id: swap.id } })).toMatchObject({ status: "pending_manager" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.employee.id } })).annualLeaveBalance).toBe(80);
    expect(await prisma.schedulePlan.findUniqueOrThrow({ where: { id: f.plan.id } })).toMatchObject({ version: 1 });
  });

  it("rejects wrong-event and cross-store AI logs and rolls back stale advice logs", async () => {
    const f = await fixture();
    const leave = await prisma.leaveRequest.create({ data: { userId: f.employee.id, type: "annual", startTime: new Date(), endTime: new Date(), isFullDay: true, hours: 8 } });
    const base = { userId: f.manager.id, approvalType: "leave", approvalId: leave.id, feature: "audit_checker", provider: "mock", model: "mock", inputText: "x", outputText: "x" };
    const wrongEvent = await prisma.aiInteractionLog.create({ data: { ...base, storeId: f.storeA.id, eventKind: "approval:leave:wrong" } });
    const crossStore = await prisma.aiInteractionLog.create({ data: { ...base, storeId: f.storeB.id, eventKind: `approval:leave:${leave.id}` } });
    const invalidOutput = await prisma.aiInteractionLog.create({ data: { ...base, storeId: f.storeA.id, eventKind: `approval:leave:${leave.id}` } });
    for (const aiLogId of [wrongEvent.id, crossStore.id, invalidOutput.id]) {
      await expect(decideApprovals({ user: f.manager, storeId: f.storeA.id }, { items: [{ type: "leave", id: leave.id }], decision: "approved", reason: null, aiLogIds: [aiLogId] })).rejects.toMatchObject({ status: 400, code: "invalid_ai_log" });
      expect(await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } })).toMatchObject({ status: "pending" });
    }
    await prisma.leaveRequest.update({ where: { id: leave.id }, data: { status: "approved" } });
    const countBefore = await prisma.aiInteractionLog.count();
    await expect(saveApprovalAdvice({ user: f.manager, storeId: f.storeA.id }, { type: "leave", id: leave.id }, { suggestion: "compliant", reason: "x" }, { provider: "mock", model: "mock", inputText: "x", outputText: "x" })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.aiInteractionLog.count()).toBe(countBefore);
  });

  it("binds AI feedback to each referenced log's own suggestion", async () => {
    const f = await fixture();
    const leave = await prisma.leaveRequest.create({
      data: {
        userId: f.employee.id,
        type: "annual",
        startTime: new Date("2026-07-24T09:00:00+08:00"),
        endTime: new Date("2026-07-24T17:00:00+08:00"),
        isFullDay: true,
        hours: 8,
        aiComplianceSuggestion: "suspicious",
        aiComplianceReason: "newer advice",
      },
    });
    const base = {
      userId: f.manager.id,
      storeId: f.storeA.id,
      approvalType: "leave",
      approvalId: leave.id,
      eventKind: `approval:leave:${leave.id}`,
      feature: "audit_checker",
      provider: "mock",
      model: "mock",
      inputText: "x",
    };
    const compliantLog = await prisma.aiInteractionLog.create({
      data: {
        ...base,
        outputText: JSON.stringify({ suggestion: "compliant", reason: "older advice" }),
      },
    });
    const suspiciousLog = await prisma.aiInteractionLog.create({
      data: {
        ...base,
        outputText: JSON.stringify({ suggestion: "suspicious", reason: "newer advice" }),
      },
    });

    await decideApprovals(
      { user: f.manager, storeId: f.storeA.id },
      {
        items: [{ type: "leave", id: leave.id }],
        decision: "approved",
        reason: null,
        aiLogIds: [compliantLog.id],
      },
    );

    expect(await prisma.aiInteractionLog.findUniqueOrThrow({ where: { id: compliantLog.id } })).toMatchObject({ wasAccepted: true });
    expect(await prisma.aiInteractionLog.findUniqueOrThrow({ where: { id: suspiciousLog.id } })).toMatchObject({ wasAccepted: null });
  });

  it("rolls back a mixed batch when persisted correction time is on another Shanghai date", async () => {
    const f = await fixture();
    const leave = await prisma.leaveRequest.create({
      data: {
        userId: f.employee.id,
        type: "annual",
        startTime: new Date("2026-07-24T09:00:00+08:00"),
        endTime: new Date("2026-07-24T17:00:00+08:00"),
        isFullDay: true,
        hours: 8,
      },
    });
    const correction = await prisma.punchCorrection.create({
      data: {
        userId: f.employee.id,
        date: new Date("2026-07-23T00:00:00+08:00"),
        direction: "in",
        requestedTime: new Date("2026-07-24T09:00:00+08:00"),
        reason: "persisted legacy row",
      },
    });

    await expect(
      decideApprovals(
        { user: f.manager, storeId: f.storeA.id },
        {
          items: [
            { type: "leave", id: leave.id },
            { type: "punch_correction", id: correction.id },
          ],
          decision: "approved",
          reason: null,
          aiLogIds: [],
        },
      ),
    ).rejects.toMatchObject({ status: 409, code: "invalid_correction_date" });

    expect(await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } })).toMatchObject({ status: "pending" });
    expect(await prisma.punchCorrection.findUniqueOrThrow({ where: { id: correction.id } })).toMatchObject({ status: "pending" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.employee.id } })).annualLeaveBalance).toBe(80);
    expect(await prisma.attendanceRecord.count({ where: { corrected: true } })).toBe(0);
  });

  it("keeps admin read-only and employee applications self-scoped", async () => {
    const f = await fixture();
    await expect(decideApprovals({ user: f.admin, storeId: f.storeA.id }, { items: [{ type: "leave", id: "x" }], decision: "approved", reason: null, aiLogIds: [] })).rejects.toBeInstanceOf(ApprovalServiceError);
    await expect(createPunchCorrection(f.manager, { date: "2026-07-23", direction: "in", requestedTime: "2026-07-23T09:00:00+08:00", reason: "x" })).rejects.toMatchObject({ status: 403 });
    const correction = await createPunchCorrection(f.employee, { date: "2026-07-23", direction: "in", requestedTime: "2026-07-23T09:00:00+08:00", reason: "漏打卡" });
    expect(correction.userId).toBe(f.employee.id);
  });

  it("enforces admin explicit-store read-only APIs and employee-only create APIs", async () => {
    const f = await fixture();
    authState.user = f.admin;
    expect((await approvalsRoute.GET(new Request("http://localhost/api/approvals"))).status).toBe(400);
    expect((await approvalsRoute.GET(new Request(`http://localhost/api/approvals?storeId=${f.storeA.id}`))).status).toBe(200);
    expect((await decideRoute.POST(new Request("http://localhost/api/approvals/decide", { method: "POST", body: JSON.stringify({ storeId: f.storeA.id, items: [{ type: "leave", id: "x" }], decision: "approved", reason: null, aiLogIds: [] }) }))).status).toBe(403);
    expect((await aiRoute.POST(new Request("http://localhost/api/approvals/ai-check", { method: "POST", body: JSON.stringify({ storeId: f.storeA.id, type: "leave", id: "x" }) }))).status).toBe(403);
    expect((await leaveRoute.POST(new Request("http://localhost/api/leave", { method: "POST", body: "{}" }))).status).toBe(403);
    expect((await correctionRoute.POST(new Request("http://localhost/api/punch-corrections", { method: "POST", body: "{}" }))).status).toBe(403);
  });

  it("wires target acceptance through the employee route and rejects invalid accept input", async () => {
    const f = await fixture();
    const swap = await prisma.shiftSwapRequest.create({ data: { requesterId: f.employee.id, targetUserId: f.target.id, reqScheduleId: f.reqSchedule.id, tgtScheduleId: f.tgtSchedule.id, status: "pending_target" } });
    authState.user = f.target;
    const invalid = await swapRoute.POST(new Request("http://localhost/api/shift-swaps", { method: "POST", body: JSON.stringify({ action: "accept_target" }) }));
    expect(invalid.status).toBe(400);
    const accepted = await swapRoute.POST(new Request("http://localhost/api/shift-swaps", { method: "POST", body: JSON.stringify({ action: "accept_target", requestId: swap.id }) }));
    expect(accepted.status).toBe(200);
    const listed = await swapRoute.GET();
    const payload = await listed.json() as { data: Array<{ id: string; currentUserId: string; status: string }> };
    expect(payload.data).toContainEqual(expect.objectContaining({ id: swap.id, currentUserId: f.target.id, status: "pending_manager" }));
  });

  it("counts all three actionable approval types on the scoped dashboard", async () => {
    const f = await fixture();
    await prisma.leaveRequest.create({ data: { userId: f.employee.id, type: "annual", startTime: new Date(), endTime: new Date(), isFullDay: true, hours: 8 } });
    await prisma.punchCorrection.create({ data: { userId: f.employee.id, date: new Date(), direction: "in", requestedTime: new Date(), reason: "x" } });
    await prisma.shiftSwapRequest.create({ data: { requesterId: f.employee.id, targetUserId: f.target.id, reqScheduleId: f.reqSchedule.id, tgtScheduleId: f.tgtSchedule.id, status: "pending_manager" } });
    expect((await getDashboardSummary(f.storeA.id)).pendingApprovals).toBe(3);
  });
});
