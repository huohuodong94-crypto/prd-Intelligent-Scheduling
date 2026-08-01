import ExcelJS from "exceljs";
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
      if (roles && !roles.includes(authState.user.role)) {
        return { error: "无权限访问该功能", status: 403 };
      }
      return { user: authState.user };
    }),
  };
});

import { prisma, resetTestDb } from "../helpers/test-db";
import {
  commitImport,
  computeRecommendationMetric,
  copyHistory,
  createFailingScheduleWriterFactory,
  markImportFailedIfValidated,
  publishSchedule,
  restoreRecommendation,
  saveDraft,
  validateImportFile,
} from "@/features/scheduling/server/schedule-command-service";
import { saveRecommendation, updatePlanMode } from "@/features/scheduling/server/plan-service";
import * as feedbackRoute from "@/app/api/ai-feedback/route";
import * as exportRoute from "@/app/api/schedule/export/route";
import * as generateRoute from "@/app/api/schedule/generate/route";
import * as importValidateRoute from "@/app/api/schedule/import/validate/route";
import * as mineRoute from "@/app/api/schedule/mine/route";
import * as planRoute from "@/app/api/schedule/plan/route";
import * as publishRoute from "@/app/api/schedule/publish/route";
import * as scheduleRoute from "@/app/api/schedule/route";

function session(
  id: string,
  role: SessionUser["role"],
  storeId: string | null,
): SessionUser {
  return { id, role, storeId, name: id, phone: `task5-${id}` };
}

function jsonRequest(path: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function responseData(response: Response) {
  const payload = (await response.json()) as {
    ok: boolean;
    error?: string;
    data?: any;
    details?: unknown;
  };
  return payload;
}

async function createFixture() {
  const storeA = await prisma.store.create({
    data: { id: "task5-store-a", name: "A 店", code: "TASK5-A" },
  });
  const storeB = await prisma.store.create({
    data: { id: "task5-store-b", name: "B 店", code: "TASK5-B" },
  });
  const managerA = session("task5-manager-a", "manager", storeA.id);
  const managerB = session("task5-manager-b", "manager", storeB.id);
  const admin = session("task5-admin", "admin", null);
  const employeeA = session("task5-employee-a", "employee", storeA.id);
  const employeeA2 = session("task5-employee-a2", "employee", storeA.id);
  const employeeB = session("task5-employee-b", "employee", storeB.id);

  for (const user of [managerA, managerB, admin, employeeA, employeeA2, employeeB]) {
    await prisma.user.create({
      data: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        role: user.role,
        storeId: user.storeId,
        employeeNo: user.role === "employee" ? `NO-${user.id}` : null,
        position:
          user.id === employeeA2.id
            ? "cashier"
            : user.role === "employee"
              ? "sales"
              : null,
        maxWeeklyHours: 40,
      },
    });
  }
  for (const [store, manager, employees] of [
    [storeA, managerA, [employeeA, employeeA2]],
    [storeB, managerB, [employeeB]],
  ] as const) {
    const area = await prisma.workArea.create({
      data: {
        id: `area-${store.id}`,
        storeId: store.id,
        name: "卖场",
        code: "FLOOR",
      },
    });
    const group = await prisma.workGroup.create({
      data: {
        id: `group-${store.id}`,
        storeId: store.id,
        name: "排班组",
        leaderId: manager.id,
        volumeType: "traffic",
      },
    });
    for (const employee of employees) {
      await prisma.workGroupMember.create({
        data: {
          workGroupId: group.id,
          userId: employee.id,
          workAreaId: area.id,
          effectiveFrom: new Date("2026-01-01T00:00:00"),
        },
      });
    }
    await prisma.storeOperatingDay.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        storeId: store.id,
        dayOfWeek,
        isOpen: dayOfWeek !== 0,
        openTime: "09:00",
        closeTime: "21:00",
      })),
    });
  }
  await prisma.minStaffingConfig.create({
    data: {
      storeId: storeA.id,
      dayOfWeek: 0,
      timeSlot: "morning",
      position: "sales",
      minHeadcount: 1,
    },
  });
  const target = await prisma.schedulePlan.create({
    data: {
      id: "task5-target",
      storeId: storeA.id,
      weekOf: "2026-07-20",
      mode: "work5rest2",
      status: "draft",
      version: 0,
      createdById: managerA.id,
    },
  });
  const source = await prisma.schedulePlan.create({
    data: {
      id: "task5-source",
      storeId: storeA.id,
      weekOf: "2026-07-13",
      mode: "work5rest2",
      status: "published",
      version: 1,
      publishedAt: new Date("2026-07-13T00:00:00"),
      createdById: managerA.id,
    },
  });
  const foreignPlan = await prisma.schedulePlan.create({
    data: {
      id: "task5-foreign",
      storeId: storeB.id,
      weekOf: "2026-07-20",
      mode: "work5rest2",
      status: "draft",
      version: 0,
      createdById: managerB.id,
    },
  });
  return {
    storeA,
    storeB,
    managerA,
    managerB,
    admin,
    employeeA,
    employeeA2,
    employeeB,
    target,
    source,
    foreignPlan,
  };
}

function scope(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return { user: fixture.managerA, storeId: fixture.storeA.id };
}

beforeEach(async () => {
  await resetTestDb();
  authState.user = null;
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("canonical recommendation metrics", () => {
  it("uses the union and symmetric difference of canonical assignment keys", () => {
    expect(
      computeRecommendationMetric(
        [{ userId: "e1", date: "2026-07-20", shiftType: "morning" }],
        [{ userId: "e1", date: "2026-07-20", shiftType: "evening" }],
      ),
    ).toEqual({
      wasAccepted: true,
      wasEdited: true,
      editedCells: 2,
      totalCells: 2,
      editRatio: 1,
    });
  });

  it("returns a null ratio for a zero union", () => {
    expect(computeRecommendationMetric([], [])).toEqual({
      wasAccepted: true,
      wasEdited: false,
      editedCells: 0,
      totalCells: 0,
      editRatio: null,
    });
  });
});

describe("schedule draft and publish transactions", () => {
  it("saves a legal morning plus evening cell and uses CAS with zero stale side effects", async () => {
    const fixture = await createFixture();
    const assignments = [
      { userId: fixture.employeeA.id, date: "2026-07-20", shiftType: "morning" as const },
      { userId: fixture.employeeA.id, date: "2026-07-20", shiftType: "evening" as const },
    ];
    const saved = await saveDraft(scope(fixture), {
      planId: fixture.target.id,
      version: 0,
      assignments,
      source: "manual",
    });
    expect(saved.plan).toMatchObject({ version: 1, status: "draft" });
    expect(await prisma.schedule.count({ where: { planId: fixture.target.id } })).toBe(2);

    await expect(
      saveDraft(scope(fixture), {
        planId: fixture.target.id,
        version: 0,
        assignments: [],
        source: "manual",
      }),
    ).rejects.toMatchObject({ status: 409, code: "version_conflict" });
    expect(await prisma.schedule.count({ where: { planId: fixture.target.id } })).toBe(2);
    await expect(
      prisma.schedulePlan.findUniqueOrThrow({ where: { id: fixture.target.id } }),
    ).resolves.toMatchObject({ version: 1 });
  });

  it("rejects manager assignments through the shared pipeline without partial writes", async () => {
    const fixture = await createFixture();
    await expect(
      saveDraft(scope(fixture), {
        planId: fixture.target.id,
        version: 0,
        assignments: [
          { userId: fixture.managerA.id, date: "2026-07-20", shiftType: "morning" },
        ],
        source: "manual",
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await prisma.schedule.count({ where: { planId: fixture.target.id } })).toBe(0);
    await expect(
      prisma.schedulePlan.findUniqueOrThrow({ where: { id: fixture.target.id } }),
    ).resolves.toMatchObject({ version: 0 });
  });

  it("keeps save and publish blocked while an open-day staffing requirement is unmet", async () => {
    const fixture = await createFixture();
    await prisma.minStaffingConfig.create({
      data: {
        storeId: fixture.storeA.id,
        dayOfWeek: 1,
        timeSlot: "morning",
        position: "sales",
        minHeadcount: 1,
      },
    });

    const expectedGap = {
      status: 422,
      code: "hard_constraints",
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "staffing_gap",
          date: "2026-07-20",
          shiftType: "morning",
        }),
      ]),
    };
    await expect(
      saveDraft(scope(fixture), {
        planId: fixture.target.id,
        version: 0,
        assignments: [],
        source: "manual",
      }),
    ).rejects.toMatchObject(expectedGap);
    await expect(
      publishSchedule(scope(fixture), {
        planId: fixture.target.id,
        version: 0,
        assignments: [],
      }),
    ).rejects.toMatchObject(expectedGap);

    await expect(
      prisma.schedulePlan.findUniqueOrThrow({ where: { id: fixture.target.id } }),
    ).resolves.toMatchObject({ status: "draft", version: 0 });
    expect(await prisma.schedule.count({ where: { planId: fixture.target.id } })).toBe(0);
  });

  it("returns 403 for a known foreign-store employee but keeps unknown employees as 422", async () => {
    const fixture = await createFixture();
    await expect(
      saveDraft(scope(fixture), {
        planId: fixture.target.id,
        version: 0,
        assignments: [
          { userId: fixture.employeeB.id, date: "2026-07-20", shiftType: "morning" },
        ],
        source: "manual",
      }),
    ).rejects.toMatchObject({ status: 403, code: "cross_store" });
    await expect(
      saveDraft(scope(fixture), {
        planId: fixture.target.id,
        version: 0,
        assignments: [
          { userId: "missing-employee", date: "2026-07-20", shiftType: "morning" },
        ],
        source: "manual",
      }),
    ).rejects.toMatchObject({ status: 422, code: "hard_constraints" });
    expect(await prisma.schedule.count({ where: { planId: fixture.target.id } })).toBe(0);
  });

  it("rejects a closed-day assignment and ignores closed-day staffing demand", async () => {
    const fixture = await createFixture();
    await expect(
      saveDraft(scope(fixture), {
        planId: fixture.target.id,
        version: 0,
        assignments: [
          { userId: fixture.employeeA.id, date: "2026-07-26", shiftType: "morning" },
        ],
        source: "manual",
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await prisma.schedule.count({ where: { planId: fixture.target.id } })).toBe(0);
    await expect(
      prisma.schedulePlan.findUniqueOrThrow({ where: { id: fixture.target.id } }),
    ).resolves.toMatchObject({ version: 0 });

    const saved = await saveDraft(scope(fixture), {
      planId: fixture.target.id,
      version: 0,
      assignments: [],
      source: "manual",
    });
    expect(saved.plan.version).toBe(1);
  });

  it("publishes against only the current canonical metric and records a real diff", async () => {
    const fixture = await createFixture();
    const canonical = await prisma.aiInteractionLog.create({
      data: {
        userId: fixture.managerA.id,
        storeId: fixture.storeA.id,
        planId: fixture.target.id,
        eventKind: "schedule_plan_metric",
        feature: "schedule_advisor",
        inputText: "schedule_plan_metric",
        outputText: "{}",
      },
    });
    await prisma.schedulePlan.update({
      where: { id: fixture.target.id },
      data: {
        status: "recommended",
        recommendationAiLogId: canonical.id,
        recommendationJson: JSON.stringify({
          assignments: [
            { userId: fixture.employeeA.id, date: "2026-07-20", shiftType: "morning" },
          ],
          gaps: [],
          note: "",
          explanation: "",
          status: "feasible",
        }),
      },
    });

    const result = await publishSchedule(scope(fixture), {
      planId: fixture.target.id,
      version: 0,
      assignments: [
        { userId: fixture.employeeA.id, date: "2026-07-20", shiftType: "evening" },
      ],
    });
    expect(result.plan).toMatchObject({ status: "published", version: 1 });
    await expect(
      prisma.aiInteractionLog.findUniqueOrThrow({ where: { id: canonical.id } }),
    ).resolves.toMatchObject({
      wasAccepted: true,
      wasEdited: true,
      editedCells: 2,
      totalCells: 2,
      editRatio: 1,
    });
  });

  it("allows publish when canonical metric is missing but writes an auditable concern", async () => {
    const fixture = await createFixture();
    const result = await publishSchedule(scope(fixture), {
      planId: fixture.target.id,
      version: 0,
      assignments: [],
    });
    expect(result.metric.status).toBe("missing");
    expect(
      await prisma.aiInteractionLog.count({
        where: {
          storeId: fixture.storeA.id,
          planId: fixture.target.id,
          eventKind: "schedule_metric_missing",
        },
      }),
    ).toBe(1);
  });
});

describe("published plans are immutable", () => {
  it("atomically persists generation logs and rolls every stale generation log back", async () => {
    const fixture = await createFixture();
    const first = await saveRecommendation(scope(fixture), {
      planId: fixture.target.id,
      version: 0,
      recommendation: { assignments: [], gaps: [] },
      metric: { totalCells: 0 },
      rawLogs: {
        parse: {
          inputText: "first parse",
          outputText: "{}",
          provider: "mock",
          model: "parse-model",
        },
        explain: {
          inputText: "first explain",
          outputText: "explanation",
          provider: "mock",
          model: "explain-model",
        },
      },
    });
    expect(first.version).toBe(1);
    expect(await prisma.aiInteractionLog.count({ where: { planId: fixture.target.id } })).toBe(3);
    const generatedPlan = await prisma.schedulePlan.findUniqueOrThrow({
      where: { id: fixture.target.id },
    });
    await expect(
      prisma.aiInteractionLog.findUniqueOrThrow({
        where: { id: generatedPlan.recommendationAiLogId! },
      }),
    ).resolves.toMatchObject({
      wasAccepted: null,
      wasEdited: null,
      editedCells: null,
      totalCells: null,
      editRatio: null,
    });

    await expect(
      saveRecommendation(scope(fixture), {
        planId: fixture.target.id,
        version: 0,
        recommendation: { assignments: [], gaps: [] },
        metric: { totalCells: 0 },
        rawLogs: {
          parse: { inputText: "stale parse", outputText: "{}" },
          explain: { inputText: "stale explain", outputText: "stale" },
        },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await prisma.aiInteractionLog.count({ where: { planId: fixture.target.id } })).toBe(3);
    await expect(
      prisma.schedulePlan.findUniqueOrThrow({ where: { id: fixture.target.id } }),
    ).resolves.toMatchObject({ status: "recommended", version: 1 });
  });

  it("blocks saveRecommendation with zero plan and AiInteractionLog side effects", async () => {
    const fixture = await createFixture();
    await prisma.schedulePlan.update({
      where: { id: fixture.target.id },
      data: { status: "published", publishedAt: new Date(), version: 4 },
    });
    const beforeLogs = await prisma.aiInteractionLog.count();
    await expect(
      saveRecommendation(scope(fixture), {
        planId: fixture.target.id,
        version: 4,
        recommendation: { assignments: [], gaps: [] },
        metric: { totalCells: 0 },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await prisma.aiInteractionLog.count()).toBe(beforeLogs);
    await expect(
      prisma.schedulePlan.findUniqueOrThrow({ where: { id: fixture.target.id } }),
    ).resolves.toMatchObject({ status: "published", version: 4, recommendationJson: null });
  });

  it("rejects generate at the route boundary before engine or log side effects", async () => {
    const fixture = await createFixture();
    await prisma.schedulePlan.update({
      where: { id: fixture.target.id },
      data: { status: "published", publishedAt: new Date(), version: 2 },
    });
    authState.user = fixture.managerA;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await generateRoute.POST(
      jsonRequest("/api/schedule/generate", "POST", {
        planId: fixture.target.id,
        version: 2,
      }),
    );
    expect(response.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.aiInteractionLog.count()).toBe(0);
    await expect(
      prisma.schedulePlan.findUniqueOrThrow({ where: { id: fixture.target.id } }),
    ).resolves.toMatchObject({ status: "published", version: 2 });
  });

  it("blocks published mode changes through both service and legacy route with zero changes", async () => {
    const fixture = await createFixture();
    const canonical = await prisma.aiInteractionLog.create({
      data: {
        userId: fixture.managerA.id,
        storeId: fixture.storeA.id,
        planId: fixture.target.id,
        eventKind: "schedule_plan_metric",
        feature: "schedule_advisor",
        inputText: "metric",
        outputText: "{}",
      },
    });
    const publishedAt = new Date("2026-07-20T12:00:00");
    await prisma.schedulePlan.update({
      where: { id: fixture.target.id },
      data: {
        status: "published",
        mode: "work5rest2",
        version: 4,
        publishedAt,
        recommendationJson: JSON.stringify({ assignments: [], gaps: [] }),
        recommendationAiLogId: canonical.id,
      },
    });
    await expect(
      updatePlanMode(scope(fixture), {
        id: fixture.target.id,
        mode: "work6rest1",
        version: 4,
      }),
    ).rejects.toMatchObject({ status: 409 });

    authState.user = fixture.managerA;
    const response = await planRoute.POST(
      jsonRequest("/api/schedule/plan", "POST", {
        id: fixture.target.id,
        mode: "work6rest1",
        version: 4,
      }),
    );
    expect(response.status).toBe(409);
    await expect(
      prisma.schedulePlan.findUniqueOrThrow({ where: { id: fixture.target.id } }),
    ).resolves.toMatchObject({
      status: "published",
      mode: "work5rest2",
      version: 4,
      publishedAt,
      recommendationAiLogId: canonical.id,
    });
  });
});

describe("import, copy, and restore commands", () => {
  it("rejects populated workbook rows when the scoped store has no eligible employees", async () => {
    const fixture = await createFixture();
    await prisma.user.updateMany({
      where: { storeId: fixture.storeA.id, role: "employee" },
      data: { employeeNo: null },
    });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("班表导入");
    sheet.addRow([
      "员工工号", "姓名", "岗位", "2026-07-20", "2026-07-21",
      "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25", "2026-07-26",
    ]);
    sheet.addRow(["FAKE", "假员工", "sales", "早班"]);
    const result = await validateImportFile(scope(fixture), {
      planId: fixture.target.id,
      version: 0,
      fileName: "fake.xlsx",
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    });
    expect(result.errors.map((issue) => issue.code)).toContain("employee_identity");
    expect(result).toMatchObject({ importable: 0, successRows: 0, errorRows: 1 });
    const batch = await prisma.scheduleImportBatch.findUniqueOrThrow({
      where: { id: result.batchId },
    });
    expect(batch.normalizedRowsJson).toBe("[]");
  });

  it("commits only a scoped validated snapshot at the validated version", async () => {
    const fixture = await createFixture();
    const batch = await prisma.scheduleImportBatch.create({
      data: {
        storeId: fixture.storeA.id,
        planId: fixture.target.id,
        fileName: "schedule.xlsx",
        status: "validated",
        validatedVersion: 0,
        totalRows: 1,
        successRows: 1,
        errorRows: 0,
        errorsJson: "[]",
        normalizedRowsJson: JSON.stringify([
          { userId: fixture.employeeA.id, date: "2026-07-20", shiftType: "morning" },
        ]),
        createdById: fixture.managerA.id,
      },
    });
    const result = await commitImport(scope(fixture), { batchId: batch.id, version: 0 });
    expect(result.plan.version).toBe(1);
    await expect(
      prisma.scheduleImportBatch.findUniqueOrThrow({ where: { id: batch.id } }),
    ).resolves.toMatchObject({ status: "imported" });
    expect(await prisma.schedule.count({ where: { planId: fixture.target.id } })).toBe(1);
  });

  it("rejects stale and cross-store batches without changing schedules", async () => {
    const fixture = await createFixture();
    const batch = await prisma.scheduleImportBatch.create({
      data: {
        storeId: fixture.storeA.id,
        planId: fixture.target.id,
        fileName: "stale.xlsx",
        status: "validated",
        validatedVersion: 0,
        totalRows: 0,
        successRows: 0,
        errorRows: 0,
        errorsJson: "[]",
        normalizedRowsJson: "[]",
        createdById: fixture.managerA.id,
      },
    });
    await prisma.schedulePlan.update({ where: { id: fixture.target.id }, data: { version: 1 } });
    await expect(
      commitImport(scope(fixture), { batchId: batch.id, version: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      commitImport(
        { user: fixture.managerB, storeId: fixture.storeB.id },
        { batchId: batch.id, version: 0 },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await prisma.schedule.count({ where: { planId: fixture.target.id } })).toBe(0);
  });

  it("rolls back plan rows and version, then records failed in an independent write", async () => {
    const fixture = await createFixture();
    await prisma.schedule.create({
      data: {
        storeId: fixture.storeA.id,
        userId: fixture.employeeA.id,
        date: new Date("2026-07-20T00:00:00"),
        shiftType: "morning",
        weekOf: fixture.source.weekOf,
        source: "manual",
        planId: fixture.source.id,
      },
    });
    const original = await prisma.schedule.create({
      data: {
        storeId: fixture.storeA.id,
        userId: fixture.employeeA2.id,
        date: new Date("2026-07-21T00:00:00"),
        shiftType: "morning",
        weekOf: fixture.target.weekOf,
        source: "manual",
        planId: fixture.target.id,
      },
    });
    const batch = await prisma.scheduleImportBatch.create({
      data: {
        storeId: fixture.storeA.id,
        planId: fixture.target.id,
        fileName: "rollback.xlsx",
        status: "validated",
        validatedVersion: 0,
        totalRows: 2,
        successRows: 2,
        errorRows: 0,
        errorsJson: "[]",
        normalizedRowsJson: JSON.stringify([
          { userId: fixture.employeeA.id, date: "2026-07-20", shiftType: "morning" },
          { userId: fixture.employeeA2.id, date: "2026-07-22", shiftType: "evening" },
        ]),
        createdById: fixture.managerA.id,
      },
    });
    await expect(
      commitImport(
        scope(fixture),
        { batchId: batch.id, version: 0 },
        createFailingScheduleWriterFactory(2),
      ),
    ).rejects.toThrow("测试导入写入失败");
    await expect(
      prisma.schedulePlan.findUniqueOrThrow({ where: { id: fixture.target.id } }),
    ).resolves.toMatchObject({ version: 0 });
    expect(await prisma.schedule.findUnique({ where: { id: original.id } })).not.toBeNull();
    await expect(
      prisma.scheduleImportBatch.findUniqueOrThrow({ where: { id: batch.id } }),
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("never lets failure recording overwrite an imported terminal batch", async () => {
    const fixture = await createFixture();
    const batch = await prisma.scheduleImportBatch.create({
      data: {
        storeId: fixture.storeA.id,
        planId: fixture.target.id,
        fileName: "already-imported.xlsx",
        status: "imported",
        validatedVersion: 0,
        totalRows: 0,
        successRows: 0,
        errorRows: 0,
        errorsJson: "[]",
        normalizedRowsJson: "[]",
        createdById: fixture.managerA.id,
      },
    });
    expect(
      await markImportFailedIfValidated(batch.id, fixture.storeA.id, "late failure"),
    ).toBe(0);
    await expect(
      prisma.scheduleImportBatch.findUniqueOrThrow({ where: { id: batch.id } }),
    ).resolves.toMatchObject({ status: "imported", errorsJson: "[]" });
  });

  it("copies only a published plan in the same store and restores server recommendation", async () => {
    const fixture = await createFixture();
    await prisma.schedule.create({
      data: {
        storeId: fixture.storeA.id,
        userId: fixture.employeeA.id,
        date: new Date("2026-07-13T00:00:00"),
        shiftType: "morning",
        weekOf: fixture.source.weekOf,
        source: "manual",
        planId: fixture.source.id,
      },
    });
    const copied = await copyHistory(scope(fixture), {
      planId: fixture.target.id,
      sourcePlanId: fixture.source.id,
      version: 0,
    });
    expect(copied.plan.version).toBe(1);
    await expect(
      prisma.schedule.findFirstOrThrow({ where: { planId: fixture.target.id } }),
    ).resolves.toMatchObject({ weekOf: "2026-07-20" });

    await prisma.schedulePlan.update({
      where: { id: fixture.target.id },
      data: {
        recommendationJson: JSON.stringify({
          assignments: [
            { userId: fixture.employeeA2.id, date: "2026-07-22", shiftType: "evening" },
          ],
          gaps: [],
          note: "",
          explanation: "",
          status: "feasible",
        }),
      },
    });
    const restored = await restoreRecommendation(scope(fixture), {
      planId: fixture.target.id,
      version: 1,
    });
    expect(restored.plan.version).toBe(2);
    await expect(
      prisma.schedule.findFirstOrThrow({ where: { planId: fixture.target.id } }),
    ).resolves.toMatchObject({ userId: fixture.employeeA2.id, shiftType: "evening" });
  });
});

describe("Task 5 route authorization and read models", () => {
  it("returns neutral copy when an xlsx workbook cannot be parsed", async () => {
    const fixture = await createFixture();
    authState.user = fixture.managerA;
    const form = new FormData();
    form.set("planId", fixture.target.id);
    form.set("version", "0");
    form.set("file", new File([new Uint8Array([1, 2, 3])], "broken.xlsx"));

    const response = await importValidateRoute.POST(
      new Request("http://localhost/api/schedule/import/validate", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(400);
    await expect(responseData(response)).resolves.toMatchObject({
      ok: false,
      error: "表格文件（.xlsx）无法解析",
    });
  });

  it("requires an explicit non-empty import version before creating a batch", async () => {
    const fixture = await createFixture();
    authState.user = fixture.managerA;
    for (const version of [undefined, ""] as const) {
      const form = new FormData();
      form.set("planId", fixture.target.id);
      form.set("file", new File([new Uint8Array([1, 2, 3])], "schedule.xlsx"));
      if (version !== undefined) form.set("version", version);
      const response = await importValidateRoute.POST(
        new Request("http://localhost/api/schedule/import/validate", {
          method: "POST",
          body: form,
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(await prisma.scheduleImportBatch.count()).toBe(0);
  });

  it("reads the exact plan through compatibility GET with scoped manager/admin access", async () => {
    const fixture = await createFixture();
    await prisma.schedule.createMany({
      data: [
        {
          storeId: fixture.storeA.id,
          userId: fixture.employeeA.id,
          date: new Date("2026-07-13T00:00:00"),
          shiftType: "morning",
          weekOf: fixture.source.weekOf,
          source: "manual",
          planId: fixture.source.id,
        },
        {
          storeId: fixture.storeA.id,
          userId: fixture.employeeA.id,
          date: new Date("2026-07-20T00:00:00"),
          shiftType: "evening",
          weekOf: fixture.target.weekOf,
          source: "manual",
          planId: fixture.target.id,
        },
      ],
    });

    authState.user = fixture.managerA;
    let response = await scheduleRoute.GET(
      jsonRequest(`/api/schedule?planId=${fixture.source.id}`),
    );
    expect(response.status).toBe(200);
    let payload = await responseData(response);
    expect(payload.data.plan).toMatchObject({ id: fixture.source.id, weekOf: "2026-07-13" });
    expect(payload.data.schedules).toHaveLength(1);
    expect(payload.data.schedules[0]).toMatchObject({ shiftType: "morning" });

    authState.user = fixture.managerB;
    response = await scheduleRoute.GET(
      jsonRequest(`/api/schedule?planId=${fixture.source.id}`),
    );
    expect(response.status).toBe(403);

    authState.user = fixture.admin;
    response = await scheduleRoute.GET(
      jsonRequest(`/api/schedule?planId=${fixture.target.id}`),
    );
    expect(response.status).toBe(200);
    payload = await responseData(response);
    expect(payload.data.schedules).toHaveLength(1);
    expect(payload.data.schedules[0]).toMatchObject({ shiftType: "evening" });

    response = await scheduleRoute.GET(jsonRequest("/api/schedule?planId=missing"));
    expect(response.status).toBe(404);
  });

  it("keeps admin publish read-only", async () => {
    const fixture = await createFixture();
    authState.user = fixture.admin;
    const response = await publishRoute.POST(
      jsonRequest("/api/schedule/publish", "POST", {
        planId: fixture.target.id,
        version: 0,
        assignments: [],
      }),
    );
    expect(response.status).toBe(403);
  });

  it("returns only the employee's own published rows", async () => {
    const fixture = await createFixture();
    await prisma.schedulePlan.update({
      where: { id: fixture.target.id },
      data: { status: "published", publishedAt: new Date() },
    });
    await prisma.schedule.createMany({
      data: [
        {
          storeId: fixture.storeA.id,
          userId: fixture.employeeA.id,
          date: new Date("2026-07-20T00:00:00"),
          shiftType: "morning",
          weekOf: fixture.target.weekOf,
          source: "manual",
          planId: fixture.target.id,
        },
        {
          storeId: fixture.storeA.id,
          userId: fixture.employeeA2.id,
          date: new Date("2026-07-20T00:00:00"),
          shiftType: "evening",
          weekOf: fixture.target.weekOf,
          source: "manual",
          planId: fixture.target.id,
        },
      ],
    });
    authState.user = fixture.employeeA;
    const response = await mineRoute.GET(
      jsonRequest(`/api/schedule/mine?weekOf=${fixture.target.weekOf}&userId=${fixture.employeeA2.id}`),
    );
    expect(response.status).toBe(200);
    const payload = await responseData(response);
    expect(payload.data.rows).toHaveLength(1);
    expect(payload.data.rows[0]).toMatchObject({ shiftType: "morning" });
  });

  it("exports seven exact date columns and a legal double shift without mutating version", async () => {
    const fixture = await createFixture();
    await prisma.schedule.createMany({
      data: ["morning", "evening"].map((shiftType) => ({
        storeId: fixture.storeA.id,
        userId: fixture.employeeA.id,
        date: new Date("2026-07-20T00:00:00"),
        shiftType,
        weekOf: fixture.target.weekOf,
        source: "manual",
        planId: fixture.target.id,
      })),
    });
    authState.user = fixture.admin;
    const response = await exportRoute.GET(
      jsonRequest(`/api/schedule/export?planId=${fixture.target.id}&storeId=${fixture.storeA.id}`),
    );
    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    const bytes = new Uint8Array(await response.arrayBuffer());
    await workbook.xlsx.load(bytes.buffer);
    const header = workbook.worksheets[0].getRow(1).values as unknown[];
    expect(header.slice(4, 11)).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
    ]);
    expect(workbook.worksheets[0].getCell("D2").value).toBe("早班+晚班");
    await expect(
      prisma.schedulePlan.findUniqueOrThrow({ where: { id: fixture.target.id } }),
    ).resolves.toMatchObject({ version: 0 });
  });

  it("rejects raw, cross-store, and stale legacy AI feedback", async () => {
    const fixture = await createFixture();
    const raw = await prisma.aiInteractionLog.create({
      data: {
        userId: fixture.managerA.id,
        storeId: fixture.storeA.id,
        planId: fixture.target.id,
        feature: "schedule_advisor",
        inputText: "raw",
        outputText: "raw",
      },
    });
    authState.user = fixture.managerA;
    let response = await feedbackRoute.POST(
      jsonRequest("/api/ai-feedback", "POST", {
        planId: fixture.target.id,
        aiLogId: raw.id,
        wasAccepted: true,
      }),
    );
    expect(response.status).toBe(409);

    const canonical = await prisma.aiInteractionLog.create({
      data: {
        userId: fixture.managerA.id,
        storeId: fixture.storeA.id,
        planId: fixture.target.id,
        eventKind: "schedule_plan_metric",
        feature: "schedule_advisor",
        inputText: "metric",
        outputText: "{}",
      },
    });
    await prisma.schedulePlan.update({
      where: { id: fixture.target.id },
      data: { recommendationAiLogId: canonical.id },
    });
    response = await feedbackRoute.POST(
      jsonRequest("/api/ai-feedback", "POST", {
        planId: fixture.target.id,
        aiLogId: canonical.id,
        wasAccepted: true,
      }),
    );
    expect(response.status).toBe(409);
    await expect(
      prisma.aiInteractionLog.findUniqueOrThrow({ where: { id: canonical.id } }),
    ).resolves.toMatchObject({ wasAccepted: null, wasEdited: null });

    authState.user = fixture.managerB;
    response = await feedbackRoute.POST(
      jsonRequest("/api/ai-feedback", "POST", {
        planId: fixture.target.id,
        aiLogId: canonical.id,
        wasAccepted: true,
      }),
    );
    expect(response.status).toBe(403);

    authState.user = fixture.managerA;
    await prisma.schedulePlan.update({
      where: { id: fixture.target.id },
      data: { recommendationAiLogId: null },
    });
    response = await feedbackRoute.POST(
      jsonRequest("/api/ai-feedback", "POST", {
        planId: fixture.target.id,
        aiLogId: canonical.id,
        wasAccepted: true,
      }),
    );
    expect(response.status).toBe(409);
  });

  it("keeps generic assistant feedback self-only while excluding schedule logs", async () => {
    const fixture = await createFixture();
    const assistantLog = await prisma.aiInteractionLog.create({
      data: {
        userId: fixture.employeeA.id,
        storeId: fixture.storeA.id,
        feature: "assistant",
        inputText: "question",
        outputText: "answer",
      },
    });
    authState.user = fixture.employeeA;
    let response = await feedbackRoute.POST(
      jsonRequest("/api/ai-feedback", "POST", {
        aiLogId: assistantLog.id,
        wasAccepted: true,
      }),
    );
    expect(response.status).toBe(200);
    await expect(
      prisma.aiInteractionLog.findUniqueOrThrow({ where: { id: assistantLog.id } }),
    ).resolves.toMatchObject({ wasAccepted: true });

    authState.user = fixture.employeeA2;
    response = await feedbackRoute.POST(
      jsonRequest("/api/ai-feedback", "POST", {
        aiLogId: assistantLog.id,
        wasAccepted: false,
      }),
    );
    expect(response.status).toBe(403);
    await expect(
      prisma.aiInteractionLog.findUniqueOrThrow({ where: { id: assistantLog.id } }),
    ).resolves.toMatchObject({ wasAccepted: true });
  });
});
