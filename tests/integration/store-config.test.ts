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
      if (roles && !roles.includes(authState.user.role))
        return { error: "无权限访问该功能", status: 403 };
      return { user: authState.user };
    }),
  };
});

import { prisma, resetTestDb } from "../helpers/test-db";
import {
  createStoreEventSchema,
  dateOnlyToDate,
  dateToDateOnly,
  staffingRowSchema,
  updateOperatingDaysSchema,
  updateStaffingSchema,
  updateV2SSchema,
  v2sRowSchema,
  type OperatingDayInput,
  type StaffingRow,
  type V2SRow,
} from "@/lib/contracts/store";
import {
  createStoreEvent,
  deleteStoreEvent,
  replaceOperatingDays,
  replaceStaffingRows,
  replaceV2SRows,
} from "@/features/store/server/store-service";
import * as optionsRoute from "@/app/api/store/options/route";
import * as basicRoute from "@/app/api/store/basic/route";
import * as operatingDaysRoute from "@/app/api/store/operating-days/route";
import * as v2sRoute from "@/app/api/store/v2s/route";
import * as eventsRoute from "@/app/api/store/events/route";
import * as demandRoute from "@/app/api/demand/route";

const admin: SessionUser = {
  id: "admin",
  name: "系统管理员",
  role: "admin",
  storeId: null,
  phone: "13900000000",
};
const employee: SessionUser = {
  id: "employee-a",
  name: "员工 A",
  role: "employee",
  storeId: "",
  phone: "13810000001",
};

const operatingDays: OperatingDayInput[] = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  isOpen: dayOfWeek !== 0,
  openTime: "09:00",
  closeTime: "21:00",
}));

const v2sRows: V2SRow[] = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  v2sLower: 30 + dayOfWeek,
  v2sUpper: 60 + dayOfWeek,
}));

const staffingRows: StaffingRow[] = Array.from({ length: 7 }, (_, dayOfWeek) =>
  (["morning", "afternoon", "evening"] as const).flatMap((timeSlot) =>
    (["cashier", "sales"] as const).map((position) => ({
      dayOfWeek,
      timeSlot,
      position,
      minHeadcount: position === "cashier" ? 1 : 2,
    }))
  )
).flat();

type Fixtures = Awaited<ReturnType<typeof seedFixtures>>;

async function seedFixtures() {
  const storeA = await prisma.store.create({
    data: { name: "望京旗舰店", code: "WJ", address: "望京路 1 号" },
  });
  const storeB = await prisma.store.create({
    data: { name: "中关村店", code: "ZG", address: "中关村大街 2 号" },
  });
  await prisma.storeOperatingDay.createMany({
    data: operatingDays.map((day) => ({ ...day, storeId: storeA.id })),
  });
  await prisma.v2SConfig.createMany({
    data: v2sRows.map((row) => ({ ...row, storeId: storeA.id })),
  });
  await prisma.minStaffingConfig.createMany({
    data: staffingRows.map((row) => ({ ...row, storeId: storeA.id })),
  });
  const managerA: SessionUser = {
    id: "manager-a",
    name: "李经理",
    role: "manager",
    storeId: storeA.id,
    phone: "13800000001",
  };
  employee.storeId = storeA.id;
  return { storeA, storeB, managerA };
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

describe("store configuration contracts", () => {
  it("requires seven unique operating days and V2S days", () => {
    const duplicateDays = operatingDays.map((day) => ({ ...day }));
    duplicateDays[6].dayOfWeek = 5;
    const duplicateV2S = v2sRows.map((row) => ({ ...row }));
    duplicateV2S[6].dayOfWeek = 5;

    expect(updateOperatingDaysSchema.safeParse({ days: duplicateDays }).success).toBe(false);
    expect(updateV2SSchema.safeParse({ rows: duplicateV2S }).success).toBe(false);
    expect(updateOperatingDaysSchema.safeParse({ days: operatingDays }).success).toBe(true);
    expect(updateV2SSchema.safeParse({ rows: v2sRows }).success).toBe(true);
  });

  it("requires all 42 unique staffing combinations", () => {
    const duplicate = staffingRows.map((row) => ({ ...row }));
    duplicate[41] = { ...duplicate[40] };
    expect(updateStaffingSchema.safeParse({ rows: duplicate }).success).toBe(false);
    expect(updateStaffingSchema.safeParse({ rows: staffingRows }).success).toBe(true);
  });

  it("rejects non-finite and out-of-business-range numeric values", () => {
    expect(
      v2sRowSchema.safeParse({ dayOfWeek: 1, v2sLower: 30, v2sUpper: Infinity }).success
    ).toBe(false);
    expect(
      v2sRowSchema.safeParse({ dayOfWeek: 1, v2sLower: 30, v2sUpper: 10_001 }).success
    ).toBe(false);
    expect(
      staffingRowSchema.safeParse({
        dayOfWeek: 1,
        timeSlot: "morning",
        position: "cashier",
        minHeadcount: 101,
      }).success
    ).toBe(false);
    expect(
      createStoreEventSchema.safeParse({
        date: "2026-07-19",
        label: "promo",
        factor: Infinity,
      }).success
    ).toBe(false);
    expect(
      createStoreEventSchema.safeParse({
        date: "2026-07-19",
        label: "promo",
        factor: 10.01,
      }).success
    ).toBe(false);
  });

  it("round-trips a local YYYY-MM-DD key without UTC drift", () => {
    const key = "2026-07-19";
    const date = dateOnlyToDate(key);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(6);
    expect(date.getDate()).toBe(19);
    expect(dateToDateOnly(date)).toBe(key);
  });
});

describe("store configuration transactions", () => {
  let fixtures: Fixtures;

  beforeEach(async () => {
    await resetTestDb();
    fixtures = await seedFixtures();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("atomically stores seven operating days for one store", async () => {
    await replaceOperatingDays(
      { user: admin, storeId: fixtures.storeB.id },
      operatingDays
    );
    expect(
      await prisma.storeOperatingDay.count({ where: { storeId: fixtures.storeB.id } })
    ).toBe(7);
  });

  it("rolls back operating-day replacement when a duplicate weekday fails", async () => {
    const original = await prisma.storeOperatingDay.findMany({
      where: { storeId: fixtures.storeA.id },
      orderBy: { dayOfWeek: "asc" },
    });
    const invalid = operatingDays.map((day) => ({
      ...day,
      isOpen: !day.isOpen,
      openTime: "08:00",
      closeTime: "20:00",
    }));
    invalid[6].dayOfWeek = 5;

    await expect(
      replaceOperatingDays({ user: admin, storeId: fixtures.storeA.id }, invalid)
    ).rejects.toThrow();
    expect(
      await prisma.storeOperatingDay.findMany({
        where: { storeId: fixtures.storeA.id },
        orderBy: { dayOfWeek: "asc" },
      })
    ).toEqual(original);
  });

  it("rolls back V2S replacement when a duplicate key fails", async () => {
    const original = await prisma.v2SConfig.findMany({
      where: { storeId: fixtures.storeA.id },
      orderBy: { dayOfWeek: "asc" },
    });
    const invalid = v2sRows.map((row) => ({ ...row, v2sLower: 99, v2sUpper: 100 }));
    invalid[6].dayOfWeek = 5;

    await expect(
      replaceV2SRows({ user: admin, storeId: fixtures.storeA.id }, invalid)
    ).rejects.toThrow();
    expect(
      await prisma.v2SConfig.findMany({
        where: { storeId: fixtures.storeA.id },
        orderBy: { dayOfWeek: "asc" },
      })
    ).toEqual(original);
  });

  it("rolls back staffing replacement when a duplicate key fails", async () => {
    const original = await prisma.minStaffingConfig.findMany({
      where: { storeId: fixtures.storeA.id },
      orderBy: [{ dayOfWeek: "asc" }, { timeSlot: "asc" }, { position: "asc" }],
    });
    const invalid = staffingRows.map((row) => ({ ...row, minHeadcount: 9 }));
    invalid[41] = { ...invalid[40] };

    await expect(
      replaceStaffingRows({ user: admin, storeId: fixtures.storeA.id }, invalid)
    ).rejects.toThrow();
    expect(
      await prisma.minStaffingConfig.findMany({
        where: { storeId: fixtures.storeA.id },
        orderBy: [{ dayOfWeek: "asc" }, { timeSlot: "asc" }, { position: "asc" }],
      })
    ).toEqual(original);
  });

  it("deletes one event by the unambiguous date and label key", async () => {
    const scope = { user: fixtures.managerA, storeId: fixtures.storeA.id };
    await createStoreEvent(scope, { date: "2026-07-19", label: "promo", factor: 1.3 });
    await createStoreEvent(scope, { date: "2026-07-19", label: "holiday", factor: 1.4 });
    await deleteStoreEvent(scope, { date: "2026-07-19", label: "promo" });

    const remaining = await prisma.storeEvent.findMany({ where: { storeId: fixtures.storeA.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].label).toBe("holiday");
    expect(dateToDateOnly(remaining[0].date)).toBe("2026-07-19");
  });
});

describe("store API authorization matrix and compatibility", () => {
  let fixtures: Fixtures;

  beforeEach(async () => {
    await resetTestDb();
    fixtures = await seedFixtures();
    authState.user = fixtures.managerA;
  });

  it("scopes store options by role and rejects employees", async () => {
    let response = await optionsRoute.GET();
    expect(response.status).toBe(200);
    expect((await payload(response)).data).toMatchObject([
      { id: fixtures.storeA.id, code: "WJ" },
    ]);

    authState.user = admin;
    response = await optionsRoute.GET();
    expect(response.status).toBe(200);
    expect((await payload(response)).data).toHaveLength(2);

    authState.user = employee;
    response = await optionsRoute.GET();
    expect(response.status).toBe(403);
  });

  it("rejects manager cross-store reads on every scoped resource", async () => {
    const storeId = fixtures.storeB.id;
    const reads = [
      basicRoute.GET(request(`/api/store/basic?storeId=${storeId}`)),
      operatingDaysRoute.GET(request(`/api/store/operating-days?storeId=${storeId}`)),
      v2sRoute.GET(request(`/api/store/v2s?storeId=${storeId}`)),
      eventsRoute.GET(request(`/api/store/events?storeId=${storeId}&month=2026-07`)),
      demandRoute.GET(request(`/api/demand?storeId=${storeId}`)),
    ];
    for (const response of await Promise.all(reads)) expect(response.status).toBe(403);
  });

  it("keeps admin read-only for basic, operating days, V2S and events", async () => {
    authState.user = admin;
    const storeId = fixtures.storeA.id;
    const writes = [
      basicRoute.PUT(
        request("/api/store/basic", "PUT", {
          storeId,
          name: "新名称",
          code: "NEW",
          address: null,
          active: true,
        })
      ),
      operatingDaysRoute.PUT(
        request("/api/store/operating-days", "PUT", { storeId, days: operatingDays })
      ),
      v2sRoute.PUT(request("/api/store/v2s", "PUT", { storeId, rows: v2sRows })),
      eventsRoute.POST(
        request("/api/store/events", "POST", {
          storeId,
          date: "2026-07-19",
          label: "promo",
          factor: 1.3,
        })
      ),
      eventsRoute.DELETE(
        request("/api/store/events", "DELETE", {
          storeId,
          date: "2026-07-19",
          label: "promo",
        })
      ),
    ];
    for (const response of await Promise.all(writes)) expect(response.status).toBe(403);
  });

  it("allows manager writes only for the session store", async () => {
    const ownId = fixtures.storeA.id;
    const otherId = fixtures.storeB.id;
    const ownWrites = [
      basicRoute.PUT(
        request("/api/store/basic", "PUT", {
          storeId: ownId,
          name: "望京一店",
          code: "WJ1",
          address: "新地址",
          active: true,
        })
      ),
      operatingDaysRoute.PUT(
        request("/api/store/operating-days", "PUT", { storeId: ownId, days: operatingDays })
      ),
      v2sRoute.PUT(request("/api/store/v2s", "PUT", { storeId: ownId, rows: v2sRows })),
      eventsRoute.POST(
        request("/api/store/events", "POST", {
          storeId: ownId,
          date: "2026-07-19",
          label: "promo",
          factor: 1.3,
        })
      ),
    ];
    for (const response of await Promise.all(ownWrites)) expect(response.status).toBe(200);

    const otherWrites = [
      basicRoute.PUT(
        request("/api/store/basic", "PUT", {
          storeId: otherId,
          name: "越权名称",
          code: "NOPE",
          address: null,
          active: true,
        })
      ),
      operatingDaysRoute.PUT(
        request("/api/store/operating-days", "PUT", { storeId: otherId, days: operatingDays })
      ),
      v2sRoute.PUT(request("/api/store/v2s", "PUT", { storeId: otherId, rows: v2sRows })),
      eventsRoute.POST(
        request("/api/store/events", "POST", {
          storeId: otherId,
          date: "2026-07-20",
          label: "promo",
          factor: 1.3,
        })
      ),
    ];
    for (const response of await Promise.all(otherWrites)) expect(response.status).toBe(403);
  });

  it("rejects employees from every store-configuration resource", async () => {
    authState.user = employee;
    const storeId = fixtures.storeA.id;
    const responses = await Promise.all([
      basicRoute.GET(request(`/api/store/basic?storeId=${storeId}`)),
      operatingDaysRoute.GET(request(`/api/store/operating-days?storeId=${storeId}`)),
      v2sRoute.GET(request(`/api/store/v2s?storeId=${storeId}`)),
      eventsRoute.GET(request(`/api/store/events?storeId=${storeId}&month=2026-07`)),
      demandRoute.GET(request(`/api/demand?storeId=${storeId}`)),
      basicRoute.PUT(
        request("/api/store/basic", "PUT", {
          storeId,
          name: "越权名称",
          code: "NOPE",
          address: null,
          active: true,
        })
      ),
      eventsRoute.POST(
        request("/api/store/events", "POST", {
          storeId,
          date: "2026-07-19",
          label: "promo",
          factor: 1.3,
        })
      ),
    ]);
    for (const response of responses) expect(response.status).toBe(403);
  });

  it("preserves exact legacy demand GET payload while scoping manager stores", async () => {
    authState.user = admin;
    let response: Response = await demandRoute.GET(request("/api/demand"));
    expect(response.status).toBe(200);
    const legacy = (await payload(response)).data as Record<string, any>;
    expect(Object.keys(legacy).sort()).toEqual(["configs", "storeId", "stores"]);
    expect(legacy.storeId).toEqual(expect.any(String));
    expect(legacy.configs).toEqual(expect.any(Array));
    expect(legacy.stores).toHaveLength(2);
    for (const store of legacy.stores) {
      expect(Object.keys(store).sort()).toEqual([
        "active",
        "address",
        "code",
        "createdAt",
        "id",
        "name",
      ]);
      expect(store.createdAt).toEqual(expect.any(String));
    }

    authState.user = fixtures.managerA;
    response = await demandRoute.GET(request("/api/demand"));
    expect(response.status).toBe(200);
    const managerLegacy = (await payload(response)).data as Record<string, any>;
    expect(managerLegacy.storeId).toBe(fixtures.storeA.id);
    expect(managerLegacy.stores).toHaveLength(1);
    expect(managerLegacy.stores[0]).toEqual(
      expect.objectContaining({
        id: fixtures.storeA.id,
        name: "望京旗舰店",
        code: "WJ",
        address: "望京路 1 号",
        active: true,
        createdAt: expect.any(String),
      })
    );
  });

  it("keeps legacy demand POST admin-only and new PUT role-scoped", async () => {
    authState.user = admin;
    let response: Response = await demandRoute.POST(
      request("/api/demand", "POST", {
        storeId: fixtures.storeB.id,
        dayOfWeek: 1,
        timeSlot: "morning",
        position: "cashier",
        minHeadcount: 4,
      })
    );
    expect(response.status).toBe(200);

    authState.user = fixtures.managerA;
    response = await demandRoute.POST(
      request("/api/demand", "POST", {
        storeId: fixtures.storeA.id,
        dayOfWeek: 1,
        timeSlot: "morning",
        position: "cashier",
        minHeadcount: 9,
      })
    );
    expect(response.status).toBe(403);
    expect(
      await prisma.minStaffingConfig.findUnique({
        where: {
          storeId_dayOfWeek_timeSlot_position: {
            storeId: fixtures.storeA.id,
            dayOfWeek: 1,
            timeSlot: "morning",
            position: "cashier",
          },
        },
      })
    ).toMatchObject({ minHeadcount: 1 });

    authState.user = employee;
    response = await demandRoute.POST(
      request("/api/demand", "POST", {
        storeId: fixtures.storeA.id,
        dayOfWeek: 1,
        timeSlot: "morning",
        position: "cashier",
        minHeadcount: 9,
      })
    );
    expect(response.status).toBe(403);

    authState.user = admin;
    response = await demandRoute.PUT(
      request("/api/demand", "PUT", { storeId: fixtures.storeB.id, rows: staffingRows })
    );
    expect(response.status).toBe(200);
    expect(
      await prisma.minStaffingConfig.count({ where: { storeId: fixtures.storeB.id } })
    ).toBe(42);

    authState.user = fixtures.managerA;
    response = await demandRoute.PUT(
      request("/api/demand", "PUT", { storeId: fixtures.storeA.id, rows: staffingRows })
    );
    expect(response.status).toBe(200);
    response = await demandRoute.PUT(
      request("/api/demand", "PUT", { storeId: fixtures.storeB.id, rows: staffingRows })
    );
    expect(response.status).toBe(403);

    authState.user = employee;
    response = await demandRoute.PUT(
      request("/api/demand", "PUT", { storeId: fixtures.storeA.id, rows: staffingRows })
    );
    expect(response.status).toBe(403);
  });

  it("returns 400 for numeric values beyond persistence bounds without writes", async () => {
    const originalV2S = await prisma.v2SConfig.findMany({
      where: { storeId: fixtures.storeA.id },
      orderBy: { dayOfWeek: "asc" },
    });
    const originalStaffing = await prisma.minStaffingConfig.findMany({
      where: { storeId: fixtures.storeA.id },
      orderBy: [{ dayOfWeek: "asc" }, { timeSlot: "asc" }, { position: "asc" }],
    });
    const invalidV2S = v2sRows.map((row) => ({ ...row }));
    invalidV2S[0].v2sUpper = 10_001;
    const invalidStaffing = staffingRows.map((row) => ({ ...row }));
    invalidStaffing[0].minHeadcount = 101;

    let response: Response = await v2sRoute.PUT(
      request("/api/store/v2s", "PUT", {
        storeId: fixtures.storeA.id,
        rows: invalidV2S,
      })
    );
    expect(response.status).toBe(400);
    response = await demandRoute.PUT(
      request("/api/demand", "PUT", {
        storeId: fixtures.storeA.id,
        rows: invalidStaffing,
      })
    );
    expect(response.status).toBe(400);
    response = await eventsRoute.POST(
      request("/api/store/events", "POST", {
        storeId: fixtures.storeA.id,
        date: "2026-07-19",
        label: "promo",
        factor: 10.01,
      })
    );
    expect(response.status).toBe(400);

    expect(
      await prisma.v2SConfig.findMany({
        where: { storeId: fixtures.storeA.id },
        orderBy: { dayOfWeek: "asc" },
      })
    ).toEqual(originalV2S);
    expect(
      await prisma.minStaffingConfig.findMany({
        where: { storeId: fixtures.storeA.id },
        orderBy: [{ dayOfWeek: "asc" }, { timeSlot: "asc" }, { position: "asc" }],
      })
    ).toEqual(originalStaffing);
    expect(
      await prisma.storeEvent.count({ where: { storeId: fixtures.storeA.id } })
    ).toBe(0);
  });
});
