import { defineConfig, devices } from "@playwright/test";

import { resolveE2eDatabaseUrl } from "./playwright.environment";

const databaseUrl = resolveE2eDatabaseUrl();
const solverPython = process.env.WFM_SOLVER_PYTHON?.trim() || "python3";

const e2eEnv = {
  ...process.env,
  CI: "1",
  DATABASE_URL: databaseUrl,
  WFM_E2E_IMPORT_FAILURES: "1",
  WFM_E2E_NOW: "2026-07-20T09:10:00+08:00",
  SCHEDULE_ENGINE_URL: "http://127.0.0.1:8000",
  CLOCK_CODE_SECRET: "wfm-task10-deterministic-clock-secret",
  LLM_PROVIDER: "mock",
};

export default defineConfig({
  testDir: ".",
  testMatch: ["tests/e2e/**/*.spec.ts", "tests/visual/**/*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:3000",
    locale: "zh-CN",
    launchOptions: { args: ["--lang=zh-CN"] },
    timezoneId: "Asia/Shanghai",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npm run db:reset && npm run dev -- --hostname 127.0.0.1 --port 3000",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: false,
      timeout: 120_000,
      env: e2eEnv,
    },
    {
      command: `cd schedule-engine && ${solverPython} -m uvicorn main:app --host 127.0.0.1 --port 8000`,
      url: "http://127.0.0.1:8000/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: e2eEnv,
    },
  ],
  snapshotPathTemplate: "{testFileDir}/__screenshots__/{arg}{ext}",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
