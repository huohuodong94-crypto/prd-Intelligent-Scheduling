import { readFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { expect, test, type Download, type Page } from "@playwright/test";

import { resolveE2eDatabaseUrl } from "../../playwright.environment";
import { loginAs } from "./helpers/auth";

const databaseUrl = resolveE2eDatabaseUrl();
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const EXTRA_EMPLOYEES = Array.from({ length: 8 }, (_, index) => ({
  id: `e2e-import-employee-${index + 1}`,
  employeeNo: index < 2 ? `IMP-C0${index + 1}` : `IMP-S0${index - 1}`,
  position: index < 2 ? "cashier" : "sales",
}));
const PLAN_WEEKS = ["2026-08-03", "2026-08-10"];
const SHIFT_LABELS = ["早班", "午班", "晚班"];

async function removeImportFixture() {
  const plans = await prisma.schedulePlan.findMany({
    where: { storeId: "store-wangjing", weekOf: { in: PLAN_WEEKS } },
    select: { id: true },
  });
  await prisma.schedule.deleteMany({
    where: {
      OR: [
        { planId: { in: plans.map((plan) => plan.id) } },
        { userId: { in: EXTRA_EMPLOYEES.map((employee) => employee.id) } },
      ],
    },
  });
  await prisma.scheduleImportBatch.deleteMany({ where: { planId: { in: plans.map((plan) => plan.id) } } });
  await prisma.schedulePlan.deleteMany({ where: { id: { in: plans.map((plan) => plan.id) } } });
  await prisma.workGroupMember.deleteMany({ where: { userId: { in: EXTRA_EMPLOYEES.map((employee) => employee.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: EXTRA_EMPLOYEES.map((employee) => employee.id) } } });
}

test.beforeAll(async () => {
  await removeImportFixture();
  await prisma.user.createMany({
    data: EXTRA_EMPLOYEES.map((employee, index) => ({
      id: employee.id,
      phone: `1378000000${index}`,
      employeeNo: employee.employeeNo,
      name: `导入员工${index + 1}`,
      role: "employee",
      storeId: "store-wangjing",
      position: employee.position,
      hireDate: new Date("2024-01-01T00:00:00+08:00"),
      employmentType: "fulltime",
      maxWeeklyHours: 40,
    })),
  });
  await prisma.workGroupMember.createMany({
    data: EXTRA_EMPLOYEES.map((employee, index) => ({
      id: `e2e-import-membership-${index + 1}`,
      workGroupId: "group-wj-traffic",
      userId: employee.id,
      workAreaId: employee.position === "cashier" ? "area-wj-checkout" : "area-wj-floor",
      effectiveFrom: new Date("2026-01-01T00:00:00+08:00"),
    })),
  });
});

test.afterAll(async () => {
  await removeImportFixture();
  await prisma.$disconnect();
});

async function createPlanAndOpenImport(page: Page, weekOf: string): Promise<string> {
  await page.goto("/schedule/plans");
  await page.getByRole("button", { name: "＋ 新建排班计划" }).click();
  await page.getByLabel("计划周（周一）").fill(weekOf);
  await page.getByRole("button", { name: "创建并进入" }).click();
  await expect(page).toHaveURL(/\/schedule\/plans\/[a-z0-9-]+$/);
  const planId = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.getByRole("button", { name: "下一步：业务预测 →" }).click();
  await page.getByRole("button", { name: "下一步：人力预测 →" }).click();
  await page.getByRole("button", { name: "下一步：自动排班 →" }).click();
  await expect(page.getByRole("link", { name: "下载模板" })).toBeVisible();
  return planId;
}

async function downloadedTemplate(page: Page): Promise<Download> {
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载模板" }).click();
  return downloading;
}

async function legalWorkbook(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error("未获取导入模板下载路径");
  const workbook = new ExcelJS.Workbook();
  const template = await readFile(path);
  const arrayBuffer = template.buffer.slice(
    template.byteOffset,
    template.byteOffset + template.byteLength,
  ) as ArrayBuffer;
  await workbook.xlsx.load(arrayBuffer);
  const sheet = workbook.worksheets[0];
  const cashiers: number[] = [];
  const sales: number[] = [];
  for (let row = 2; row <= sheet.rowCount; row += 1) {
    (sheet.getCell(row, 3).text === "cashier" ? cashiers : sales).push(row);
  }
  expect(cashiers).toHaveLength(4);
  expect(sales).toHaveLength(9);

  for (let day = 0; day < 6; day += 1) {
    for (let shift = 0; shift < 3; shift += 1) {
      sheet.getCell(cashiers[(day * 3 + shift) % cashiers.length], day + 4).value = SHIFT_LABELS[shift];
      const salesPerShift = day === 5 ? 3 : 2;
      for (let index = 0; index < salesPerShift; index += 1) {
        const employeeIndex = day === 5
          ? shift * 3 + index
          : (day * 6 + shift * 2 + index) % sales.length;
        sheet.getCell(sales[employeeIndex], day + 4).value = SHIFT_LABELS[shift];
      }
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function invalidWorkbook(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error("未获取导入模板下载路径");
  const workbook = new ExcelJS.Workbook();
  const template = await readFile(path);
  const arrayBuffer = template.buffer.slice(
    template.byteOffset,
    template.byteOffset + template.byteLength,
  ) as ArrayBuffer;
  await workbook.xlsx.load(arrayBuffer);
  const sheet = workbook.worksheets[0];
  sheet.getCell(2, 1).value = "ZG-001";
  sheet.getCell(2, 2).value = "小周";
  sheet.getCell(2, 4).value = "通宵班";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function upload(page: Page, name: string, buffer: Buffer) {
  const response = page.waitForResponse((candidate) => candidate.url().endsWith("/api/schedule/import/validate") && candidate.request().method() === "POST");
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  return response;
}

test("schedule import covers generated template, validation errors, atomic rollback and publish", async ({ page }) => {
  await loginAs(page, "13800000001");

  const validPlanId = await createPlanAndOpenImport(page, PLAN_WEEKS[0]);
  const validBuffer = await legalWorkbook(await downloadedTemplate(page));
  expect((await upload(page, "valid-import.xlsx", validBuffer)).status()).toBe(200);
  await expect(page.getByText("可导入 13")).toBeVisible();
  await expect(page.getByText("错误 0")).toBeVisible();
  const committed = page.waitForResponse((response) => response.url().endsWith("/api/schedule/import/commit") && response.request().method() === "POST");
  await page.getByRole("button", { name: "确认导入" }).click();
  expect((await committed).status()).toBe(200);
  await expect(page.getByText("导入完成")).toBeVisible();
  const published = page.waitForResponse((response) => response.url().endsWith("/api/schedule/publish") && response.request().method() === "POST");
  await page.getByRole("button", { name: "发布", exact: true }).click();
  expect((await published).status()).toBe(200);
  const publishedDetail = await page.request.get(`/api/schedule/plan?id=${validPlanId}`);
  const publishedPayload = await publishedDetail.json() as { data: { schedules: unknown[]; status: string } };
  expect(publishedPayload.data.status).toBe("published");
  expect(publishedPayload.data.schedules.length).toBeGreaterThan(0);

  const rollbackPlanId = await createPlanAndOpenImport(page, PLAN_WEEKS[1]);
  const invalidBuffer = await invalidWorkbook(await downloadedTemplate(page));
  expect((await upload(page, "invalid-import.xlsx", invalidBuffer)).status()).toBe(200);
  await expect(page.getByRole("cell", { name: "员工身份" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "ZG-001/小周/cashier" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "通宵班" })).toBeVisible();
  await expect(page.getByText("仅允许早班、午班、晚班；同日双班用 + 分隔")).toBeVisible();
  const beforeRollback = await page.request.get(`/api/schedule/plan?id=${rollbackPlanId}`);
  const beforePayload = await beforeRollback.json() as { data: { schedules: unknown[]; version: number } };

  const rollbackBuffer = await legalWorkbook(await downloadedTemplate(page));
  expect((await upload(page, "rollback-fixture.xlsx", rollbackBuffer)).status()).toBe(200);
  await expect(page.getByText("错误 0")).toBeVisible();
  const rolledBack = page.waitForResponse((response) => response.url().endsWith("/api/schedule/import/commit") && response.request().method() === "POST");
  await page.getByRole("button", { name: "确认导入" }).click();
  expect((await rolledBack).status()).toBe(500);
  await expect(page.getByText("测试导入写入失败")).toBeVisible();
  const afterRollback = await page.request.get(`/api/schedule/plan?id=${rollbackPlanId}`);
  const afterPayload = await afterRollback.json() as { data: { schedules: unknown[]; version: number } };
  expect(afterPayload.data.schedules.length).toBe(beforePayload.data.schedules.length);
  expect(afterPayload.data.version).toBe(beforePayload.data.version);
});
