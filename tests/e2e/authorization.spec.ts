import { expect, test } from "@playwright/test";

import { loginAs } from "./helpers/auth";

test("login stays single-column without tenant or inactive SSO surfaces", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("form", { name: "登录账户" })).toBeVisible();
  await expect(page.getByText(/租户/)).toHaveCount(0);
  await expect(page.getByText("或使用以下方式登录")).toHaveCount(0);
  await expect(page.getByText(/企业 SSO/)).toHaveCount(0);

  const box = await page.getByTestId("login-card").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(512);
});

test("server pages and APIs enforce employee, manager and admin store scope", async ({ page }) => {
  const anonymous = await page.request.get("/api/reports/monthly?month=2026-07");
  expect(anonymous.status()).toBe(401);

  await loginAs(page, "13810000001");
  await page.goto("/schedule/plans");
  await expect(page).toHaveURL(/\/dashboard$/);
  expect((await page.request.get("/api/reports/monthly?month=2026-07")).status()).toBe(403);
  expect((await page.request.get("/api/attendance/punches?storeId=store-zhongguancun")).status()).toBe(403);

  await loginAs(page, "13800000001");
  expect((await page.request.get("/api/reports/monthly?month=2026-07")).status()).toBe(200);
  expect((await page.request.get("/api/reports/monthly?month=2026-07&storeId=store-zhongguancun")).status()).toBe(403);

  await loginAs(page, "13900000000");
  expect((await page.request.get("/api/reports/monthly?month=2026-07")).status()).toBe(400);
  expect((await page.request.get("/api/reports/monthly?month=2026-07&storeId=store-wangjing")).status()).toBe(200);
});
