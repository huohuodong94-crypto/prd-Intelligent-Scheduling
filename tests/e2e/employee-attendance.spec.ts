import { expect, test } from "@playwright/test";

import { loginAs } from "./helpers/auth";

test("employee punch and correction flow reaches confirmed monthly report state", async ({ page }) => {
  await loginAs(page, "13800000001");
  const codeResponse = await page.request.get("/api/clock-code");
  expect(codeResponse.status()).toBe(200);
  const codePayload = await codeResponse.json() as { data: { code: string } };

  await loginAs(page, "13810000001");
  await page.goto("/attendance");
  await page.getByLabel("6 位动态码").fill(codePayload.data.code);
  await page.getByRole("button", { name: "确认上班打卡" }).click();
  await expect(page.getByRole("status")).toContainText("上班打卡成功");

  await page.goto("/leave");
  await page.getByRole("tab", { name: "补卡" }).click();
  await page.getByLabel("补卡日期").fill("2026-07-20");
  await page.locator('select[name="direction"]').selectOption("out");
  await page.getByLabel("补卡时间").fill("13:00");
  await page.getByLabel("补卡原因").fill("E2E 修正早退");
  await page.getByRole("button", { name: "提交申请" }).click();
  await expect(page.getByText("提交成功，已进入审批流程")).toBeVisible();

  await loginAs(page, "13800000001");
  await page.goto("/approvals");
  await page.getByLabel("审批类型").selectOption("punch_correction");
  await page.getByLabel("员工筛选").fill("小王");
  const approval = page.locator("div.p-3.space-y-2 > div.border.rounded").filter({ hasText: "2026-07-20 下班补卡" });
  await expect(approval).toHaveCount(1);
  await approval.getByRole("button", { name: "AI 合规建议" }).click();
  await expect(approval).toContainText("AI 建议：");
  await approval.getByRole("checkbox").check();
  await page.getByRole("button", { name: "批量通过" }).click();
  await expect(approval).toHaveCount(0);

  await page.goto("/attendance/daily");
  await page.getByLabel("开始日期").fill("2026-07-20");
  await page.getByLabel("结束日期").fill("2026-07-20");
  const recalculated = page.waitForResponse((response) => response.url().endsWith("/api/attendance/daily/recalculate") && response.request().method() === "POST");
  await page.getByRole("button", { name: "重新计算" }).click();
  expect((await recalculated).status()).toBe(200);
  await page.getByLabel("确认状态").selectOption("unconfirmed");
  await page.getByRole("button", { name: "查询" }).click();

  for (let remaining = await page.getByRole("checkbox", { name: /^选择 / }).count(); remaining > 0; remaining = await page.getByRole("checkbox", { name: /^选择 / }).count()) {
    await page.getByRole("checkbox", { name: /^选择 / }).first().check();
    const confirmed = page.waitForResponse((response) => response.url().endsWith("/api/attendance/daily/confirm") && response.request().method() === "POST");
    await page.getByRole("button", { name: "批量确认" }).click();
    expect((await confirmed).status()).toBe(200);
    await expect(page.getByRole("status")).toContainText("已确认所选异常");
  }

  await page.goto("/attendance/monthly");
  await page.getByLabel("月份").fill("2026-07");
  await expect(page.getByRole("checkbox", { name: "选择小王" })).toBeVisible();
  const zeroAttendanceActions = page.locator('select[aria-label$="0 考勤处理"]');
  for (let index = 0; index < await zeroAttendanceActions.count(); index += 1) {
    await zeroAttendanceActions.nth(index).selectOption("normal_attendance");
  }
  await page.getByRole("checkbox", { name: "选择小王" }).check();
  const monthlyConfirmed = page.waitForResponse((response) => response.url().endsWith("/api/attendance/monthly/confirm") && response.request().method() === "POST");
  await page.getByRole("button", { name: "确认考勤" }).click();
  expect((await monthlyConfirmed).status()).toBe(200);
  await expect(page.getByRole("status")).toContainText("已确认所选月度考勤");

  await page.goto("/reports/monthly");
  await page.getByLabel("月份").fill("2026-07");
  await page.getByRole("button", { name: "查询" }).click();
  const xiaoWang = page.getByRole("table", { name: "月度工时报表" }).getByRole("row").filter({ hasText: "小王" });
  await expect(xiaoWang).toContainText("已确认");
});
