import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { resolveE2eDatabaseUrl } from "../../playwright.environment";
import { loginAs } from "../e2e/helpers/auth";

const prisma = new PrismaClient({ datasources: { db: { url: resolveE2eDatabaseUrl() } } });

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function expectModalKeyboardContract(
  page: Page,
  modal: Locator,
  opener: Locator,
  lastControl: Locator,
) {
  await expect(modal).toHaveAttribute("aria-modal", "true");
  await expect(modal.getByRole("button", { name: "关闭" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(lastControl).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(modal.getByRole("button", { name: "关闭" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(opener).toBeFocused();
}

test("1279px is blocked instead of rendering the application shell", async ({ page }) => {
  await page.setViewportSize({ width: 1279, height: 900 });
  await loginAs(page, "13800000001");
  await expect(page.getByText("请使用宽屏浏览器访问（最低 1280px）", { exact: true })).toBeVisible();
  await expect(page.locator("header")).toHaveCount(0);
  await expect(page.locator("aside")).toHaveCount(0);
  await expect(page.locator("main")).toHaveCount(0);
  await expect(page.getByTitle("AI 智能助手")).toHaveCount(0);
  await expect(page.getByTestId("desktop-shell")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1279);
});

test("1280px is the positive desktop boundary", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, "13800000001");
  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  await expect(page.locator("aside")).toBeVisible();
  await expect(page.getByText("请使用宽屏浏览器访问（最低 1280px）", { exact: true })).toHaveCount(0);
});

for (const [label, route, heading] of [
  ["dashboard", "/dashboard", "门店工作台"],
  ["schedule wizard", "/schedule/plans/plan-wangjing-2026-07-20", "四步排班向导"],
  ["approvals", "/approvals", "统一审批中心"],
  ["daily attendance", "/attendance/daily", "日考勤异常"],
  ["monthly attendance", "/attendance/monthly", "月度考勤汇总"],
] as const) {
  test(`${label} has no critical or serious accessibility violations`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, "13800000001");
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    if (label === "dashboard") {
      await expect(page.getByTestId("pending-approvals")).toBeVisible();
      await expect(page.locator('[aria-label="报表快捷入口"]')).toBeVisible();
    } else if (label === "schedule wizard") {
      await expect(page.getByLabel("工作制")).toBeVisible();
    } else if (label === "approvals") {
      const results = page.getByTestId("approvals-results");
      await expect(results).toHaveAttribute("data-result-state", /^(rows|empty)$/);
      if (await results.getAttribute("data-result-state") === "rows") {
        if (await results.getByTestId("approval-result-row").count() === 0) {
          await page.getByRole("tab", { name: "审批记录" }).click();
        }
        await expect(results.getByTestId("approval-result-row").first()).toBeVisible();
      } else {
        await expect(results.getByTestId("approval-empty-state")).toBeVisible();
      }
    } else if (label === "daily attendance") {
      const results = page.getByTestId("daily-attendance-results");
      await expect(results).toHaveAttribute("data-result-state", /^(rows|empty)$/);
      if (await results.getAttribute("data-result-state") === "rows") {
        await expect(results.locator("tbody tr").first()).toBeVisible();
      } else {
        await expect(results.getByText("当前筛选范围内暂无日异常", { exact: true })).toBeVisible();
      }
    } else if (label === "monthly attendance") {
      const results = page.getByTestId("monthly-attendance-results");
      await expect(results).toHaveAttribute("data-result-state", /^(rows|empty)$/);
      if (await results.getAttribute("data-result-state") === "rows") {
        await expect(results.locator("tbody tr").first()).toBeVisible();
      } else {
        await expect(results.getByText("当前月份暂无员工考勤", { exact: true })).toBeVisible();
      }
    }
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""))).toEqual([]);
  });
}

test("shared dialog and drawer trap focus, close on Escape and restore the opener", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAs(page, "13800000001");

  await page.goto("/store/basic");
  const editStore = page.getByRole("button", { name: "编辑门店" });
  await editStore.click();
  const dialog = page.getByRole("dialog", { name: "编辑门店" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "关闭" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "保存门店" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(editStore).toBeFocused();

  await page.goto("/attendance/daily");
  const proxy = page.getByRole("button", { name: "代提交申请" });
  await proxy.click();
  const drawer = page.getByRole("dialog", { name: "代提交考勤申请" });
  await expect(drawer.getByRole("button", { name: "关闭" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(proxy).toBeFocused();
});

test("approval and scheduling product dialogs implement the shared keyboard contract", async ({ page }) => {
  const baselineLeaveCount = await prisma.leaveRequest.count();
  let leaveId: string | null = null;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, "13810000001");
    const leaveResponse = await page.request.post("/api/leave", {
      data: {
        type: "sick",
        startTime: "2026-08-17T00:00:00+08:00",
        endTime: "2026-08-17T23:59:00+08:00",
        isFullDay: true,
        reason: "E2E 键盘弹层验收",
      },
    });
    const leavePayload = (await leaveResponse.json()) as { data?: { id: string } };
    leaveId = leavePayload.data?.id ?? null;
    expect(leaveResponse.status()).toBe(200);
    expect(leaveId).not.toBeNull();

    await loginAs(page, "13800000001");
    await page.goto("/approvals");
    const approvalRow = page.locator('[data-testid="approval-result-row"]').filter({
      has: page.getByRole("checkbox", { name: `选择 ${leaveId}` }),
    });
    await expect(approvalRow).toBeVisible();

    const detailOpener = approvalRow.getByRole("button", { name: "查看详情" });
    await detailOpener.click();
    const detailDialog = page.getByRole("dialog", { name: "单据详情" });
    await expectModalKeyboardContract(
      page,
      detailDialog,
      detailOpener,
      detailDialog.getByRole("button", { name: "返回" }),
    );

    await approvalRow.getByRole("checkbox").check();
    const rejectOpener = page.getByRole("button", { name: "批量驳回" });
    await rejectOpener.click();
    const rejectDialog = page.getByRole("dialog", { name: "填写驳回原因" });
    await expectModalKeyboardContract(
      page,
      rejectDialog,
      rejectOpener,
      rejectDialog.getByRole("button", { name: "取消" }),
    );
    await rejectOpener.click();
    const reopenedRejectDialog = page.getByRole("dialog", { name: "填写驳回原因" });
    await reopenedRejectDialog.getByLabel("驳回原因").fill("键盘门禁验收后清理");
    await reopenedRejectDialog.getByRole("button", { name: "确认驳回" }).click();
    await expect(approvalRow).toHaveCount(0);

    await loginAs(page, "13800000002");
    await page.goto("/schedule/plans/plan-zhongguancun-2026-07-20");
    await expect(page.getByRole("heading", { name: "四步排班向导" })).toBeVisible();
    await page.getByRole("button", { name: "下一步：业务预测 →" }).click();
    await page.getByRole("button", { name: "下一步：人力预测 →" }).click();
    await page.getByRole("button", { name: "下一步：自动排班 →" }).click();
    const scheduleCell = page.locator('[data-testid^="cell-"]').first();
    await scheduleCell.click();
    const editDialog = page.getByRole("dialog", { name: "编辑班次" });
    await expectModalKeyboardContract(
      page,
      editDialog,
      scheduleCell,
      editDialog.getByRole("button", { name: "保存" }),
    );

    const clearOpener = page.getByRole("button", { name: "清空排班" });
    await clearOpener.click();
    const clearDialog = page.getByRole("alertdialog", { name: "确认清空排班" });
    await expectModalKeyboardContract(
      page,
      clearDialog,
      clearOpener,
      clearDialog.getByRole("button", { name: "确认清空" }),
    );

    await page.goto("/schedule/plans");
    const createOpener = page.getByRole("button", { name: "＋ 新建排班计划" });
    await createOpener.click();
    const createDialog = page.getByRole("dialog", { name: "新建排班计划" });
    await expectModalKeyboardContract(
      page,
      createDialog,
      createOpener,
      createDialog.getByRole("button", { name: "创建并进入" }),
    );
  } finally {
    if (leaveId) {
      const deleted = await prisma.leaveRequest.deleteMany({ where: { id: leaveId } });
      expect(deleted.count).toBe(1);
      expect(await prisma.leaveRequest.count({ where: { id: leaveId } })).toBe(0);
    }
    expect(await prisma.leaveRequest.count()).toBe(baselineLeaveCount);
  }
});

const phaseBVisualRoutes = [
  "/dashboard",
  "/store/basic",
  "/store/work-groups",
  "/schedule/plans",
  "/approvals",
  "/attendance/daily",
  "/attendance/monthly",
  "/reports/monthly",
  "/reports/scheduling",
] as const;

type PhaseBVisualRoute = (typeof phaseBVisualRoutes)[number];

async function expectSettledResultState(results: Locator, row: Locator, empty: Locator) {
  await expect(results).toHaveAttribute("data-result-state", /^(rows|empty)$/);
  if (await results.getAttribute("data-result-state") === "rows") {
    await expect(row.first()).toBeVisible();
  } else {
    await expect(empty).toBeVisible();
  }
}

async function expectDesktopGeometry(page: Page) {
  const geometry = await page.evaluate(() => {
    const documentWidths = {
      html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
      main: (() => {
        const main = document.querySelector("main");
        return main ? main.scrollWidth - main.clientWidth : null;
      })(),
    };
    const assistant = document.querySelector<HTMLElement>('[title="AI 智能助手"]');
    const overlaps: string[] = [];
    if (assistant) {
      const assistantRect = assistant.getBoundingClientRect();
      for (const candidate of document.querySelectorAll<HTMLElement>("button, a, input, select, textarea, table")) {
        if (candidate === assistant || assistant.contains(candidate) || !candidate.checkVisibility()) continue;
        const rect = candidate.getBoundingClientRect();
        const intersects = assistantRect.left < rect.right
          && assistantRect.right > rect.left
          && assistantRect.top < rect.bottom
          && assistantRect.bottom > rect.top;
        if (intersects) overlaps.push(`${candidate.tagName.toLowerCase()}:${candidate.getAttribute("aria-label") ?? candidate.textContent?.trim().slice(0, 32) ?? ""}`);
      }
    }
    return { documentWidths, assistantFound: assistant !== null, overlaps };
  });

  expect(geometry).toEqual({
    documentWidths: { html: 0, body: 0, main: 0 },
    assistantFound: true,
    overlaps: [],
  });
}

async function preparePhaseBVisualRoute(page: Page, route: PhaseBVisualRoute) {
  await loginAs(page, "13800000001");
  await page.goto(route);

  if (route === "/dashboard") {
    await expect(page.getByRole("heading", { name: "门店工作台" })).toBeVisible();
    await expect(page.getByTestId("pending-approvals")).toBeVisible();
    await expect(page.getByLabel("报表快捷入口")).toBeVisible();
  } else if (route === "/store/basic") {
    await expect(page.getByRole("heading", { name: "门店基础与营业日" })).toBeVisible();
    await expect(page.getByText("固定班次（只读）", { exact: true })).toBeVisible();
    for (const column of ["星期", "营业状态", "开店时间", "闭店时间"]) {
      await expect(page.getByRole("columnheader", { name: column })).toBeVisible();
    }
  } else if (route === "/store/work-groups") {
    await expect(page.getByRole("heading", { name: "工作组" })).toBeVisible();
    await expect(page.getByRole("button", { name: "新增工作组" })).toBeVisible();
    for (const column of ["工作组", "组长", "业务量", "成员", "状态", "操作"]) {
      await expect(page.getByRole("columnheader", { name: column })).toBeVisible();
    }
  } else if (route === "/schedule/plans") {
    await expect(page.getByRole("heading", { name: "排班计划" })).toBeVisible();
    const month = page.getByLabel("计划月份");
    await month.fill("2026-07");
    await expect(month).toHaveValue("2026-07");
    const results = page.getByTestId("schedule-plans-results");
    await expectSettledResultState(
      results,
      results.getByRole("link", { name: "进入向导" }),
      results.getByText("暂无排班计划", { exact: true }),
    );
  } else if (route === "/approvals") {
    await expect(page.getByRole("heading", { name: "统一审批中心" })).toBeVisible();
    await expect(page.getByRole("tablist")).toBeVisible();
    await expect(page.getByRole("tab", { name: "待审批" })).toHaveAttribute("aria-selected", "true");
    const pendingPayload = await page.evaluate(async () => {
      const response = await fetch("/api/approvals?status=pending");
      return response.json() as Promise<{ ok: boolean; data: Array<{ id: string; submittedAt: string }> }>;
    });
    expect(pendingPayload.ok).toBe(true);
    expect(pendingPayload.data
      .filter(({ id }) => ["seed-proxy-correction-wj-01", "seed-proxy-leave-wj-01"].includes(id))
      .map(({ id, submittedAt }) => ({ id, submittedAt }))
      .sort((left, right) => left.id.localeCompare(right.id)))
      .toEqual([
        { id: "seed-proxy-correction-wj-01", submittedAt: "2026-07-19T08:49:02.000Z" },
        { id: "seed-proxy-leave-wj-01", submittedAt: "2026-07-19T08:49:02.000Z" },
      ]);
    const results = page.getByTestId("approvals-results");
    await expect(results).toHaveAttribute("data-result-state", "rows");
    const rows = results.getByTestId("approval-result-row");
    await expect(rows).toHaveCount(2);
    for (const id of ["seed-proxy-correction-wj-01", "seed-proxy-leave-wj-01"]) {
      const row = rows.filter({ has: page.getByRole("checkbox", { name: `选择 ${id}` }) });
      await expect(row).toHaveCount(1);
      await expect(row).toBeVisible();
      await expect(row.getByRole("checkbox", { name: `选择 ${id}` })).toBeVisible();
      await expect(row.getByText(/2026\/7\/19 16:49:02/)).toBeVisible();
    }
  } else if (route === "/attendance/daily") {
    await expect(page.getByRole("heading", { name: "日考勤异常" })).toBeVisible();
    await page.getByLabel("开始日期").fill("2026-07-20");
    await page.getByLabel("结束日期").fill("2026-07-20");
    await page.getByRole("button", { name: "查询", exact: true }).click();
    const results = page.getByTestId("daily-attendance-results");
    await expectSettledResultState(
      results,
      results.locator("tbody tr"),
      results.getByText("当前筛选范围内暂无日异常", { exact: true }),
    );
  } else if (route === "/attendance/monthly") {
    await expect(page.getByRole("heading", { name: "月度考勤汇总" })).toBeVisible();
    await page.getByLabel("月份").fill("2026-07");
    await expect(page.getByLabel("月份")).toHaveValue("2026-07");
    const results = page.getByTestId("monthly-attendance-results");
    await expectSettledResultState(
      results,
      results.locator("tbody tr"),
      results.getByText("当前月份暂无员工考勤", { exact: true }),
    );
  } else if (route === "/reports/monthly") {
    await expect(page.getByRole("heading", { name: "月度工时报表" })).toBeVisible();
    await page.getByLabel("月份").fill("2026-07");
    await page.getByRole("button", { name: "查询", exact: true }).click();
    const results = page.getByTestId("monthly-report-results");
    await expectSettledResultState(
      results,
      results.locator("tbody tr:not(:has(td[colspan]))"),
      results.getByText("暂无已授权报表数据", { exact: true }),
    );
  } else {
    await expect(page.getByRole("heading", { name: "排班分析报表" })).toBeVisible();
    await page.getByLabel("周一").fill("2026-07-20");
    await page.getByRole("button", { name: "查询", exact: true }).click();
    const results = page.getByTestId("scheduling-report-results");
    await expectSettledResultState(
      results,
      results.getByRole("table", { name: "员工排班报表" }).locator("tbody tr:not(:has(td[colspan]))"),
      results.getByText("暂无已授权排班数据", { exact: true }),
    );
  }

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

test.describe("Phase B PPT visual candidates", () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
    for (const route of phaseBVisualRoutes) {
      test(`${route} at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await preparePhaseBVisualRoute(page, route);
        if (viewport.width === 1366) await expectDesktopGeometry(page);
        await expect(page).toHaveScreenshot(`${route.slice(1).replaceAll("/", "-")}-${viewport.width}x${viewport.height}.png`, {
          animations: "disabled",
          caret: "hide",
          maxDiffPixelRatio: 0.01,
        });
      });
    }
  }
});
