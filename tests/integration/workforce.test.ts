import { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/lib/auth";
import type { StoreScope } from "@/lib/authorization";

const authState = vi.hoisted(() => ({ user: null as SessionUser | null }));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    requireSession: vi.fn(async (roles?: SessionUser["role"][]) => {
      if (!authState.user) return { error: "未登录", status: 401 };
      if (roles && !roles.includes(authState.user.role)) return { error: "无权限访问该功能", status: 403 };
      return { user: authState.user };
    }),
  };
});
import {
  WorkforceConflictError,
  addWorkGroupMember,
  createWorkGroup,
  createEmployee,
  updateWorkArea,
  updateWorkGroup,
} from "@/features/store/server/workforce-service";
import { prisma, resetTestDb } from "../helpers/test-db";
import * as workAreasRoute from "@/app/api/store/work-areas/route";
import * as workGroupsRoute from "@/app/api/store/work-groups/route";
import * as membersRoute from "@/app/api/store/work-groups/members/route";
import * as employeesRoute from "@/app/api/store/employees/route";
import { dateRangesOverlap } from "@/features/store/server/membership-overlap";
import { dateOnlyToDate } from "@/lib/contracts/store";
import { seedDatabase } from "../../prisma/seed";

function managerScope(user: {
  id: string;
  name: string;
  phone: string;
  storeId: string | null;
}): StoreScope {
  if (!user.storeId) throw new Error("manager store is required");
  return {
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: "manager",
      storeId: user.storeId,
    },
    storeId: user.storeId,
  };
}

async function createFixture() {
  const store = await prisma.store.create({ data: { id: "store-a", name: "A 店", code: "A" } });
  const otherStore = await prisma.store.create({ data: { id: "store-b", name: "B 店", code: "B" } });
  const manager = await prisma.user.create({
    data: { id: "manager-a", phone: "13000000001", name: "A 店长", role: "manager", storeId: store.id },
  });
  const employee = await prisma.user.create({
    data: {
      id: "employee-a",
      phone: "13000000002",
      employeeNo: "A-001",
      name: "A 员工",
      role: "employee",
      storeId: store.id,
      position: "sales",
    },
  });
  const outsider = await prisma.user.create({
    data: {
      id: "employee-b",
      phone: "13000000003",
      employeeNo: "B-001",
      name: "B 员工",
      role: "employee",
      storeId: otherStore.id,
      position: "cashier",
    },
  });
  const area = await prisma.workArea.create({
    data: { id: "area-a", storeId: store.id, name: "卖场", code: "FLOOR" },
  });
  const group = await prisma.workGroup.create({
    data: {
      id: "group-a",
      storeId: store.id,
      name: "销售组",
      leaderId: manager.id,
      volumeType: "traffic",
    },
  });
  return { store, otherStore, manager, employee, outsider, area, group };
}

function request(path: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function payload(response: Response) {
  return (await response.json()) as { ok: boolean; error?: string; data?: unknown };
}

beforeEach(resetTestDb);

describe("workforce membership invariants", () => {
  it("rejects a member from another store without persisting a row", async () => {
    const fixture = await createFixture();

    await expect(
      addWorkGroupMember(managerScope(fixture.manager), {
        workGroupId: fixture.group.id,
        userId: fixture.outsider.id,
        workAreaId: fixture.area.id,
        effectiveFrom: "2026-07-01",
        effectiveTo: null,
      })
    ).rejects.toMatchObject({ status: 409 });
    await expect(prisma.workGroupMember.count()).resolves.toBe(0);
  });

  it("rejects an inclusive same-day overlap but accepts a next-day adjacent period", async () => {
    const fixture = await createFixture();
    const scope = managerScope(fixture.manager);
    const base = {
      workGroupId: fixture.group.id,
      userId: fixture.employee.id,
      workAreaId: fixture.area.id,
    };
    await addWorkGroupMember(scope, {
      ...base,
      effectiveFrom: "2026-07-01",
      effectiveTo: "2026-07-31",
    });

    await expect(
      addWorkGroupMember(scope, {
        ...base,
        effectiveFrom: "2026-07-31",
        effectiveTo: "2026-08-01",
      })
    ).rejects.toBeInstanceOf(WorkforceConflictError);
    await expect(
      addWorkGroupMember(scope, {
        ...base,
        effectiveFrom: "2026-08-01",
        effectiveTo: null,
      })
    ).resolves.toMatchObject({ effectiveTo: null });
    await expect(prisma.workGroupMember.count()).resolves.toBe(2);
  });

  it("allows at most one overlapping insert from two independent Prisma clients", async () => {
    const fixture = await createFixture();
    const scope = managerScope(fixture.manager);
    const secondClient = new PrismaClient();
    try {
      const input = {
        workGroupId: fixture.group.id,
        userId: fixture.employee.id,
        workAreaId: fixture.area.id,
        effectiveFrom: "2026-07-01",
        effectiveTo: null,
      };
      const results = await Promise.allSettled([
        addWorkGroupMember(scope, input, prisma),
        addWorkGroupMember(scope, input, secondClient),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected).toMatchObject({
        status: "rejected",
        reason: { status: 409 },
      });
      await expect(prisma.workGroupMember.count()).resolves.toBe(1);
    } finally {
      await secondClient.$disconnect();
    }
  });

  it("requires a same-store manager as leader", async () => {
    const fixture = await createFixture();
    const otherManager = await prisma.user.create({
      data: {
        id: "manager-b",
        phone: "13000000009",
        name: "B 店长",
        role: "manager",
        storeId: fixture.otherStore.id,
      },
    });
    await expect(
      createWorkGroup(managerScope(fixture.manager), {
        name: "跨店组",
        leaderId: otherManager.id,
        volumeType: "traffic",
        active: true,
      })
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      createWorkGroup(managerScope(fixture.manager), {
        name: "员工带组",
        leaderId: fixture.employee.id,
        volumeType: "delivery",
        active: true,
      })
    ).rejects.toMatchObject({ status: 409 });
    await expect(prisma.workGroup.count({ where: { storeId: fixture.store.id } })).resolves.toBe(1);
  });

  it("rejects manager and admin memberships", async () => {
    const fixture = await createFixture();
    const admin = await prisma.user.create({
      data: { id: "admin", phone: "13000000010", name: "管理员", role: "admin" },
    });
    const scope = managerScope(fixture.manager);
    for (const userId of [fixture.manager.id, admin.id]) {
      await expect(
        addWorkGroupMember(scope, {
          workGroupId: fixture.group.id,
          userId,
          workAreaId: fixture.area.id,
          effectiveFrom: "2026-07-01",
          effectiveTo: null,
        })
      ).rejects.toMatchObject({ status: 409 });
    }
    await expect(prisma.workGroupMember.count()).resolves.toBe(0);
  });

  it("keeps area and group active when a current membership blocks deactivation", async () => {
    const fixture = await createFixture();
    const scope = managerScope(fixture.manager);
    await addWorkGroupMember(scope, {
      workGroupId: fixture.group.id,
      userId: fixture.employee.id,
      workAreaId: fixture.area.id,
      effectiveFrom: "2026-07-01",
      effectiveTo: null,
    });

    await expect(
      updateWorkArea(scope, {
        id: fixture.area.id,
        name: fixture.area.name,
        code: fixture.area.code,
        active: false,
      })
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      updateWorkGroup(scope, {
        id: fixture.group.id,
        name: fixture.group.name,
        leaderId: fixture.manager.id,
        volumeType: "traffic",
        active: false,
      })
    ).rejects.toMatchObject({ status: 409 });
    await expect(prisma.workArea.findUniqueOrThrow({ where: { id: fixture.area.id } })).resolves.toMatchObject({ active: true });
    await expect(prisma.workGroup.findUniqueOrThrow({ where: { id: fixture.group.id } })).resolves.toMatchObject({ active: true });
    await expect(prisma.workGroupMember.count()).resolves.toBe(1);
  });
});

describe("employee number rules", () => {
  it("requires employeeNo and keeps it unique per store", async () => {
    const fixture = await createFixture();
    const scope = managerScope(fixture.manager);
    await expect(
      createEmployee(scope, {
        phone: "13000000004",
        employeeNo: "",
        name: "无编号员工",
        position: "sales",
        employmentType: "fulltime",
        maxWeeklyHours: 40,
        salesAbility: "mid",
        performanceBand: "frequently",
        hireDate: "2026-07-01",
      })
    ).rejects.toThrow();
    await expect(
      createEmployee(scope, {
        phone: "13000000005",
        employeeNo: "A-001",
        name: "重复编号员工",
        position: "cashier",
        employmentType: "parttime",
        maxWeeklyHours: 24,
        salesAbility: "low",
        performanceBand: "sometimes",
        hireDate: "2026-07-01",
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("allows the same employeeNo in different stores while manager/admin remain null", async () => {
    const fixture = await createFixture();
    const otherManager = await prisma.user.create({
      data: {
        id: "manager-b",
        phone: "13000000006",
        name: "B 店长",
        role: "manager",
        storeId: fixture.otherStore.id,
      },
    });
    await expect(
      createEmployee(managerScope(otherManager), {
        phone: "13000000007",
        employeeNo: "A-001",
        name: "B 店同编号员工",
        position: "sales",
        employmentType: "fulltime",
        maxWeeklyHours: 40,
        salesAbility: "high",
        performanceBand: "always",
        hireDate: "2026-07-01",
      })
    ).resolves.toMatchObject({ employeeNo: "A-001" });
    const admin = await prisma.user.create({
      data: { id: "admin", phone: "13000000008", name: "管理员", role: "admin" },
    });
    await expect(prisma.user.findUniqueOrThrow({ where: { id: fixture.manager.id } })).resolves.toMatchObject({ employeeNo: null });
    await expect(prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).resolves.toMatchObject({ employeeNo: null });
  });
});

describe("workforce route authorization and conflicts", () => {
  it("returns a readable employee response when a legacy same-store employee number is null", async () => {
    const fixture = await createFixture();
    const legacy = await prisma.user.create({
      data: {
        id: "legacy-employee",
        phone: "13000000030",
        employeeNo: null,
        name: "历史员工",
        role: "employee",
        storeId: fixture.store.id,
        position: "sales",
        hireDate: new Date(2020, 0, 1),
      },
    });
    authState.user = managerScope(fixture.manager).user;

    const response = await employeesRoute.GET(
      request(`/api/store/employees?storeId=${fixture.store.id}`)
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      data: Array<{ id: string; employeeNo: string | null; name: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.data).toContainEqual({
      id: legacy.id,
      employeeNo: null,
      name: legacy.name,
      phone: legacy.phone,
      position: legacy.position,
      employmentType: legacy.employmentType,
      maxWeeklyHours: legacy.maxWeeklyHours,
      salesAbility: legacy.salesAbility,
      performanceBand: legacy.performanceBand,
      hireDate: "2020-01-01",
      role: "employee",
      memberships: [],
    });

    const invalidMutation = await employeesRoute.PUT(
      request("/api/store/employees", "PUT", {
        storeId: fixture.store.id,
        id: legacy.id,
        phone: legacy.phone,
        employeeNo: null,
        name: legacy.name,
        position: legacy.position,
        employmentType: legacy.employmentType,
        maxWeeklyHours: legacy.maxWeeklyHours,
        salesAbility: legacy.salesAbility,
        performanceBand: legacy.performanceBand,
        hireDate: "2020-01-01",
      })
    );
    expect(invalidMutation.status).toBe(400);
  });

  it("allows manager own-store and admin specified-store GETs while rejecting employees", async () => {
    const fixture = await createFixture();
    authState.user = managerScope(fixture.manager).user;
    expect((await workAreasRoute.GET(request(`/api/store/work-areas?storeId=${fixture.store.id}`))).status).toBe(200);
    expect((await workGroupsRoute.GET(request(`/api/store/work-groups?storeId=${fixture.store.id}`))).status).toBe(200);
    expect((await employeesRoute.GET(request(`/api/store/employees?storeId=${fixture.store.id}`))).status).toBe(200);

    expect((await workAreasRoute.GET(request(`/api/store/work-areas?storeId=${fixture.otherStore.id}`))).status).toBe(403);
    authState.user = { id: "admin", name: "管理员", phone: "13900000000", role: "admin", storeId: null };
    expect((await workAreasRoute.GET(request(`/api/store/work-areas?storeId=${fixture.otherStore.id}`))).status).toBe(200);
    expect((await employeesRoute.GET(request(`/api/store/employees?storeId=${fixture.otherStore.id}`))).status).toBe(200);

    authState.user = { id: fixture.employee.id, name: fixture.employee.name, phone: fixture.employee.phone, role: "employee", storeId: fixture.store.id };
    expect((await workAreasRoute.GET(request(`/api/store/work-areas?storeId=${fixture.store.id}`))).status).toBe(403);
    expect((await workGroupsRoute.GET(request(`/api/store/work-groups?storeId=${fixture.store.id}`))).status).toBe(403);
    expect((await employeesRoute.GET(request(`/api/store/employees?storeId=${fixture.store.id}`))).status).toBe(403);
  });

  it("rejects admin and employee writes for area, group membership and employee endpoints", async () => {
    const fixture = await createFixture();
    const bodies = {
      area: { storeId: fixture.store.id, name: "仓库", code: "STOCK", active: true },
      member: { storeId: fixture.store.id, workGroupId: fixture.group.id, userId: fixture.employee.id, workAreaId: fixture.area.id, effectiveFrom: "2026-07-01", effectiveTo: null },
      employee: { storeId: fixture.store.id, phone: "13000000020", employeeNo: "A-020", name: "新员工", position: "sales", employmentType: "fulltime", maxWeeklyHours: 40, salesAbility: "mid", performanceBand: "frequently", hireDate: "2026-07-01" },
    };
    for (const user of [
      { id: "admin", name: "管理员", phone: "13900000000", role: "admin" as const, storeId: null },
      { id: fixture.employee.id, name: fixture.employee.name, phone: fixture.employee.phone, role: "employee" as const, storeId: fixture.store.id },
    ]) {
      authState.user = user;
      expect((await workAreasRoute.POST(request("/api/store/work-areas", "POST", bodies.area))).status).toBe(403);
      expect((await membersRoute.POST(request("/api/store/work-groups/members", "POST", bodies.member))).status).toBe(403);
      expect((await employeesRoute.PUT(request("/api/store/employees", "PUT", bodies.employee))).status).toBe(403);
      expect((await workGroupsRoute.DELETE(request("/api/store/work-groups", "DELETE", { storeId: fixture.store.id, id: fixture.group.id }))).status).toBe(403);
    }
    await expect(prisma.workArea.count({ where: { code: "STOCK" } })).resolves.toBe(0);
    await expect(prisma.workGroupMember.count()).resolves.toBe(0);
    await expect(prisma.user.count({ where: { employeeNo: "A-020" } })).resolves.toBe(0);
    await expect(prisma.workGroup.count({ where: { id: fixture.group.id } })).resolves.toBe(1);
  });

  it("rejects manager body/query cross-store writes without persisting anything", async () => {
    const fixture = await createFixture();
    authState.user = managerScope(fixture.manager).user;
    const responses = await Promise.all([
      workAreasRoute.POST(request("/api/store/work-areas", "POST", { storeId: fixture.otherStore.id, name: "越权区域", code: "X", active: true })),
      workGroupsRoute.POST(request("/api/store/work-groups", "POST", { storeId: fixture.otherStore.id, name: "越权组", leaderId: fixture.manager.id, volumeType: "traffic", active: true })),
      membersRoute.POST(request("/api/store/work-groups/members", "POST", { storeId: fixture.otherStore.id, workGroupId: fixture.group.id, userId: fixture.employee.id, workAreaId: fixture.area.id, effectiveFrom: "2026-07-01", effectiveTo: null })),
      employeesRoute.PUT(request("/api/store/employees", "PUT", { storeId: fixture.otherStore.id, phone: "13000000021", employeeNo: "X-001", name: "越权员工", position: "sales", employmentType: "fulltime", maxWeeklyHours: 40, salesAbility: "mid", performanceBand: "frequently", hireDate: "2026-07-01" })),
    ]);
    for (const response of responses) expect(response.status).toBe(403);
    expect((await workAreasRoute.GET(request(`/api/store/work-areas?storeId=${fixture.otherStore.id}`))).status).toBe(403);
    await expect(prisma.workArea.count({ where: { storeId: fixture.otherStore.id } })).resolves.toBe(0);
    await expect(prisma.workGroup.count({ where: { storeId: fixture.otherStore.id } })).resolves.toBe(0);
    await expect(prisma.workGroupMember.count()).resolves.toBe(0);
    await expect(prisma.user.count({ where: { employeeNo: "X-001" } })).resolves.toBe(0);
  });

  it("maps overlap and active-reference deactivation conflicts to HTTP 409 with no partial writes", async () => {
    const fixture = await createFixture();
    authState.user = managerScope(fixture.manager).user;
    const member = { storeId: fixture.store.id, workGroupId: fixture.group.id, userId: fixture.employee.id, workAreaId: fixture.area.id, effectiveFrom: "2026-07-01", effectiveTo: null };
    expect((await membersRoute.POST(request("/api/store/work-groups/members", "POST", member))).status).toBe(201);
    const overlap = await membersRoute.POST(request("/api/store/work-groups/members", "POST", { ...member, effectiveFrom: "2026-07-19", effectiveTo: "2026-07-19" }));
    expect(overlap.status).toBe(409);
    expect((await payload(overlap)).error).toMatch(/重叠/);

    const areaResponse = await workAreasRoute.PUT(request("/api/store/work-areas", "PUT", { storeId: fixture.store.id, id: fixture.area.id, name: fixture.area.name, code: fixture.area.code, active: false }));
    const groupResponse = await workGroupsRoute.PUT(request("/api/store/work-groups", "PUT", { storeId: fixture.store.id, id: fixture.group.id, name: fixture.group.name, leaderId: fixture.manager.id, volumeType: "traffic", active: false }));
    expect(areaResponse.status).toBe(409);
    expect(groupResponse.status).toBe(409);
    await expect(prisma.workGroupMember.count()).resolves.toBe(1);
    await expect(prisma.workArea.findUniqueOrThrow({ where: { id: fixture.area.id } })).resolves.toMatchObject({ active: true });
    await expect(prisma.workGroup.findUniqueOrThrow({ where: { id: fixture.group.id } })).resolves.toMatchObject({ active: true });
  });
});

describe("deterministic workforce seed", () => {
  it("creates Task 7 attendance, exception states and same-store proxy fixtures without changing Task 4 rest semantics", async () => {
    await seedDatabase();

    await expect(prisma.schedulePlan.findUniqueOrThrow({
      where: { id: "plan-wangjing-2026-07-20" },
      select: { status: true, publishedAt: true },
    })).resolves.toMatchObject({ status: "published", publishedAt: expect.any(Date) });
    await expect(prisma.schedule.count({
      where: { planId: "plan-wangjing-2026-07-20", date: dateOnlyToDate("2026-07-20") },
    })).resolves.toBe(2);

    const punches = await prisma.attendanceRecord.findMany({
      where: { id: { startsWith: "seed-attendance-wj-" } },
      orderBy: { id: "asc" },
      select: { id: true, userId: true, storeId: true, direction: true, viaCode: true, corrected: true },
    });
    expect(punches).toEqual([
      { id: "seed-attendance-wj-01-in", userId: "user-employee-wj-01", storeId: "store-wangjing", direction: "in", viaCode: true, corrected: false },
      { id: "seed-attendance-wj-01-out", userId: "user-employee-wj-01", storeId: "store-wangjing", direction: "out", viaCode: true, corrected: false },
      { id: "seed-attendance-wj-02-correction-in", userId: "user-employee-wj-02", storeId: "store-wangjing", direction: "in", viaCode: false, corrected: true },
    ]);

    const exceptions = await prisma.attendanceExceptionConfirmation.findMany({
      where: { id: { startsWith: "seed-exception-wj-01-" } },
      orderBy: { type: "asc" },
      select: { type: true, status: true, active: true, revision: true, confirmedById: true, confirmedAt: true, date: true },
    });
    expect(exceptions).toEqual([
      { type: "early_leave", status: "unconfirmed", active: true, revision: 1, confirmedById: null, confirmedAt: null, date: dateOnlyToDate("2026-07-20") },
      { type: "late", status: "confirmed", active: true, revision: 2, confirmedById: "user-manager-wangjing", confirmedAt: expect.any(Date), date: dateOnlyToDate("2026-07-20") },
    ]);

    await expect(prisma.leaveRequest.findUniqueOrThrow({
      where: { id: "seed-proxy-leave-wj-01" },
      include: { user: { select: { role: true, storeId: true } } },
    })).resolves.toMatchObject({ userId: "user-employee-wj-01", status: "pending", reason: "店长代提交年假", createdAt: new Date("2026-07-19T16:49:02+08:00"), user: { role: "employee", storeId: "store-wangjing" } });
    await expect(prisma.punchCorrection.findUniqueOrThrow({
      where: { id: "seed-proxy-correction-wj-01" },
      include: { user: { select: { role: true, storeId: true } } },
    })).resolves.toMatchObject({ userId: "user-employee-wj-01", status: "pending", reason: "店长代提交漏打卡", createdAt: new Date("2026-07-19T16:49:02+08:00"), user: { role: "employee", storeId: "store-wangjing" } });
    await expect(prisma.punchCorrection.findUniqueOrThrow({
      where: { id: "seed-approved-correction-wj-02" },
      select: { createdAt: true },
    })).resolves.toEqual({ createdAt: new Date("2026-07-19T16:30:00+08:00") });

    const attendanceRule = await prisma.ruleChunk.findFirstOrThrow({ where: { title: "打卡规则" } });
    expect(attendanceRule.content).toContain("6 位动态码");
    expect(attendanceRule.content).not.toContain("MVP 阶段不做地理围栏与二维码");
    const scheduleRule = await prisma.ruleChunk.findFirstOrThrow({ where: { title: "排班规则" } });
    expect(scheduleRule.content).toContain("两个班次之间至少间隔 8 小时");
  });

  it("is idempotent and creates stable employees, areas, groups and non-overlapping memberships", async () => {
    await seedDatabase();
    const firstEvent = await prisma.storeEvent.findFirstOrThrow({
      orderBy: [{ storeId: "asc" }, { date: "asc" }, { label: "asc" }],
      select: { storeId: true, date: true, label: true, factor: true },
    });
    const firstTraffic = await prisma.trafficRecord.findFirstOrThrow({
      orderBy: [{ storeId: "asc" }, { date: "asc" }, { timeSlot: "asc" }],
      select: { storeId: true, date: true, timeSlot: true, visitors: true },
    });
    await seedDatabase();
    const secondEvent = await prisma.storeEvent.findFirstOrThrow({
      orderBy: [{ storeId: "asc" }, { date: "asc" }, { label: "asc" }],
      select: { storeId: true, date: true, label: true, factor: true },
    });
    const secondTraffic = await prisma.trafficRecord.findFirstOrThrow({
      orderBy: [{ storeId: "asc" }, { date: "asc" }, { timeSlot: "asc" }],
      select: { storeId: true, date: true, timeSlot: true, visitors: true },
    });
    expect(secondEvent).toEqual(firstEvent);
    expect(secondTraffic).toEqual(firstTraffic);
    await expect(prisma.trafficForecast.count()).resolves.toBe(0);

    await expect(prisma.store.findMany({ select: { id: true }, orderBy: { id: "asc" } })).resolves.toEqual([
      { id: "store-wangjing" },
      { id: "store-zhongguancun" },
    ]);
    await expect(prisma.workArea.count({ where: { active: true } })).resolves.toBe(4);
    await expect(prisma.workGroup.count({ where: { active: true } })).resolves.toBe(4);
    await expect(prisma.workGroup.count({ where: { volumeType: "traffic" } })).resolves.toBe(2);
    await expect(prisma.workGroup.count({ where: { volumeType: "delivery" } })).resolves.toBe(2);
    await expect(prisma.workGroupMember.count()).resolves.toBe(10);

    const users = await prisma.user.findMany({ orderBy: { id: "asc" } });
    expect(users.filter((user) => user.role === "employee").every((user) => Boolean(user.employeeNo))).toBe(true);
    expect(users.find((user) => user.id === "user-employee-wj-01")).toMatchObject({ employeeNo: "WJ-001" });
    expect(users.filter((user) => user.role !== "employee").every((user) => user.employeeNo === null)).toBe(true);
    const memberships = await prisma.workGroupMember.findMany({
      include: { user: true, workGroup: true, workArea: true },
      orderBy: { effectiveFrom: "asc" },
    });
    expect(memberships.every((row) => row.user.role === "employee")).toBe(true);
    expect(memberships.every((row) => row.user.storeId === row.workGroup.storeId && row.workArea.storeId === row.workGroup.storeId)).toBe(true);
    expect(memberships.some((row, index) => memberships.slice(index + 1).some((other) => other.workGroupId === row.workGroupId && other.userId === row.userId && dateRangesOverlap(row.effectiveFrom, row.effectiveTo, other.effectiveFrom, other.effectiveTo)))).toBe(false);
    const groups = await prisma.workGroup.findMany({ include: { leader: true } });
    expect(groups.every((group) => group.leader.role === "manager" && group.leader.storeId === group.storeId)).toBe(true);
  });
});
