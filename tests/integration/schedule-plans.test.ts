import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth";

const authState = vi.hoisted(() => ({ user: null as SessionUser | null }));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    getSession: vi.fn(async () => authState.user),
    requireSession: vi.fn(async (roles?: SessionUser["role"][]) => {
      if (!authState.user) return { error: "未登录", status: 401 };
      if (roles && !roles.includes(authState.user.role)) {
        return { error: "无权限访问该功能", status: 403 };
      }
      return { user: authState.user };
    }),
  };
});

import { prisma, resetTestDb } from "../helpers/test-db";
import {
  PlanConflictError,
  createPlan,
  getPlanDetail,
  saveRecommendation,
  updatePlanMode,
} from "@/features/scheduling/server/plan-service";
import { buildEmployeesWithUnavailable } from "@/lib/scheduleBuild";
import * as plansRoute from "@/app/api/schedule/plans/route";
import * as forecastRoute from "@/app/api/schedule/forecast/route";
import * as unavailableRoute from "@/app/api/schedule/unavailable/route";
import * as generateRoute from "@/app/api/schedule/generate/route";
import * as legacyPlanRoute from "@/app/api/schedule/plan/route";
import * as saveRoute from "@/app/api/schedule/save/route";

function session(
  id: string,
  role: SessionUser["role"],
  storeId: string | null,
): SessionUser {
  return { id, role, storeId, name: id, phone: `test-${id}` };
}

function request(path: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function payload(response: Response) {
  return (await response.json()) as {
    ok: boolean;
    error?: string;
    data?: Record<string, any> | any[];
  };
}

async function createFixture() {
  const storeA = await prisma.store.create({
    data: { id: "store-a", name: "A 店", code: "A" },
  });
  const storeB = await prisma.store.create({
    data: { id: "store-b", name: "B 店", code: "B" },
  });
  const managerA = session("manager-a", "manager", storeA.id);
  const managerB = session("manager-b", "manager", storeB.id);
  const admin = session("admin", "admin", null);
  const employeeA = session("employee-a", "employee", storeA.id);
  const employeeB = session("employee-b", "employee", storeB.id);
  for (const user of [managerA, managerB, admin, employeeA, employeeB]) {
    await prisma.user.create({
      data: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        role: user.role,
        storeId: user.storeId,
        employeeNo: user.role === "employee" ? user.id : null,
        position: user.role === "employee" ? "sales" : null,
      },
    });
  }
  for (const storeId of [storeA.id, storeB.id]) {
    await prisma.storeOperatingDay.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        storeId,
        dayOfWeek,
        isOpen: dayOfWeek !== 0,
        openTime: "09:00",
        closeTime: "21:00",
      })),
    });
  }
  const area = await prisma.workArea.create({
    data: { id: "area-a", storeId: storeA.id, name: "卖场", code: "FLOOR" },
  });
  const group = await prisma.workGroup.create({
    data: {
      id: "group-a",
      storeId: storeA.id,
      name: "销售组",
      leaderId: managerA.id,
      volumeType: "traffic",
    },
  });
  await prisma.workGroupMember.create({
    data: {
      workGroupId: group.id,
      userId: employeeA.id,
      workAreaId: area.id,
      effectiveFrom: new Date("2026-01-01T00:00:00"),
    },
  });
  return { storeA, storeB, managerA, managerB, admin, employeeA, employeeB };
}

beforeEach(async () => {
  await resetTestDb();
  authState.user = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("schedule plan service", () => {
  it("rejects a duplicate store and week with a domain conflict", async () => {
    const fixture = await createFixture();
    const scope = { user: fixture.managerA, storeId: fixture.storeA.id };
    await createPlan(scope, { weekOf: "2026-07-20", mode: "work5rest2" });

    await expect(
      createPlan(scope, { weekOf: "2026-07-20", mode: "work6rest1" }),
    ).rejects.toBeInstanceOf(PlanConflictError);
  });

  it("rejects a cross-store detail before returning employees", async () => {
    const fixture = await createFixture();
    const plan = await createPlan(
      { user: fixture.managerA, storeId: fixture.storeA.id },
      { weekOf: "2026-07-20", mode: "work5rest2" },
    );

    await expect(
      getPlanDetail(
        { user: fixture.managerB, storeId: fixture.storeB.id },
        plan.id,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("uses CAS and creates one canonical metric per generation", async () => {
    const fixture = await createFixture();
    const scope = { user: fixture.managerA, storeId: fixture.storeA.id };
    const plan = await createPlan(scope, {
      weekOf: "2026-07-20",
      mode: "work5rest2",
    });
    await prisma.aiInteractionLog.createMany({
      data: [
        {
          userId: fixture.managerA.id,
          storeId: fixture.storeA.id,
          planId: plan.id,
          feature: "schedule_advisor",
          inputText: "raw parse",
          outputText: "{}",
        },
        {
          userId: fixture.managerA.id,
          storeId: fixture.storeA.id,
          planId: plan.id,
          feature: "schedule_advisor",
          inputText: "raw explain",
          outputText: "explanation",
        },
      ],
    });

    const first = await saveRecommendation(scope, {
      planId: plan.id,
      version: 0,
      recommendation: { assignments: [], gaps: [] },
      metric: { provider: "mock", model: "test", totalCells: 21 },
    });
    expect(first.version).toBe(1);
    await expect(
      saveRecommendation(scope, {
        planId: plan.id,
        version: 0,
        recommendation: { assignments: [], gaps: [] },
        metric: { provider: "mock", model: "stale", totalCells: 21 },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await prisma.aiInteractionLog.count({
        where: { planId: plan.id, eventKind: "schedule_plan_metric" },
      }),
    ).toBe(1);

    const second = await saveRecommendation(scope, {
      planId: plan.id,
      version: 1,
      recommendation: { assignments: [], gaps: [{ shortfall: 1 }] },
      metric: { provider: "mock", model: "test", totalCells: 21 },
    });
    const current = await prisma.schedulePlan.findUniqueOrThrow({
      where: { id: plan.id },
    });
    const canonical = await prisma.aiInteractionLog.findMany({
      where: { planId: plan.id, eventKind: "schedule_plan_metric" },
      orderBy: { createdAt: "asc" },
    });
    expect(second.version).toBe(2);
    expect(canonical).toHaveLength(2);
    expect(current.recommendationAiLogId).toBe(canonical[1].id);
    expect(canonical.every((row) => row.storeId === fixture.storeA.id)).toBe(true);
  });

  it("atomically versions a mode change and invalidates an old recommendation", async () => {
    const fixture = await createFixture();
    const scope = { user: fixture.managerA, storeId: fixture.storeA.id };
    const plan = await createPlan(scope, {
      weekOf: "2026-07-20",
      mode: "work5rest2",
    });
    await saveRecommendation(scope, {
      planId: plan.id,
      version: 0,
      recommendation: { assignments: [], gaps: [] },
      metric: { totalCells: 21 },
    });

    const changed = await updatePlanMode(scope, {
      id: plan.id,
      mode: "work6rest1",
      version: 1,
    });
    expect(changed).toMatchObject({ version: 2, status: "draft", mode: "work6rest1" });
    await expect(
      saveRecommendation(scope, {
        planId: plan.id,
        version: 1,
        recommendation: { assignments: [], gaps: [] },
        metric: { totalCells: 21 },
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      prisma.schedulePlan.findUniqueOrThrow({ where: { id: plan.id } }),
    ).resolves.toMatchObject({
      recommendationJson: null,
      recommendationAiLogId: null,
    });
  });

  it("blocks membership-outside days and excludes an invalid legacy position", async () => {
    const fixture = await createFixture();
    await prisma.workGroupMember.updateMany({
      where: { userId: fixture.employeeA.id },
      data: {
        effectiveFrom: new Date("2026-07-22T00:00:00"),
        effectiveTo: new Date("2026-07-24T23:59:59"),
      },
    });
    const invalid = await prisma.user.create({
      data: {
        id: "legacy-chef",
        phone: "13111111111",
        employeeNo: "CHEF-1",
        name: "历史非法岗位",
        role: "employee",
        storeId: fixture.storeA.id,
        position: "chef",
      },
    });
    const area = await prisma.workArea.findUniqueOrThrow({ where: { id: "area-a" } });
    const group = await prisma.workGroup.findUniqueOrThrow({ where: { id: "group-a" } });
    await prisma.workGroupMember.create({
      data: {
        workGroupId: group.id,
        userId: invalid.id,
        workAreaId: area.id,
        effectiveFrom: new Date("2026-01-01T00:00:00"),
      },
    });

    const days = [
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
    ];
    const employees = await buildEmployeesWithUnavailable(
      fixture.storeA.id,
      "2026-07-20",
      days,
    );
    expect(employees.map((employee) => employee.id)).toEqual([fixture.employeeA.id]);
    const unavailable = new Set(
      employees[0].unavailable?.map((slot) => `${slot.date}:${slot.shift}`),
    );
    for (const date of ["2026-07-20", "2026-07-21", "2026-07-25", "2026-07-26"]) {
      for (const shift of ["morning", "afternoon", "evening"]) {
        expect(unavailable.has(`${date}:${shift}`)).toBe(true);
      }
    }
  });
});

describe("schedule plan routes", () => {
  it("returns 400 for a non-Monday week and an impossible local date", async () => {
    const fixture = await createFixture();
    authState.user = fixture.managerA;

    let response = await plansRoute.POST(
      request("/api/schedule/plans", "POST", {
        weekOf: "2026-07-21",
        mode: "work5rest2",
      }),
    );
    expect(response.status).toBe(400);

    response = await plansRoute.POST(
      request("/api/schedule/plans", "POST", {
        weekOf: "2026-02-30",
        mode: "work5rest2",
      }),
    );
    expect(response.status).toBe(400);

    response = await legacyPlanRoute.GET(
      request("/api/schedule/plan?weekOf=2026-07-21"),
    );
    expect(response.status).toBe(400);
  });

  it("restores a persisted current recommendation and tolerates corrupt legacy JSON", async () => {
    const fixture = await createFixture();
    authState.user = fixture.managerA;
    const plan = await createPlan(
      { user: fixture.managerA, storeId: fixture.storeA.id },
      { weekOf: "2026-07-20", mode: "work5rest2" },
    );
    const recommendation = {
      assignments: [],
      gaps: [],
      note: "",
      explanation: "服务端推荐",
      status: "feasible",
    };
    await prisma.schedulePlan.update({
      where: { id: plan.id },
      data: { recommendationJson: JSON.stringify(recommendation) },
    });
    let response = await legacyPlanRoute.GET(
      request(`/api/schedule/plan?id=${plan.id}`),
    );
    expect(response.status).toBe(200);
    expect((await payload(response)).data).toMatchObject({ recommendation });

    await prisma.schedulePlan.update({
      where: { id: plan.id },
      data: { recommendationJson: "{broken" },
    });
    response = await legacyPlanRoute.GET(
      request(`/api/schedule/plan?id=${plan.id}`),
    );
    expect(response.status).toBe(200);
    expect((await payload(response)).data).toMatchObject({ recommendation: null });
  });

  it("allows scoped reads but only a manager can create", async () => {
    const fixture = await createFixture();
    authState.user = fixture.managerA;
    let response: Response = await plansRoute.POST(
      request("/api/schedule/plans", "POST", {
        storeId: fixture.storeB.id,
        weekOf: "2026-07-20",
        mode: "work5rest2",
      }),
    );
    expect(response.status).toBe(403);
    expect(await prisma.schedulePlan.count()).toBe(0);

    response = await plansRoute.POST(
      request("/api/schedule/plans", "POST", {
        storeId: fixture.storeA.id,
        weekOf: "2026-07-20",
        mode: "work5rest2",
      }),
    );
    expect(response.status).toBe(201);
    expect(await prisma.schedulePlan.findFirst()).toMatchObject({ storeId: fixture.storeA.id });

    authState.user = fixture.admin;
    response = await plansRoute.GET(
      request(`/api/schedule/plans?storeId=${fixture.storeA.id}`),
    );
    expect(response.status).toBe(200);
    response = await plansRoute.POST(
      request("/api/schedule/plans", "POST", {
        storeId: fixture.storeA.id,
        weekOf: "2026-07-27",
        mode: "work5rest2",
      }),
    );
    expect(response.status).toBe(403);

    authState.user = fixture.employeeA;
    response = await plansRoute.POST(
      request("/api/schedule/plans", "POST", {
        weekOf: "2026-07-27",
        mode: "work5rest2",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects a forecast adjustment without a reason", async () => {
    const fixture = await createFixture();
    authState.user = fixture.managerA;
    const response = await forecastRoute.POST(
      request("/api/schedule/forecast", "POST", {
        planId: "plan-a",
        date: "2026-07-20",
        timeSlot: "morning",
        adjusted: 99,
        reason: "",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("invalidates a recommendation when forecast input changes and rejects the stale solve", async () => {
    const fixture = await createFixture();
    authState.user = fixture.managerA;
    const scope = { user: fixture.managerA, storeId: fixture.storeA.id };
    const plan = await createPlan(scope, {
      weekOf: "2026-07-20",
      mode: "work5rest2",
    });
    await saveRecommendation(scope, {
      planId: plan.id,
      version: 0,
      recommendation: { assignments: [], gaps: [] },
      metric: { totalCells: 21 },
    });

    const response = await forecastRoute.POST(
      request("/api/schedule/forecast", "POST", {
        planId: plan.id,
        version: 1,
        date: "2026-07-20",
        timeSlot: "morning",
        adjusted: 99,
        reason: "商场活动",
      }),
    );

    expect(response.status).toBe(200);
    expect((await payload(response)).data).toMatchObject({
      plan: { id: plan.id, version: 2, status: "draft" },
    });
    await expect(
      prisma.schedulePlan.findUniqueOrThrow({ where: { id: plan.id } }),
    ).resolves.toMatchObject({
      version: 2,
      status: "draft",
      recommendationJson: null,
      recommendationAiLogId: null,
    });
    await expect(
      saveRecommendation(scope, {
        planId: plan.id,
        version: 1,
        recommendation: { assignments: [{ stale: true }], gaps: [] },
        metric: { totalCells: 21 },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("uses plan CAS for manager unavailable upsert and delete and rolls both back when stale", async () => {
    const fixture = await createFixture();
    authState.user = fixture.managerA;
    const scope = { user: fixture.managerA, storeId: fixture.storeA.id };
    const plan = await createPlan(scope, {
      weekOf: "2026-07-20",
      mode: "work5rest2",
    });
    await saveRecommendation(scope, {
      planId: plan.id,
      version: 0,
      recommendation: { assignments: [], gaps: [] },
      metric: { totalCells: 21 },
    });

    let response: Response = await unavailableRoute.POST(
      request("/api/schedule/unavailable", "POST", {
        planId: plan.id,
        version: 1,
        userId: fixture.employeeA.id,
        date: "2026-07-20",
        timeSlot: "morning",
      }),
    );
    expect(response.status).toBe(200);
    const added = await payload(response);
    expect(added.data).toMatchObject({ plan: { id: plan.id, version: 2 } });

    response = await unavailableRoute.POST(
      request("/api/schedule/unavailable", "POST", {
        planId: plan.id,
        version: 1,
        userId: fixture.employeeA.id,
        date: "2026-07-20",
        timeSlot: "evening",
      }),
    );
    expect(response.status).toBe(409);
    expect(
      await prisma.unavailableSlot.findUnique({
        where: {
          userId_date_timeSlot: {
            userId: fixture.employeeA.id,
            date: new Date("2026-07-20T00:00:00"),
            timeSlot: "evening",
          },
        },
      }),
    ).toBeNull();

    response = await unavailableRoute.DELETE(
      request(
        `/api/schedule/unavailable?id=${(added.data as any).id}&planId=${plan.id}&version=2`,
        "DELETE",
      ),
    );
    expect(response.status).toBe(200);
    expect((await payload(response)).data).toMatchObject({
      plan: { id: plan.id, version: 3 },
    });

    const retained = await prisma.unavailableSlot.create({
      data: {
        userId: fixture.employeeA.id,
        date: new Date("2026-07-21T00:00:00"),
        timeSlot: "afternoon",
      },
    });
    response = await unavailableRoute.DELETE(
      request(
        `/api/schedule/unavailable?id=${retained.id}&planId=${plan.id}&version=2`,
        "DELETE",
      ),
    );
    expect(response.status).toBe(409);
    await expect(
      prisma.unavailableSlot.findUnique({ where: { id: retained.id } }),
    ).resolves.toBeTruthy();
  });

  it("invalidates only affected non-published plans for employee unavailable changes", async () => {
    const fixture = await createFixture();
    const scope = { user: fixture.managerA, storeId: fixture.storeA.id };
    const affected = await createPlan(scope, {
      weekOf: "2026-07-20",
      mode: "work5rest2",
    });
    const unaffected = await createPlan(scope, {
      weekOf: "2026-07-27",
      mode: "work5rest2",
    });
    await saveRecommendation(scope, {
      planId: affected.id,
      version: 0,
      recommendation: { assignments: [], gaps: [] },
      metric: { totalCells: 21 },
    });
    await saveRecommendation(scope, {
      planId: unaffected.id,
      version: 0,
      recommendation: { assignments: [], gaps: [] },
      metric: { totalCells: 21 },
    });
    authState.user = fixture.employeeA;

    const response = await unavailableRoute.POST(
      request("/api/schedule/unavailable", "POST", {
        date: "2026-07-20",
        timeSlot: "morning",
      }),
    );

    expect(response.status).toBe(200);
    await expect(
      prisma.schedulePlan.findUniqueOrThrow({ where: { id: affected.id } }),
    ).resolves.toMatchObject({
      version: 2,
      status: "draft",
      recommendationJson: null,
      recommendationAiLogId: null,
    });
    await expect(
      prisma.schedulePlan.findUniqueOrThrow({ where: { id: unaffected.id } }),
    ).resolves.toMatchObject({ version: 1, status: "recommended" });
  });

  it("maps an unavailable engine to 503 without a fallback", async () => {
    const fixture = await createFixture();
    authState.user = fixture.managerA;
    const plan = await createPlan(
      { user: fixture.managerA, storeId: fixture.storeA.id },
      { weekOf: "2026-07-20", mode: "work5rest2" },
    );
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("engine offline");
    }));

    const response = await generateRoute.POST(
      request("/api/schedule/generate", "POST", { planId: plan.id }),
    );
    expect(response.status).toBe(503);
    expect((await payload(response)).error).toContain("优化引擎");
  });

  it("sends closed Sunday as zero demand and blocks every employee shift", async () => {
    const fixture = await createFixture();
    authState.user = fixture.managerA;
    const plan = await createPlan(
      { user: fixture.managerA, storeId: fixture.storeA.id },
      { weekOf: "2026-07-20", mode: "work5rest2" },
    );
    await prisma.minStaffingConfig.createMany({
      data: ["morning", "afternoon", "evening"].flatMap((timeSlot) =>
        ["cashier", "sales"].map((position) => ({
          storeId: fixture.storeA.id,
          dayOfWeek: 0,
          timeSlot,
          position,
          minHeadcount: position === "cashier" ? 1 : 3,
        })),
      ),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "feasible",
            message: "ok",
            assignments: [],
            gaps: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await generateRoute.POST(
      request("/api/schedule/generate", "POST", { planId: plan.id, version: 0 }),
    );

    expect(response.status).toBe(200);
    const solveRequest = JSON.parse(
      (fetchMock.mock.calls[1][1] as RequestInit).body as string,
    );
    expect(solveRequest.demand["2026-07-26"]).toEqual({
      morning: 0,
      afternoon: 0,
      evening: 0,
    });
    expect(solveRequest.position_demand["2026-07-26"]).toEqual({
      morning: { cashier: 0, sales: 0 },
      afternoon: { cashier: 0, sales: 0 },
      evening: { cashier: 0, sales: 0 },
    });
    expect(solveRequest.employees[0].unavailable).toEqual(
      expect.arrayContaining([
        { date: "2026-07-26", shift: "morning" },
        { date: "2026-07-26", shift: "afternoon" },
        { date: "2026-07-26", shift: "evening" },
      ]),
    );
  });

  it("lets only the own-store manager save a plan-scoped manual draft", async () => {
    const fixture = await createFixture();
    const plan = await createPlan(
      { user: fixture.managerA, storeId: fixture.storeA.id },
      { weekOf: "2026-07-20", mode: "work5rest2" },
    );
    authState.user = fixture.managerA;
    let response = await saveRoute.POST(
      request("/api/schedule/save", "POST", {
        planId: plan.id,
        version: 0,
        weekOf: "2026-07-20",
        assignments: [
          {
            userId: fixture.employeeB.id,
            date: "2026-07-20",
            shiftType: "morning",
          },
        ],
        source: "manual",
      }),
    );
    expect(response.status).toBe(403);
    expect(await prisma.schedule.count()).toBe(0);

    response = await saveRoute.POST(
      request("/api/schedule/save", "POST", {
        planId: plan.id,
        version: 0,
        weekOf: "2026-07-20",
        assignments: [
          {
            userId: fixture.employeeA.id,
            date: "2026-07-20",
            shiftType: "morning",
          },
        ],
        source: "manual",
      }),
    );
    expect(response.status).toBe(200);
    expect((await payload(response)).data).toMatchObject({
      saved: 1,
      plan: { id: plan.id, version: 1, status: "draft" },
    });
    await expect(prisma.schedule.findFirstOrThrow()).resolves.toMatchObject({
      storeId: fixture.storeA.id,
      userId: fixture.employeeA.id,
      planId: plan.id,
      source: "manual",
    });

    authState.user = fixture.admin;
    response = await saveRoute.POST(
      request("/api/schedule/save", "POST", {
        planId: plan.id,
        version: 1,
        weekOf: "2026-07-20",
        assignments: [],
        source: "manual",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects admin generation and a manager cross-store planId", async () => {
    const fixture = await createFixture();
    const foreignPlan = await createPlan(
      { user: fixture.managerB, storeId: fixture.storeB.id },
      { weekOf: "2026-07-20", mode: "work5rest2" },
    );
    authState.user = fixture.managerA;
    let response = await generateRoute.POST(
      request("/api/schedule/generate", "POST", { planId: foreignPlan.id }),
    );
    expect(response.status).toBe(403);

    authState.user = fixture.admin;
    response = await generateRoute.POST(
      request("/api/schedule/generate", "POST", { planId: foreignPlan.id }),
    );
    expect(response.status).toBe(403);
  });

  it("maps a real engine infeasible result to 422", async () => {
    const fixture = await createFixture();
    authState.user = fixture.managerA;
    const plan = await createPlan(
      { user: fixture.managerA, storeId: fixture.storeA.id },
      { weekOf: "2026-07-20", mode: "work5rest2" },
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "infeasible",
            message: "hard constraints conflict",
            assignments: [],
            gaps: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await generateRoute.POST(
      request("/api/schedule/generate", "POST", { planId: plan.id }),
    );
    expect(response.status).toBe(422);
    expect((await payload(response)).error).toContain("hard constraints conflict");
  });

  it("maps a solve-stage network failure to 503", async () => {
    const fixture = await createFixture();
    authState.user = fixture.managerA;
    const plan = await createPlan(
      { user: fixture.managerA, storeId: fixture.storeA.id },
      { weekOf: "2026-07-20", mode: "work5rest2" },
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok" }), { status: 200 }))
        .mockRejectedValueOnce(new Error("solve connection reset")),
    );

    const response = await generateRoute.POST(
      request("/api/schedule/generate", "POST", { planId: plan.id }),
    );
    expect(response.status).toBe(503);
    expect((await payload(response)).error).toContain("优化引擎不可用");
  });
});

describe("unavailable self-only authorization", () => {
  it("ignores an employee supplied userId and rejects deleting another owner", async () => {
    const fixture = await createFixture();
    authState.user = fixture.employeeA;
    let response: Response = await unavailableRoute.POST(
      request("/api/schedule/unavailable", "POST", {
        userId: fixture.employeeB.id,
        date: "2026-07-20",
        timeSlot: "morning",
      }),
    );
    expect(response.status).toBe(200);
    expect(await prisma.unavailableSlot.findFirst()).toMatchObject({
      userId: fixture.employeeA.id,
    });

    const other = await prisma.unavailableSlot.create({
      data: {
        userId: fixture.employeeB.id,
        date: new Date("2026-07-20T00:00:00"),
        timeSlot: "afternoon",
      },
    });
    response = await unavailableRoute.DELETE(
      request(`/api/schedule/unavailable?id=${other.id}`, "DELETE"),
    );
    expect(response.status).toBe(403);
  });

  it("rejects managers targeting another store and keeps admin read-only", async () => {
    const fixture = await createFixture();
    authState.user = fixture.managerA;
    let response = await unavailableRoute.POST(
      request("/api/schedule/unavailable", "POST", {
        userId: fixture.employeeB.id,
        date: "2026-07-20",
        timeSlot: "morning",
      }),
    );
    expect(response.status).toBe(403);

    authState.user = fixture.admin;
    response = await unavailableRoute.POST(
      request("/api/schedule/unavailable", "POST", {
        userId: fixture.employeeA.id,
        date: "2026-07-20",
        timeSlot: "morning",
      }),
    );
    expect(response.status).toBe(403);
  });
});
