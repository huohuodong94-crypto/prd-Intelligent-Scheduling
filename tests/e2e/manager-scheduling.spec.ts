import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { resolveE2eDatabaseUrl } from "../../playwright.environment";
import { loginAs } from "./helpers/auth";

const databaseUrl = resolveE2eDatabaseUrl();
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const EXTRA_EMPLOYEE_IDS = Array.from({ length: 8 }, (_, index) => `e2e-solver-employee-${index + 1}`);
const PLAN_WEEK = "2026-07-27";
const STORE_ID = "store-wangjing";
let createdPlanId: string | null = null;
let originalStoreAddress: string | null | undefined;

async function removeSolverFixture() {
  await prisma.schedule.deleteMany({
    where: {
      OR: [
        ...(createdPlanId ? [{ planId: createdPlanId }] : []),
        { userId: { in: EXTRA_EMPLOYEE_IDS } },
      ],
    },
  });
  if (createdPlanId) {
    await prisma.schedulePlan.delete({ where: { id: createdPlanId } });
    createdPlanId = null;
  }
  await prisma.workGroupMember.deleteMany({ where: { userId: { in: EXTRA_EMPLOYEE_IDS } } });
  await prisma.user.deleteMany({ where: { id: { in: EXTRA_EMPLOYEE_IDS } } });
}

test.beforeAll(async () => {
  await removeSolverFixture();
  originalStoreAddress = (await prisma.store.findUniqueOrThrow({
    where: { id: STORE_ID },
    select: { address: true },
  })).address;
  await prisma.user.createMany({
    data: EXTRA_EMPLOYEE_IDS.map((id, index) => ({
      id,
      phone: `1379000000${index}`,
      employeeNo: `E2E-${String(index + 1).padStart(3, "0")}`,
      name: `求解员工${index + 1}`,
      role: "employee",
      storeId: STORE_ID,
      position: index < 2 ? "cashier" : "sales",
      hireDate: new Date("2024-01-01T00:00:00+08:00"),
      employmentType: "fulltime",
      maxWeeklyHours: 40,
    })),
  });
  await prisma.workGroupMember.createMany({
    data: EXTRA_EMPLOYEE_IDS.map((userId, index) => ({
      id: `e2e-solver-membership-${index + 1}`,
      workGroupId: "group-wj-traffic",
      userId,
      workAreaId: index < 2 ? "area-wj-checkout" : "area-wj-floor",
      effectiveFrom: new Date("2026-01-01T00:00:00+08:00"),
    })),
  });
});

test.afterAll(async () => {
  try {
    await removeSolverFixture();
  } finally {
    try {
      if (originalStoreAddress !== undefined) {
        await prisma.store.update({
          where: { id: STORE_ID },
          data: { address: originalStoreAddress },
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  }
});

test("manager configures the store, runs real OR-Tools and publishes the four-step plan", async ({ page }) => {
  await loginAs(page, "13800000001");

  await page.goto("/store/basic");
  await expect(page.getByRole("heading", { name: "门店基础与营业日" })).toBeVisible();
  await page.getByRole("button", { name: "编辑门店" }).click();
  await page.getByLabel("地址").fill("北京市朝阳区广顺北大街 19 号 · E2E");
  await page.getByRole("button", { name: "保存门店" }).click();
  await expect(page.getByText("门店信息已保存")).toBeVisible();

  await page.goto("/schedule/plans");
  await page.getByRole("button", { name: "＋ 新建排班计划" }).click();
  await page.getByLabel("计划周（周一）").fill(PLAN_WEEK);
  await page.getByLabel("工作制").selectOption("work5rest2");
  const creatingPlan = page.waitForResponse((response) =>
    response.url().endsWith("/api/schedule/plans")
    && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "创建并进入" }).click();
  const createResponse = await creatingPlan;
  expect(createResponse.status()).toBe(201);
  createdPlanId = ((await createResponse.json()) as { data: { id: string } }).data.id;
  await expect(page).toHaveURL(/\/schedule\/plans\/[a-z0-9-]+$/);
  expect(new URL(page.url()).pathname).toBe(`/schedule/plans/${createdPlanId}`);

  await page.getByRole("button", { name: "下一步：业务预测 →" }).click();
  await page.getByRole("button", { name: "下一步：人力预测 →" }).click();
  await page.getByRole("button", { name: "下一步：自动排班 →" }).click();

  const generated = page.waitForResponse((response) => response.url().endsWith("/api/schedule/generate") && response.request().method() === "POST");
  await page.getByRole("button", { name: "生成推荐" }).click();
  const generatedResponse = await generated;
  expect(generatedResponse.status()).toBe(200);
  const generatedPayload = await generatedResponse.json() as {
    data: { status: string; assignments: unknown[]; gaps: unknown[] };
  };
  expect(generatedPayload.data.status).toBe("feasible");
  expect(generatedPayload.data.assignments.length).toBeGreaterThan(0);
  expect(generatedPayload.data.gaps).toEqual([]);
  await expect(page.getByText(/优化完成/)).toBeVisible();

  const published = page.waitForResponse((response) => response.url().endsWith("/api/schedule/publish") && response.request().method() === "POST");
  await page.getByRole("button", { name: "发布", exact: true }).click();
  expect((await published).status()).toBe(200);
  await expect(page.getByText(/已发布（\d+ 个班次）/)).toBeVisible();
  await expect(page.getByText("已发布（只读）")).toBeVisible();
});
