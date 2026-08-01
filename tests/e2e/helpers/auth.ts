import { expect, type Page } from "@playwright/test";

const DESTINATION_BY_PHONE: Record<string, RegExp> = {
  "13900000000": /\/admin\/demand$/,
};

export async function loginAs(page: Page, phone: string): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-07-20T09:10:00+08:00"));
  await page.request.post("/api/auth/logout");
  await page.goto("/");
  await page.getByLabel("手机号").fill(phone);
  await page.getByLabel("验证码").fill("123456");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(DESTINATION_BY_PHONE[phone] ?? /\/dashboard$/);
}
