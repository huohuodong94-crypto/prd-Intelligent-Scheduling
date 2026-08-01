# WFM 店铺经理桌面 Web 忠实复刻实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 WFM 仓库内交付只支持 1280px 以上桌面浏览器的店铺经理 Web 闭环，忠实复刻操作手册的信息结构、操作顺序和视觉密度，并把门店配置、排班、审批、考勤与报表连接到真实 API、Prisma 数据库和 Python OR-Tools。

**Architecture:** 保留 Next.js 14 App Router、TypeScript、Tailwind、Prisma SQLite/Postgres 双轨和 Python OR-Tools。前端按 `src/features/<domain>` 纵向组织，App Router 页面仅负责服务端鉴权和装配；共享 Zod 合同放在 `src/lib/contracts`，数据库写入留在服务端 service/route，所有门店资源先经统一的角色与 `storeId` 作用域解析。每个任务先 RED、再最小实现、再 GREEN，并在独立验收后提交。

**Tech Stack:** Next.js 14.2 App Router、React 18、TypeScript 5.6、Tailwind CSS 3.4、Prisma 5.22、SQLite/PostgreSQL、Python 3.9+、FastAPI、OR-Tools CP-SAT、Zod、Vitest、React Testing Library、Playwright、ExcelJS。

## Global Constraints

- 规格基线固定为 `docs/superpowers/specs/2026-07-19-wfm-desktop-web-replica-design.md`，基线提交为 `d9584c9b647d13525323c6c656d8f3cd661761b8`。
- PPT 视觉/流程基准由 `WFM_PPT_REFERENCE` 指向经授权旧版视觉参考；已核对共 63 页。
- 只交付桌面浏览器 Web；设计宽度 1440px，最低宽度 1280px；小于 1280px 显示阻断提示，不转为手机布局。
- 不交付手机端、APP、移动端响应式布局、Windows/macOS 原生客户端。
- 不新增子部门及子部门负责人，不新增 `SubDepartment`。
- 班次只允许 `morning` 09:00–13:00、`afternoon` 13:00–17:00、`evening` 17:00–21:00；不新增 `ShiftDefinition`，不提供班次时间编辑。
- 店长与管理员的 `position` 必须为 `null`，所有员工集合、需求折算与 OR-Tools 输入只包含 `role="employee"` 且属于当前门店的用户；不存在 DOM 审批入口。
- employee、manager、admin 三种角色继续沿用；所有 API 在服务端校验 role 和 `storeId`，前端菜单隐藏不作为授权。
- manager 只能访问自己 `SessionUser.storeId` 的记录；admin 访问门店数据时必须显式提供存在的 `storeId`；employee 只能访问本人数据。
- admin 可查看显式选定门店的数据并维护现有全局/需求参数，但创建/生成/编辑/导入/发布班表、人工审批、日异常确认和月度确认的写接口只允许绑定本店的 manager；admin 不代替店长完成日常操作。
- 所有写入接口校验记录当前状态；并发状态变化返回 409；无可行排班返回 422；引擎/LLM 不可用时保留手工操作并显示明确降级状态。
- 排班发布、批量审批、班表导入、考勤确认使用 `prisma.$transaction`；导入任一写入失败整批回滚。
- 新增或修改 Prisma 模型/字段必须在 `prisma/schema.prisma` 与 `prisma/schema.postgres.prisma` 同步，二者仅 datasource provider 不同。
- 统一 API 响应保持 `{ ok: true, data }` / `{ ok: false, error }`；结构化错误可增加 `details`，但不得改变 `ok` 与 `error` 语义。
- LLM 只经 `getLLM()` 解析软约束、解释结果和给出合规建议；排班分配只能由 `schedule-engine/solver.py` 的 OR-Tools CP-SAT 计算；AI 不自动审批。
- Prompt 继续存放在 `prompts/*.md`，不在业务代码硬编码系统提示词，不提交真实 API key。
- 所有日期合同使用本地日期 `YYYY-MM-DD`，周标识使用周一 `weekOf`，月份使用 `YYYY-MM`；不得用 UTC 序列化把本地日期减一天。
- 任务验收固定包含 Vitest 单元/合同测试、RTL 组件测试、SQLite 集成测试或 Playwright（按任务适用），并执行 `npx tsc --noEmit`。
- 每个任务只提交该任务明确列出的文件；开始下一任务前 `git status --short` 必须为空。

## Locked File and Interface Map

| 责任 | 现有文件 | 计划后的稳定入口 |
|---|---|---|
| 会话/JWT | `src/lib/auth.ts` | 保留 `requireSession(roles?)`，新增 `src/lib/authorization.ts` 的 `requireStoreAccess()` |
| API envelope | `src/lib/api.ts`、`src/lib/client.ts` | 泛型 `ok/fail/api/apiForm` 与 `src/lib/contracts/api.ts` |
| 固定班次 | `src/lib/config.ts`、`schedule-engine/solver.py` | 保持三班四小时，前后端合同只接受 `Shift` 联合类型 |
| 预测/人力 | `src/lib/forecast.ts` | 保留 `getForecastDetail()`、`getStaffing()`，向导服务消费其返回值 |
| 求解器客户端 | `src/lib/scheduleEngine.ts` | 扩展 `SolveRequest` 的工作制与岗位需求，不另起求解器 |
| 旧排班页 | `src/app/(app)/schedule/page.tsx` 与 `Step1Prepare.tsx`、`Step2Forecast.tsx`、`Step3Staffing.tsx` | `/schedule` 重定向到 `/schedule/plans`；新实现位于 `src/features/scheduling` |
| 旧企业组件 | `src/components/Shell.tsx`、`src/components/ui.tsx` | 壳迁入 `src/components/enterprise/*`，旧导出在迁移期只做兼容转发 |
| 旧报表 | `src/app/(app)/reports/page.tsx`、`src/app/api/reports/route.ts` | `/reports` 重定向 `/reports/monthly`，旧 API 委托新 service 保持兼容 |
| 数据库 | 两份 `prisma/schema*.prisma`、`prisma/seed.ts` | 每个纵向任务同步 schema、seed 与 SQLite 集成测试 |

---

### Task 1: 测试基础设施、全局桌面框架与企业组件

**Files:**
- Create: `vitest.config.ts`
- Create: `vitest.integration.config.ts`
- Create: `vitest.setup.ts`
- Create: `playwright.config.ts`
- Create: `.eslintrc.json`
- Create: `tests/helpers/test-db.ts`
- Create: `src/lib/contracts/api.ts`
- Create: `src/lib/contracts/dashboard.ts`
- Create: `src/lib/authorization.ts`
- Create: `src/lib/authorization.test.ts`
- Create: `src/components/enterprise/AppShell.tsx`
- Create: `src/components/enterprise/AppShell.test.tsx`
- Create: `src/components/enterprise/DesktopWidthGuard.tsx`
- Create: `src/components/enterprise/QueryBar.tsx`
- Create: `src/components/enterprise/EnterpriseTable.tsx`
- Create: `src/components/enterprise/ActionToolbar.tsx`
- Create: `src/components/enterprise/Dialog.tsx`
- Create: `src/components/enterprise/Drawer.tsx`
- Create: `src/components/enterprise/StatusTag.tsx`
- Create: `src/components/enterprise/AsyncBoundary.tsx`
- Create: `src/components/enterprise/index.ts`
- Create: `src/features/dashboard/server/dashboard-service.ts`
- Create: `src/features/dashboard/components/DashboardPage.tsx`
- Create: `src/features/dashboard/components/DashboardPage.test.tsx`
- Create: `src/app/api/dashboard/route.ts`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/client.ts`
- Modify: `src/components/Shell.tsx`
- Modify: `src/components/ui.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`
- Test: `src/lib/authorization.test.ts`
- Test: `src/components/enterprise/AppShell.test.tsx`
- Test: `src/features/dashboard/components/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: `SessionUser` 与 `requireSession(roles?: SessionUser["role"][])` from `src/lib/auth.ts`; `prisma.store.findUnique()` from `src/lib/db.ts`.
- Produces: `ApiSuccess<T> = { ok: true; data: T }`; `ApiFailure = { ok: false; error: string; details?: unknown }`; `StoreScope = { user: SessionUser; storeId: string }`; `requireStoreAccess(roles: Role[], requestedStoreId?: string | null): Promise<{ scope: StoreScope } | AuthFailure>`.
- Produces: `AppShellUser = SessionUser & { storeName: string | null }`; `AppShellProps = { user: AppShellUser; children: React.ReactNode }`; `EnterpriseColumn<T> = { key: keyof T | string; title: string; width?: number; render?: (row: T) => React.ReactNode }`; `AsyncBoundaryProps = { loading: boolean; error?: string | null; empty: boolean; onRetry?: () => void; children: React.ReactNode }`.
- Produces: `DashboardSummary = { store: { id: string; name: string } | null; pendingApprovals: number; draftPlans: number; scheduleGapCount: number | null; attendanceExceptionCount: number | null }`; every non-null count comes from Prisma, and later domain tasks replace the two `null` states when their source models/services exist.
- Produces test scripts: `npm test`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, `npm run test:visual`.

- [ ] **Step 1: Write the failing authorization and shell tests**

```ts
// src/lib/authorization.test.ts
import { describe, expect, it } from "vitest";
import { resolveStoreAccess } from "./authorization";
import type { SessionUser } from "./auth";

const manager: SessionUser = {
  id: "manager-a",
  name: "李经理",
  role: "manager",
  storeId: "store-a",
  phone: "13800000001",
};

describe("resolveStoreAccess", () => {
  it("rejects a manager requesting another store", () => {
    expect(resolveStoreAccess(manager, "store-b")).toEqual({
      error: "无权访问其他门店",
      status: 403,
    });
  });

  it("uses the manager session store when storeId is omitted", () => {
    expect(resolveStoreAccess(manager, null)).toEqual({
      user: manager,
      storeId: "store-a",
    });
  });
});
```

```tsx
// src/components/enterprise/AppShell.test.tsx
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import AppShell from "./AppShell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/schedule/plans",
  useRouter: () => ({ push: vi.fn() }),
}));

it("shows the manager desktop navigation and never exposes DOM approval", () => {
  render(
    <AppShell
      user={{ id: "m1", name: "李经理", role: "manager", storeId: "s1", storeName: "望京旗舰店", phone: "13800000001" }}
    >
      <div>content</div>
    </AppShell>
  );
  expect(screen.getByText("排班计划")).toBeInTheDocument();
  expect(screen.getByText("日异常")).toBeInTheDocument();
  expect(screen.queryByText(/DOM/)).not.toBeInTheDocument();
  expect(screen.getByTestId("desktop-shell")).toHaveStyle({ minWidth: "1280px" });
});
```

- [ ] **Step 2: Run the tests to verify RED**

Run: `npx vitest run src/lib/authorization.test.ts src/components/enterprise/AppShell.test.tsx`

Expected: FAIL with module resolution errors for `./authorization` and `./AppShell`; this confirms tests are not accidentally exercising the legacy shell.

- [ ] **Step 3: Install and configure the minimum test toolchain**

Run: `npm install --save-dev vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test eslint@8 eslint-config-next@14.2.15`

Run: `npx playwright install chromium`

Expected: Chromium installs successfully for the later desktop E2E/visual tasks.

Add these exact scripts to `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run --config vitest.config.ts",
    "test:integration": "DATABASE_URL=file:./test.db prisma db push --skip-generate --force-reset && DATABASE_URL=file:./test.db vitest run --config vitest.integration.config.ts",
    "test:e2e": "playwright test --project=chromium",
    "test:visual": "playwright test tests/visual --project=chromium"
  }
}
```

Use these complete config contracts:

```ts
// vitest.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["tests/integration/**", "tests/e2e/**", "tests/visual/**"],
  },
});
```

```ts
// vitest.integration.config.ts
import { defineConfig, mergeConfig } from "vitest/config";
import unitConfig from "./vitest.config";

export default mergeConfig(
  unitConfig,
  defineConfig({
    test: {
      environment: "node",
      include: ["tests/integration/**/*.test.ts"],
      fileParallelism: false,
    },
  })
);
```

```ts
// vitest.setup.ts
import "@testing-library/jest-dom/vitest";
```

```json
{
  "extends": ["next/core-web-vitals"]
}
```

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["tests/e2e/**/*.spec.ts", "tests/visual/**/*.spec.ts"],
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

Append `prisma/test.db`, `prisma/test.db-journal`, `test-results/` and `playwright-report/` to `.gitignore`.

Create a schema-independent SQLite reset so models added by later tasks are covered without changing this helper:

```ts
// tests/helpers/test-db.ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function resetTestDb(): Promise<void> {
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  try {
    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'"
    );
    for (const table of tables)
      await prisma.$executeRawUnsafe(`DELETE FROM "${table.name.replaceAll('"', '""')}"`);
  } finally {
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  }
}
```

- [ ] **Step 4: Implement the minimal authorization boundary and typed API envelope**

```ts
// src/lib/contracts/api.ts
export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = { ok: false; error: string; details?: unknown };
export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;
```

```ts
// src/lib/authorization.ts
import { prisma } from "./db";
import { requireSession, type SessionUser } from "./auth";

export type Role = SessionUser["role"];
export type StoreScope = { user: SessionUser; storeId: string };
export type AuthFailure = { error: string; status: number };

export function resolveStoreAccess(
  user: SessionUser,
  requestedStoreId?: string | null
): StoreScope | AuthFailure {
  const storeId = requestedStoreId || user.storeId;
  if (!storeId) return { error: "必须指定门店", status: 400 };
  if (user.role === "employee" && storeId !== user.storeId)
    return { error: "无权访问其他门店", status: 403 };
  if (user.role === "manager" && storeId !== user.storeId)
    return { error: "无权访问其他门店", status: 403 };
  return { user, storeId };
}

export async function requireStoreAccess(
  roles: Role[],
  requestedStoreId?: string | null
): Promise<{ scope: StoreScope } | AuthFailure> {
  const auth = await requireSession(roles);
  if ("error" in auth) return auth;
  const resolved = resolveStoreAccess(auth.user, requestedStoreId);
  if ("error" in resolved) return resolved;
  const store = await prisma.store.findUnique({ where: { id: resolved.storeId }, select: { id: true } });
  if (!store) return { error: "门店不存在", status: 404 };
  return { scope: resolved };
}
```

Change `src/lib/api.ts` to generic `ok<T>(data: T, status?: number)` and `fail(message: string, status = 400, details?: unknown)`; change `src/lib/client.ts` so JSON errors retain `details`, and add `apiForm<T>(path: string, body: FormData): Promise<T>` without setting a manual multipart boundary.

- [ ] **Step 5: Implement the 48px/208px desktop shell and enterprise primitives**

Use the exact navigation model below in `AppShell.tsx`; active matching must use `pathname === href || pathname.startsWith(href + "/")` so `/schedule/plans/[id]` remains highlighted:

```ts
export const NAVIGATION = [
  { module: "个人中心", roles: ["employee", "manager", "admin"], items: [
    { href: "/dashboard", label: "首页", roles: ["employee", "manager", "admin"] },
    { href: "/my-schedule", label: "我的班表", roles: ["employee"] },
    { href: "/attendance", label: "Web 打卡", roles: ["employee"] },
    { href: "/leave", label: "我的申请", roles: ["employee"] },
  ] },
  { module: "劳动力管理", roles: ["manager", "admin"], items: [
    { href: "/clock-code", label: "动态码", roles: ["manager"] },
    { href: "/store/basic", label: "门店基础", roles: ["manager", "admin"] },
    { href: "/store/v2s", label: "V2S", roles: ["manager", "admin"] },
    { href: "/store/work-areas", label: "工作区域", roles: ["manager", "admin"] },
    { href: "/store/work-groups", label: "工作组", roles: ["manager", "admin"] },
    { href: "/store/employees", label: "员工", roles: ["manager", "admin"] },
    { href: "/store/events", label: "活动日历", roles: ["manager", "admin"] },
    { href: "/store/staffing", label: "最低人力", roles: ["manager", "admin"] },
    { href: "/schedule/plans", label: "排班计划", roles: ["manager", "admin"] },
    { href: "/approvals", label: "审批中心", roles: ["manager", "admin"] },
    { href: "/attendance/punches", label: "打卡记录", roles: ["manager", "admin"] },
    { href: "/attendance/daily", label: "日异常", roles: ["manager", "admin"] },
    { href: "/attendance/monthly", label: "月汇总", roles: ["manager", "admin"] },
  ] },
  { module: "报表中心", roles: ["manager", "admin"], items: [
    { href: "/reports/monthly", label: "工时报表", roles: ["manager", "admin"] },
    { href: "/reports/scheduling", label: "排班报表", roles: ["manager", "admin"] },
  ] },
  { module: "系统管理", roles: ["admin"], items: [
    { href: "/admin/demand", label: "全局参数", roles: ["admin"] },
  ] },
] as const;
```

`DesktopWidthGuard` must render children inside `<div data-testid="desktop-shell" style={{ minWidth: 1280 }}>` and render a fixed full-screen message “请使用宽屏浏览器访问（最低 1280px）” when `matchMedia("(max-width: 1279px)").matches` is true. Set CSS variables exactly to the approved colors; use 48px top bar, 208px left menu, 16px content padding, 13px body, 12px tables, 32px controls, table row height 36px, and radius no greater than 4px except tags/shift blocks.

`src/app/(app)/layout.tsx` loads the current store name on the server and passes `AppShellUser`; `AppShell` renders store, user, role, message entry and logout in the top-right area and retains the existing `AssistantWidget`. `src/app/api/dashboard/route.ts` calls `getDashboardSummary()` after role/store resolution; the dashboard client renders real pending-leave/draft-plan counts and explicit “待该模块完成计算” states for schedule gaps and attendance exceptions until Tasks 4 and 7 wire those sources.

```ts
// src/lib/contracts/dashboard.ts
export type DashboardSummary = {
  store: { id: string; name: string } | null;
  pendingApprovals: number;
  draftPlans: number;
  scheduleGapCount: number | null;
  attendanceExceptionCount: number | null;
};
```

Keep `src/components/Shell.tsx` and `src/components/ui.tsx` as compatibility re-exports during migration:

```ts
// src/components/Shell.tsx
export { default } from "./enterprise/AppShell";
```

- [ ] **Step 6: Run GREEN and regression checks**

Run: `npx vitest run src/lib/authorization.test.ts src/components/enterprise/AppShell.test.tsx`

Expected: 2 test files PASS; manager cross-store access is rejected and desktop navigation renders without DOM.

Run: `npx tsc --noEmit && npm run build`

Expected: both commands exit 0; Next.js route build completes without client/server import violations.

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only Task 1 files are modified/untracked.

- [ ] **Step 7: Commit Task 1**

```bash
git add .gitignore .eslintrc.json package.json package-lock.json vitest.config.ts vitest.integration.config.ts vitest.setup.ts playwright.config.ts tests/helpers/test-db.ts src/lib/contracts/api.ts src/lib/contracts/dashboard.ts src/lib/authorization.ts src/lib/authorization.test.ts src/lib/api.ts src/lib/client.ts src/components/enterprise src/components/Shell.tsx src/components/ui.tsx src/features/dashboard src/app/api/dashboard src/app/globals.css 'src/app/(app)/layout.tsx' 'src/app/(app)/dashboard/page.tsx'
git commit -m "test: establish desktop WFM foundation"
```

---

### Task 2: 门店基础、营业日、V2S、最低人力与活动日历闭环

**Files:**
- Create: `src/lib/contracts/store.ts`
- Create: `src/features/store/server/store-service.ts`
- Create: `src/features/store/components/StoreBasicPage.tsx`
- Create: `src/features/store/components/V2SPage.tsx`
- Create: `src/features/store/components/StaffingPage.tsx`
- Create: `src/features/store/components/EventsPage.tsx`
- Create: `src/features/store/components/StoreConfigPages.test.tsx`
- Create: `src/app/api/store/basic/route.ts`
- Create: `src/app/api/store/options/route.ts`
- Create: `src/app/api/store/operating-days/route.ts`
- Create: `src/app/api/store/v2s/route.ts`
- Create: `src/app/api/store/events/route.ts`
- Create: `src/app/(app)/store/basic/page.tsx`
- Create: `src/app/(app)/store/v2s/page.tsx`
- Create: `src/app/(app)/store/staffing/page.tsx`
- Create: `src/app/(app)/store/events/page.tsx`
- Create: `tests/integration/store-config.test.ts`
- Modify: `prisma/schema.prisma`
- Modify: `prisma/schema.postgres.prisma`
- Modify: `prisma/seed.ts`
- Modify: `src/app/api/demand/route.ts`
- Test: `src/features/store/components/StoreConfigPages.test.tsx`
- Test: `tests/integration/store-config.test.ts`

**Interfaces:**
- Consumes: `requireStoreAccess(["manager", "admin"], requestedStoreId)` and `StoreScope` from Task 1; `SHIFTS`, `POSITIONS` from `src/lib/config.ts`; existing `V2SConfig`, `MinStaffingConfig`, `StoreEvent`.
- Produces: `StoreBasicInput = { storeId?: string; name: string; code: string; address: string | null; active: boolean }`.
- Produces: `StoreOption = { id: string; name: string; code: string; active: boolean }`; manager receives only the session store, admin receives all stores, employee is rejected.
- Produces: `OperatingDayInput = { dayOfWeek: 0|1|2|3|4|5|6; isOpen: boolean; openTime: string; closeTime: string }`; `updateOperatingDaysSchema` requires exactly seven unique days.
- Produces: `V2SRow = { dayOfWeek: number; v2sLower: number; v2sUpper: number }`; `StaffingRow = { dayOfWeek: number; timeSlot: Shift; position: Position; minHeadcount: number }`; `StoreEventInput = { date: string; label: "promo"|"new_arrival"|"holiday"; factor: number }`.
- Produces APIs: `GET /api/store/options`, `GET/PUT /api/store/basic`, `GET/PUT /api/store/operating-days`, `GET/PUT /api/store/v2s`, `GET/PUT /api/demand`, `GET/POST/DELETE /api/store/events`.

- [ ] **Step 1: Write RED schema, authorization and component tests**

```ts
// tests/integration/store-config.test.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetTestDb } from "../helpers/test-db";
import { replaceOperatingDays } from "@/features/store/server/store-service";

describe("store configuration", () => {
  beforeEach(resetTestDb);
  afterAll(() => prisma.$disconnect());

  it("atomically stores seven operating days for one store", async () => {
    const store = await prisma.store.create({ data: { name: "望京旗舰店", code: "WJ" } });
    const days = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      isOpen: dayOfWeek !== 0,
      openTime: "09:00",
      closeTime: "21:00",
    }));
    await replaceOperatingDays({ user: { id: "a", name: "A", role: "admin", storeId: null, phone: "1" }, storeId: store.id }, days);
    expect(await prisma.storeOperatingDay.count({ where: { storeId: store.id } })).toBe(7);
  });
});
```

```tsx
// src/features/store/components/StoreConfigPages.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import V2SPage from "./V2SPage";

it("batches edited V2S rows and preserves untouched values", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<V2SPage sessionStoreId="store-a" readOnly={false} initialRows={[{ dayOfWeek: 1, v2sLower: 30, v2sUpper: 60 }]} onSave={save} />);
  await userEvent.clear(screen.getByLabelText("周一 V2S 下限"));
  await userEvent.type(screen.getByLabelText("周一 V2S 下限"), "35");
  await userEvent.click(screen.getByRole("button", { name: "批量保存" }));
  expect(save).toHaveBeenCalledWith([{ dayOfWeek: 1, v2sLower: 35, v2sUpper: 60 }]);
});
```

- [ ] **Step 2: Run the tests to verify RED**

Run: `npm run test:integration -- tests/integration/store-config.test.ts`

Expected: FAIL because `Store.code`, `StoreOperatingDay` and `store-service.ts` do not exist.

Run: `npx vitest run src/features/store/components/StoreConfigPages.test.tsx`

Expected: FAIL because `V2SPage.tsx` does not exist.

- [ ] **Step 3: Add the synchronized Prisma fields/models and seed data**

Apply the same block to both schema files, preserving only their datasource-provider difference:

```prisma
model Store {
  id                 String              @id @default(cuid())
  name               String
  code               String              @unique
  address            String?
  active             Boolean             @default(true)
  operatingDays      StoreOperatingDay[]
  users              User[]
  attendance         AttendanceRecord[]
  schedules          Schedule[]
  schedulePlans      SchedulePlan[]
  v2sConfigs         V2SConfig[]
  minStaffingConfigs MinStaffingConfig[]
  events             StoreEvent[]
  trafficRecords     TrafficRecord[]
  createdAt          DateTime            @default(now())
}

model StoreOperatingDay {
  id         String  @id @default(cuid())
  storeId    String
  store      Store   @relation(fields: [storeId], references: [id], onDelete: Cascade)
  dayOfWeek  Int
  isOpen     Boolean @default(true)
  openTime   String
  closeTime  String

  @@unique([storeId, dayOfWeek])
  @@index([storeId])
}
```

Update `prisma/seed.ts` deletion order so `storeOperatingDay.deleteMany()` runs before `store.deleteMany()`. Seed each store with code/address/active, seven operating days, the existing seven V2S rows, 42 staffing rows and deterministic events.

- [ ] **Step 4: Implement the minimal shared contracts and transaction services**

```ts
// src/lib/contracts/store.ts
import { z } from "zod";
import { POSITIONS, SHIFTS } from "@/lib/config";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const operatingDaySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isOpen: z.boolean(),
  openTime: hhmm,
  closeTime: hhmm,
}).superRefine((value, ctx) => {
  if (value.isOpen && value.openTime >= value.closeTime)
    ctx.addIssue({ code: "custom", path: ["closeTime"], message: "结束时间必须晚于开始时间" });
});

export const updateOperatingDaysSchema = z.object({
  storeId: z.string().optional(),
  days: z.array(operatingDaySchema).length(7),
}).superRefine((value, ctx) => {
  if (new Set(value.days.map((day) => day.dayOfWeek)).size !== 7)
    ctx.addIssue({ code: "custom", path: ["days"], message: "星期必须覆盖 0 到 6 且不得重复" });
});

export const v2sRowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  v2sLower: z.number().positive(),
  v2sUpper: z.number().positive(),
}).refine((row) => row.v2sLower <= row.v2sUpper, { message: "V2S 下限不得大于上限" });

export const staffingRowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  timeSlot: z.enum(SHIFTS),
  position: z.enum(POSITIONS),
  minHeadcount: z.number().int().min(0),
});

export type OperatingDayInput = z.infer<typeof operatingDaySchema>;
export type V2SRow = z.infer<typeof v2sRowSchema>;
export type StaffingRow = z.infer<typeof staffingRowSchema>;
```

```ts
// src/features/store/server/store-service.ts
import { prisma } from "@/lib/db";
import type { StoreScope } from "@/lib/authorization";
import type { OperatingDayInput } from "@/lib/contracts/store";

export async function replaceOperatingDays(scope: StoreScope, days: OperatingDayInput[]) {
  return prisma.$transaction(async (tx) => {
    await tx.storeOperatingDay.deleteMany({ where: { storeId: scope.storeId } });
    await tx.storeOperatingDay.createMany({
      data: days.map((day) => ({ ...day, storeId: scope.storeId })),
    });
    return tx.storeOperatingDay.findMany({ where: { storeId: scope.storeId }, orderBy: { dayOfWeek: "asc" } });
  });
}
```

All route handlers must parse `storeId` from query/body, call `requireStoreAccess`, validate with the shared Zod schema, and pass only `scope.storeId` into Prisma. `/api/store/options` uses role to return the permitted selector options before a scoped resource call. `src/app/api/demand/route.ts` must remove its current manager-visible all-store list: manager may batch-save their own store, while admin may explicitly choose a store because this route remains the existing demand/global-parameter administration boundary. Other store configuration writes are manager-only; admin access is read-only.

- [ ] **Step 5: Implement the four dense desktop pages**

Each App Router page performs `requireSession(["manager", "admin"])` and renders one feature component. Each component uses `QueryBar → ActionToolbar → EnterpriseTable/MonthCalendar`, 32px controls and dialogs for edits. `V2SPage` and `StaffingPage` keep a dirty-row map and send one `PUT`; `EventsPage` toggles the selected label on a month date and shows a read-only year view; `StoreBasicPage` edits name/code/address/status and seven operating-day rows, while shift times remain read-only labels from `SHIFT_LABELS`.

Use this exact server-page boundary for each of the four routes, changing only the imported feature component:

```tsx
// src/app/(app)/store/v2s/page.tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import V2SPage from "@/features/store/components/V2SPage";

export default async function Page() {
  const user = await getSession();
  if (!user) redirect("/");
  if (user.role === "employee") redirect("/dashboard");
  return <V2SPage sessionStoreId={user.storeId} readOnly={user.role === "admin"} />;
}
```

- [ ] **Step 6: Run GREEN and regression checks**

Run: `npm run db:generate && npm run test:integration -- tests/integration/store-config.test.ts`

Expected: Prisma generation succeeds and the SQLite transaction/unique-key test PASS.

Run: `npx vitest run src/features/store/components/StoreConfigPages.test.tsx && npx tsc --noEmit`

Expected: component test PASS and TypeScript exits 0.

Run: `diff -u prisma/schema.prisma prisma/schema.postgres.prisma | sed -n '1,40p'`

Expected: the only diff is `provider = "sqlite"` versus `provider = "postgresql"`.

Run: `npm run build && git diff --check`

Expected: build exits 0 and no whitespace errors are reported.

- [ ] **Step 7: Commit Task 2**

```bash
git add prisma/schema.prisma prisma/schema.postgres.prisma prisma/seed.ts src/lib/contracts/store.ts src/features/store src/app/api/store src/app/api/demand/route.ts 'src/app/(app)/store' tests/integration/store-config.test.ts
git commit -m "feat: close store configuration workflows"
```

---

### Task 3: 工作区域、工作组、成员有效期与员工标签闭环

**Files:**
- Create: `src/lib/contracts/workforce.ts`
- Create: `src/features/store/server/workforce-service.ts`
- Create: `src/features/store/server/membership-overlap.ts`
- Create: `src/features/store/server/membership-overlap.test.ts`
- Create: `src/features/store/components/WorkAreasPage.tsx`
- Create: `src/features/store/components/WorkGroupsPage.tsx`
- Create: `src/features/store/components/EmployeesPage.tsx`
- Create: `src/features/store/components/WorkforcePages.test.tsx`
- Create: `src/app/api/store/work-areas/route.ts`
- Create: `src/app/api/store/work-groups/route.ts`
- Create: `src/app/api/store/work-groups/members/route.ts`
- Create: `src/app/api/store/employees/route.ts`
- Create: `src/app/(app)/store/work-areas/page.tsx`
- Create: `src/app/(app)/store/work-groups/page.tsx`
- Create: `src/app/(app)/store/employees/page.tsx`
- Create: `tests/integration/workforce.test.ts`
- Modify: `prisma/schema.prisma`
- Modify: `prisma/schema.postgres.prisma`
- Modify: `prisma/seed.ts`
- Test: `src/features/store/server/membership-overlap.test.ts`
- Test: `src/features/store/components/WorkforcePages.test.tsx`
- Test: `tests/integration/workforce.test.ts`

**Interfaces:**
- Consumes: `StoreScope`, `requireStoreAccess`, `EnterpriseTable`, `Dialog`, `Drawer`, `StatusTag` from Tasks 1–2.
- Produces: `WorkAreaInput = { id?: string; storeId?: string; name: string; code: string; active: boolean }`.
- Produces: `WorkGroupInput = { id?: string; storeId?: string; name: string; leaderId: string; volumeType: "traffic"|"delivery"; active: boolean }`.
- Produces: `WorkGroupMemberInput = { workGroupId: string; userId: string; workAreaId: string; effectiveFrom: string; effectiveTo: string | null }`.
- Produces: `dateRangesOverlap(aFrom: Date, aTo: Date | null, bFrom: Date, bTo: Date | null): boolean`.
- Produces APIs: `GET/POST/PUT/DELETE /api/store/work-areas`, `GET/POST/PUT/DELETE /api/store/work-groups`, `POST/DELETE /api/store/work-groups/members`, `GET/PUT /api/store/employees`.

- [ ] **Step 1: Write RED overlap, cross-store and component tests**

```ts
// src/features/store/server/membership-overlap.test.ts
import { describe, expect, it } from "vitest";
import { dateRangesOverlap } from "./membership-overlap";

describe("dateRangesOverlap", () => {
  it("treats an open end date as infinity", () => {
    expect(dateRangesOverlap(new Date("2026-07-01"), null, new Date("2026-08-01"), new Date("2026-08-31"))).toBe(true);
  });

  it("accepts two ranges separated by one day", () => {
    expect(dateRangesOverlap(new Date("2026-07-01"), new Date("2026-07-31"), new Date("2026-08-01"), null)).toBe(false);
  });
});
```

```ts
// tests/integration/workforce.test.ts
import { beforeEach, expect, it } from "vitest";
import { prisma, resetTestDb } from "../helpers/test-db";
import { addWorkGroupMember } from "@/features/store/server/workforce-service";

beforeEach(resetTestDb);

it("rejects a member from another store and overlapping membership", async () => {
  const a = await prisma.store.create({ data: { name: "A", code: "A" } });
  const b = await prisma.store.create({ data: { name: "B", code: "B" } });
  const leader = await prisma.user.create({ data: { phone: "1", name: "经理", role: "manager", storeId: a.id } });
  const outsider = await prisma.user.create({ data: { phone: "2", name: "外店员工", role: "employee", storeId: b.id } });
  const area = await prisma.workArea.create({ data: { storeId: a.id, name: "卖场", code: "FLOOR" } });
  const group = await prisma.workGroup.create({ data: { storeId: a.id, name: "销售组", leaderId: leader.id, volumeType: "traffic" } });
  const scope = { user: { id: leader.id, name: leader.name, role: "manager" as const, storeId: a.id, phone: leader.phone }, storeId: a.id };
  await expect(addWorkGroupMember(scope, {
    workGroupId: group.id,
    userId: outsider.id,
    workAreaId: area.id,
    effectiveFrom: "2026-07-01",
    effectiveTo: null,
  })).rejects.toThrow("员工、区域和工作组必须属于同一门店");
});
```

- [ ] **Step 2: Run the tests to verify RED**

Run: `npx vitest run src/features/store/server/membership-overlap.test.ts`

Expected: FAIL because `membership-overlap.ts` does not exist.

Run: `npm run test:integration -- tests/integration/workforce.test.ts`

Expected: FAIL because Prisma does not expose `workArea` or `workGroup`.

- [ ] **Step 3: Add synchronized workforce models and deterministic seed records**

Add the same relations and models to both schema files:

```prisma
model WorkArea {
  id        String            @id @default(cuid())
  storeId   String
  store     Store             @relation(fields: [storeId], references: [id], onDelete: Cascade)
  name      String
  code      String
  active    Boolean           @default(true)
  members   WorkGroupMember[]

  @@unique([storeId, code])
  @@index([storeId])
}

model WorkGroup {
  id         String            @id @default(cuid())
  storeId    String
  store      Store             @relation(fields: [storeId], references: [id], onDelete: Cascade)
  name       String
  leaderId   String
  leader     User              @relation("WorkGroupLeader", fields: [leaderId], references: [id])
  volumeType String            // traffic | delivery
  active     Boolean           @default(true)
  members    WorkGroupMember[]

  @@unique([storeId, name])
  @@index([storeId])
  @@index([leaderId])
}

model WorkGroupMember {
  id            String    @id @default(cuid())
  workGroupId   String
  workGroup     WorkGroup @relation(fields: [workGroupId], references: [id], onDelete: Cascade)
  userId        String
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  workAreaId    String
  workArea      WorkArea  @relation(fields: [workAreaId], references: [id])
  effectiveFrom DateTime
  effectiveTo   DateTime?

  @@index([workGroupId, userId])
  @@index([userId, effectiveFrom])
}
```

Add `workAreas WorkArea[]` and `workGroups WorkGroup[]` to `Store`; add `ledWorkGroups WorkGroup[] @relation("WorkGroupLeader")` and `workGroupMemberships WorkGroupMember[]` to `User`. Seed one traffic group and one delivery group per store, two active work areas per store, and non-overlapping member periods for employees; managers are leaders only and never members.

- [ ] **Step 4: Implement the minimal validation and workforce service**

```ts
// src/features/store/server/membership-overlap.ts
const MAX_DATE = new Date("9999-12-31T23:59:59.999Z");

export function dateRangesOverlap(
  aFrom: Date,
  aTo: Date | null,
  bFrom: Date,
  bTo: Date | null
): boolean {
  return aFrom <= (bTo ?? MAX_DATE) && bFrom <= (aTo ?? MAX_DATE);
}
```

```ts
// src/lib/contracts/workforce.ts
import { z } from "zod";

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const workGroupMemberSchema = z.object({
  workGroupId: z.string().min(1),
  userId: z.string().min(1),
  workAreaId: z.string().min(1),
  effectiveFrom: localDate,
  effectiveTo: localDate.nullable(),
}).refine((value) => !value.effectiveTo || value.effectiveFrom <= value.effectiveTo, {
  path: ["effectiveTo"],
  message: "结束日期不得早于生效日期",
});

export type WorkGroupMemberInput = z.infer<typeof workGroupMemberSchema>;
```

`addWorkGroupMember(scope, input)` must load group/area/user in one `Promise.all`, reject any `storeId !== scope.storeId`, reject `user.role !== "employee"`, query existing rows with the same `workGroupId + userId`, call `dateRangesOverlap` for every row, and create only when no overlap exists. Delete routes must first load the record with its parent store before deletion. Work area/group deactivation must return 409 when an active membership would be orphaned.

Workforce GET routes accept manager/admin scope; POST/PUT/DELETE routes require `requireStoreAccess(["manager"], requestedStoreId)` so admin remains a cross-store viewer rather than a substitute store manager.

- [ ] **Step 5: Implement the three desktop pages and employee tag updates**

`WorkAreasPage` provides query, create/edit dialog, enable/disable and a drawer listing linked employees. `WorkGroupsPage` provides group CRUD, leader, volume type and member-period dialog. `EmployeesPage` edits only employee fields already present on `User` (`position`, `employmentType`, `maxWeeklyHours`, `salesAbility`, `performanceBand`, `hireDate`) and shows derived new/experienced status plus effective area/group; it must never render manager/admin as schedulable rows. All mutations refresh current query state without full navigation.

```ts
// props shared by the three workforce page clients
export type WorkforcePageContext = {
  storeId: string;
  readOnly: boolean;
  onRefresh: () => Promise<void>;
};

export type EffectiveMembershipRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  workAreaName: string;
  workGroupName: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};
```

- [ ] **Step 6: Run GREEN and regression checks**

Run: `npm run db:generate && npx vitest run src/features/store/server/membership-overlap.test.ts src/features/store/components/WorkforcePages.test.tsx`

Expected: overlap and RTL files PASS.

Run: `npm run test:integration -- tests/integration/workforce.test.ts`

Expected: cross-store member creation is rejected, overlapping periods return 409 at route level, and valid adjacent periods persist.

Run: `npx tsc --noEmit && npm run build`

Expected: both commands exit 0.

Run: `diff -u prisma/schema.prisma prisma/schema.postgres.prisma | sed -n '1,40p'`

Expected: only the datasource provider differs.

- [ ] **Step 7: Commit Task 3**

```bash
git add prisma/schema.prisma prisma/schema.postgres.prisma prisma/seed.ts src/lib/contracts/workforce.ts src/features/store/server/workforce-service.ts src/features/store/server/membership-overlap.ts src/features/store/server/membership-overlap.test.ts src/features/store/components/WorkAreasPage.tsx src/features/store/components/WorkGroupsPage.tsx src/features/store/components/EmployeesPage.tsx src/features/store/components/WorkforcePages.test.tsx src/app/api/store/work-areas src/app/api/store/work-groups src/app/api/store/employees 'src/app/(app)/store/work-areas' 'src/app/(app)/store/work-groups' 'src/app/(app)/store/employees' tests/integration/workforce.test.ts
git commit -m "feat: add store work areas and groups"
```

---

### Task 4: 排班计划列表、四步向导与 OR-Tools 工作制/岗位约束

**Files:**
- Create: `src/lib/contracts/scheduling.ts`
- Create: `src/features/scheduling/server/plan-service.ts`
- Create: `src/features/scheduling/server/plan-service.test.ts`
- Create: `src/features/scheduling/components/SchedulePlansPage.tsx`
- Create: `src/features/scheduling/components/ScheduleWizardPage.tsx`
- Create: `src/features/scheduling/components/PrepareStep.tsx`
- Create: `src/features/scheduling/components/ForecastStep.tsx`
- Create: `src/features/scheduling/components/StaffingStep.tsx`
- Create: `src/features/scheduling/components/GenerateStep.tsx`
- Create: `src/features/scheduling/components/ScheduleWizardPage.test.tsx`
- Create: `src/app/api/schedule/plans/route.ts`
- Create: `src/app/(app)/schedule/plans/page.tsx`
- Create: `src/app/(app)/schedule/plans/[id]/page.tsx`
- Create: `tests/integration/schedule-plans.test.ts`
- Modify: `prisma/schema.prisma`
- Modify: `prisma/schema.postgres.prisma`
- Modify: `prisma/seed.ts`
- Modify: `src/lib/scheduleEngine.ts`
- Modify: `src/lib/scheduleBuild.ts`
- Modify: `src/lib/forecast.ts`
- Modify: `src/features/dashboard/server/dashboard-service.ts`
- Modify: `src/app/api/schedule/plan/route.ts`
- Modify: `src/app/api/schedule/forecast/route.ts`
- Modify: `src/app/api/schedule/generate/route.ts`
- Modify: `src/app/api/schedule/unavailable/route.ts`
- Modify: `src/app/(app)/schedule/page.tsx`
- Modify: `schedule-engine/main.py`
- Modify: `schedule-engine/solver.py`
- Modify: `schedule-engine/test_solver.py`
- Delete after route acceptance: `src/app/(app)/schedule/Step1Prepare.tsx`
- Delete after route acceptance: `src/app/(app)/schedule/Step2Forecast.tsx`
- Delete after route acceptance: `src/app/(app)/schedule/Step3Staffing.tsx`
- Test: `src/features/scheduling/server/plan-service.test.ts`
- Test: `src/features/scheduling/components/ScheduleWizardPage.test.tsx`
- Test: `tests/integration/schedule-plans.test.ts`
- Test: `schedule-engine/test_solver.py`

**Interfaces:**
- Consumes: `StoreOperatingDay`, `V2SConfig`, `MinStaffingConfig`, `StoreEvent`, `WorkGroupMember`; `getForecastDetail()`, `getStaffing()`, `buildEmployeesWithUnavailable()`; `getLLM()` and existing schedule prompts.
- Produces: `WorkMode = "work5rest2" | "work6rest1"`; re-exports the existing `Shift = "morning" | "afternoon" | "evening"` from `src/lib/config.ts`.
- Produces: `ScheduleAssignment = { userId: string; date: string; shiftType: Shift }`; `SchedulePlanSummary = { id: string; storeId: string; weekOf: string; mode: WorkMode; status: "draft"|"recommended"|"published"; version: number; publishedAt: string | null }`.
- Produces: `SchedulePlanDetail = SchedulePlanSummary & { days: string[]; operatingDays: OperatingDayInput[]; employees: WizardEmployee[]; unavailable: UnavailableSlotDto[] }`.
- Produces APIs: `GET/POST /api/schedule/plans`; compatible `GET/POST /api/schedule/plan` accepting `id` or `weekOf`; compatible `GET/POST /api/schedule/forecast` accepting `planId`; compatible `POST /api/schedule/generate` accepting `planId` and `instruction`.
- Produces engine fields: `EngineEmployee.position: Position`; `SolveRequest.work_mode: WorkMode`; `SolveRequest.position_demand: Record<string, Record<Shift, Record<Position, number>>>`.

- [ ] **Step 1: Write RED plan, wizard and solver tests**

```ts
// src/features/scheduling/server/plan-service.test.ts
import { describe, expect, it } from "vitest";
import { normalizePlanWeek } from "./plan-service";

describe("normalizePlanWeek", () => {
  it("accepts only a Monday", () => {
    expect(normalizePlanWeek("2026-07-20")).toBe("2026-07-20");
    expect(() => normalizePlanWeek("2026-07-21")).toThrow("排班计划必须从周一开始");
  });
});
```

```py
# append to schedule-engine/test_solver.py
def test_work5rest2_limits_distinct_work_days():
    payload = build_payload()
    payload["days"] = [f"2026-07-{day:02d}" for day in range(20, 27)]
    payload["employees"] = [
        {"id": "e1", "name": "小王", "position": "sales", "max_weekly_hours": 40, "last_week_hours": 0}
    ]
    payload["preferences"] = []
    payload["work_mode"] = "work5rest2"
    payload["demand"] = {day: {"morning": 1, "afternoon": 0, "evening": 0} for day in payload["days"]}
    result = solve_schedule(payload)
    e1_days = {row["date"] for row in result["assignments"] if row["employee_id"] == "e1"}
    assert len(e1_days) <= 5


def test_position_demand_never_uses_sales_as_cashier():
    payload = build_payload()
    payload["demand"] = {}
    payload["employees"] = [
        {"id": "cashier", "name": "收银", "position": "cashier", "max_weekly_hours": 40},
        {"id": "sales", "name": "销售", "position": "sales", "max_weekly_hours": 40},
    ]
    payload["position_demand"] = {
        "2026-07-13": {"morning": {"cashier": 2, "sales": 0}}
    }
    result = solve_schedule(payload)
    gap = next(row for row in result["gaps"] if row["date"] == "2026-07-13" and row["shift"] == "morning")
    assert gap["position"] == "cashier"
    assert gap["shortfall"] == 1
```

```tsx
// src/features/scheduling/components/ScheduleWizardPage.test.tsx
import { render, screen } from "@testing-library/react";
import ScheduleWizardPage from "./ScheduleWizardPage";

it("locks staffing as read-only and points correction back to forecast", () => {
  render(<ScheduleWizardPage planId="p1" readOnly={false} initialData={{ plan: { id: "p1", storeId: "s1", weekOf: "2026-07-20", mode: "work5rest2", status: "draft", version: 0, publishedAt: null }, activeStep: 2 }} />);
  expect(screen.getByText("人力预测")).toBeInTheDocument();
  expect(screen.queryByRole("spinbutton", { name: /人力/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "返回业务预测调整" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run src/features/scheduling/server/plan-service.test.ts src/features/scheduling/components/ScheduleWizardPage.test.tsx`

Expected: FAIL because the scheduling feature files do not exist.

Run: `cd schedule-engine && .venv/bin/python test_solver.py`

Expected: FAIL in the two new assertions because the solver does not yet consume `work_mode`, `position` or `position_demand`.

- [ ] **Step 3: Extend both schemas for plan concurrency and recommendation state**

Apply these fields identically to `SchedulePlan` in both schemas:

```prisma
model SchedulePlan {
  id                    String            @id @default(cuid())
  storeId               String
  store                 Store             @relation(fields: [storeId], references: [id])
  weekOf                String
  mode                  String            @default("work5rest2") // work5rest2 | work6rest1
  status                String            @default("draft") // draft | recommended | published
  version               Int               @default(0)
  recommendationJson    String?
  recommendationAiLogId String?
  createdById           String
  createdBy             User              @relation(fields: [createdById], references: [id])
  schedules             Schedule[]
  forecasts             TrafficForecast[]
  aiLogs                AiInteractionLog[]
  publishedAt           DateTime?
  createdAt             DateTime          @default(now())
  updatedAt             DateTime          @updatedAt

  @@unique([storeId, weekOf])
  @@index([storeId])
}
```

Add nullable plan/store scope to `AiInteractionLog` and `aiLogs AiInteractionLog[]` to `Store` in both schemas, so reports never infer a plan week from prompt text:

```prisma
model AiInteractionLog {
  id          String        @id @default(cuid())
  userId      String?
  user        User?         @relation(fields: [userId], references: [id])
  storeId     String?
  store       Store?        @relation(fields: [storeId], references: [id])
  planId      String?
  plan        SchedulePlan? @relation(fields: [planId], references: [id])
  feature     String
  provider    String?
  model       String?
  inputText   String
  outputText  String
  wasAccepted Boolean?
  wasEdited   Boolean?
  editedCells Int?
  totalCells  Int?
  editRatio   Float?
  createdAt   DateTime      @default(now())

  @@index([feature])
  @@index([createdAt])
  @@index([storeId, planId])
}
```

Seed one draft plan in the next full week for each store. Do not seed schedules for managers or admins.

- [ ] **Step 4: Implement the minimal exact scheduling contracts and plan service**

```ts
// src/lib/contracts/scheduling.ts
import { z } from "zod";
import { POSITIONS, SHIFTS, type Position, type Shift } from "@/lib/config";

export const workModeSchema = z.enum(["work5rest2", "work6rest1"]);
export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const assignmentSchema = z.object({
  userId: z.string().min(1),
  date: localDateSchema,
  shiftType: z.enum(SHIFTS),
});
export const createPlanSchema = z.object({
  storeId: z.string().optional(),
  weekOf: localDateSchema,
  mode: workModeSchema,
});
export const generateScheduleSchema = z.object({
  planId: z.string().min(1),
  instruction: z.string().trim().max(1000).optional(),
});

export type WorkMode = z.infer<typeof workModeSchema>;
export type ScheduleAssignment = z.infer<typeof assignmentSchema>;
export type PositionDemand = Record<string, Record<Shift, Record<Position, number>>>;
export type { Position, Shift };
```

```ts
// src/features/scheduling/server/plan-service.ts
import { mondayOf } from "@/lib/dates";

export function normalizePlanWeek(weekOf: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekOf) || mondayOf(weekOf) !== weekOf)
    throw new Error("排班计划必须从周一开始");
  return weekOf;
}
```

`createPlan(scope, input)` must call `normalizePlanWeek`, reject a duplicate `storeId + weekOf` with a domain conflict mapped to HTTP 409, and create `status="draft", version=0`. `getPlanDetail(scope, id)` must include seven operating days, active employee memberships, approved leave and unavailable slots, and must compare `plan.storeId` with `scope.storeId` before returning.

Plan/list GET handlers allow manager/admin store scope. Plan create/update, forecast adjustment and generate handlers require manager role and derive the store from the manager session; admin can inspect but cannot create or mutate a store plan.

Update `/api/schedule/unavailable` so employee POST/DELETE may act only on `auth.user.id`, manager may act on an employee in the manager's store, and admin is read-only. Ignore any employee-supplied `userId` and reject deletion when the slot owner is not the employee.

- [ ] **Step 5: Extend OR-Tools without moving calculation into Node or LLM**

Add exact Pydantic fields in `schedule-engine/main.py`:

```py
class Employee(BaseModel):
    id: str
    name: Optional[str] = None
    position: str
    max_weekly_hours: Optional[float] = None
    last_week_hours: float = 0
    unavailable: List[Unavailable] = Field(default_factory=list)


class SolveRequest(BaseModel):
    week_of: str
    days: List[str]
    shifts: List[str] = ["morning", "afternoon", "evening"]
    demand: Dict[str, Dict[str, int]] = Field(default_factory=dict)
    position_demand: Dict[str, Dict[str, Dict[str, int]]] = Field(default_factory=dict)
    employees: List[Employee]
    work_mode: str = "work5rest2"
    shift_hours: float = 4
    min_rest_hours: float = 4
    max_weekly_hours: float = 40
    preferences: List[Preference] = Field(default_factory=list)
```

Add one `worked[(employee_id, date)]` boolean with `AddMaxEquality(worked, shift variables for that day)`, then constrain its weekly sum to 5 or 6 according to `work_mode`. For every nonzero `position_demand[date][shift][position]`, calculate `assigned` only from employees whose `position` matches; create a shortage variable and return gaps as `{ date, shift, position, required, shortfall }`. Keep the existing all-store demand only as a backwards-compatible fallback when `position_demand` is empty.

Update `src/lib/scheduleEngine.ts` types to match the Pydantic request exactly. Update `buildEmployeesWithUnavailable()` to select only `role="employee"`, require non-null `position`, merge `UnavailableSlot` plus approved leave, and populate `position` and each employee's own `max_weekly_hours`. Update `generate/route.ts` to load the plan by `planId + scope.storeId`, derive `position_demand` from `getStaffing()`, pass `work_mode`, write AI logs with the same `storeId` and `planId`, and atomically save the returned assignments to `SchedulePlan.recommendationJson` while setting status `recommended` and incrementing `version` with an `updateMany({ where: { id, version } })` concurrency guard.

Update `dashboard-service.ts` to sum gap rows from the current store's latest recommendation/published plan, so `scheduleGapCount` becomes a real number instead of the Task 1 unavailable state.

- [ ] **Step 6: Build the list and four-step desktop wizard**

`SchedulePlansPage` renders month calendar plus plan list and creates a plan in a dialog. `ScheduleWizardPage` stores only `activeStep`; server data remains authoritative. Step 1 saves work mode and unavailable slots while showing StoreOperatingDay values. Step 2 edits one traffic cell only when a non-empty reason is supplied. Step 3 renders `getStaffing()` output read-only. Step 4 sends natural-language preference, shows engine status/gaps/explanation and the generated grid; a 503 response keeps manual navigation enabled and shows “优化引擎不可用，可继续手动排班”. Replace `src/app/(app)/schedule/page.tsx` with `redirect("/schedule/plans")`; only after build and route tests pass, delete the three legacy step components.

```tsx
// src/app/(app)/schedule/plans/[id]/page.tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import ScheduleWizardPage from "@/features/scheduling/components/ScheduleWizardPage";

export default async function Page({ params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) redirect("/");
  if (user.role === "employee") redirect("/dashboard");
  return <ScheduleWizardPage planId={params.id} readOnly={user.role === "admin"} />;
}
```

- [ ] **Step 7: Run GREEN and regression checks**

Run: `cd schedule-engine && .venv/bin/python test_solver.py`

Expected: all solver assertions PASS; work5rest2 assigns no employee on more than five distinct days, and cashier demand is never filled by a sales employee.

Run: `npm run db:generate && npx vitest run src/features/scheduling/server/plan-service.test.ts src/features/scheduling/components/ScheduleWizardPage.test.tsx`

Expected: both test files PASS.

Run: `npm run test:integration -- tests/integration/schedule-plans.test.ts`

Expected: duplicate plan returns the domain conflict, cross-store lookup is rejected, forecast adjustment without a reason is rejected, recommendation version conflicts map to 409, employee unavailable submission is self-only, and managers cannot edit another store's employee.

Run: `npx tsc --noEmit && npm run build`

Expected: both commands exit 0; `/schedule` builds as a redirect and both `/schedule/plans` routes build.

Run: `diff -u prisma/schema.prisma prisma/schema.postgres.prisma | sed -n '1,40p'`

Expected: only datasource provider differs.

- [ ] **Step 8: Commit Task 4**

```bash
git add prisma/schema.prisma prisma/schema.postgres.prisma prisma/seed.ts src/lib/contracts/scheduling.ts src/lib/scheduleEngine.ts src/lib/scheduleBuild.ts src/lib/forecast.ts src/features/dashboard/server/dashboard-service.ts src/features/scheduling src/app/api/schedule/plans src/app/api/schedule/plan/route.ts src/app/api/schedule/forecast/route.ts src/app/api/schedule/generate/route.ts src/app/api/schedule/unavailable/route.ts 'src/app/(app)/schedule' schedule-engine/main.py schedule-engine/solver.py schedule-engine/test_solver.py tests/integration/schedule-plans.test.ts
git commit -m "feat: deliver four-step scheduling wizard"
```

---

### Task 5: 班表网格、Excel 导入、复制历史、恢复推荐与发布

**Files:**
- Create: `src/features/scheduling/server/hard-constraints.ts`
- Create: `src/features/scheduling/server/hard-constraints.test.ts`
- Create: `src/features/scheduling/server/import-parser.ts`
- Create: `src/features/scheduling/server/import-parser.test.ts`
- Create: `src/features/scheduling/server/schedule-command-service.ts`
- Create: `src/features/scheduling/components/ScheduleGrid.tsx`
- Create: `src/features/scheduling/components/ScheduleGrid.test.tsx`
- Create: `src/features/scheduling/components/ImportPanel.tsx`
- Create: `src/features/scheduling/components/ImportPanel.test.tsx`
- Create: `src/features/scheduling/components/MySchedulePage.tsx`
- Create: `src/features/scheduling/components/MySchedulePage.test.tsx`
- Create: `src/app/api/schedule/import/template/route.ts`
- Create: `src/app/api/schedule/import/validate/route.ts`
- Create: `src/app/api/schedule/import/commit/route.ts`
- Create: `src/app/api/schedule/copy-history/route.ts`
- Create: `src/app/api/schedule/publish/route.ts`
- Create: `src/app/api/schedule/restore-recommendation/route.ts`
- Create: `src/app/api/schedule/export/route.ts`
- Create: `src/app/api/schedule/mine/route.ts`
- Create: `src/app/(app)/my-schedule/page.tsx`
- Create: `tests/integration/schedule-commands.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `prisma/schema.prisma`
- Modify: `prisma/schema.postgres.prisma`
- Modify: `prisma/seed.ts`
- Modify: `src/lib/client.ts`
- Modify: `src/lib/contracts/scheduling.ts`
- Modify: `src/app/api/schedule/route.ts`
- Modify: `src/app/api/schedule/save/route.ts`
- Modify: `src/features/scheduling/components/GenerateStep.tsx`
- Test: `src/features/scheduling/server/hard-constraints.test.ts`
- Test: `src/features/scheduling/server/import-parser.test.ts`
- Test: `src/features/scheduling/components/ScheduleGrid.test.tsx`
- Test: `src/features/scheduling/components/ImportPanel.test.tsx`
- Test: `src/features/scheduling/components/MySchedulePage.test.tsx`
- Test: `tests/integration/schedule-commands.test.ts`

**Interfaces:**
- Consumes: `ScheduleAssignment`, `Shift`, `WorkMode`, plan `version`, fixed `SHIFT_TIMES`; `StoreScope`; existing `Schedule`, `LeaveRequest`, `UnavailableSlot`, `AiInteractionLog`.
- Produces: `ConstraintIssue = { code: "employee_store"|"employee_role"|"week_range"|"invalid_shift"|"leave"|"unavailable"|"rest"|"weekly_hours"|"staffing_gap"; userId?: string; date?: string; shiftType?: Shift; message: string }`.
- Produces: `validateHardConstraints(input: HardConstraintInput): ConstraintIssue[]` as a pure function used by edit/paste/import/save/publish.
- Produces: `ImportIssue = { severity: "warning"|"error"; row: number; column: string; value: string; code: string; suggestion: string }`; `ImportValidationResult = { batchId: string; importable: number; warnings: ImportIssue[]; errors: ImportIssue[] }`.
- Produces: `ScheduleCell = { userId: string; date: string; shifts: Shift[] }`; multiple shifts in one day are represented as multiple `ScheduleAssignment` rows, preserving the existing Prisma unique key `(userId, date, shiftType)` and the legal morning+evening combination when rest is at least four hours.
- Produces APIs: `GET /api/schedule/import/template`, `POST /api/schedule/import/validate`, `POST /api/schedule/import/commit`, `POST /api/schedule/copy-history`, `POST /api/schedule/publish`, `POST /api/schedule/restore-recommendation`, `GET /api/schedule/export?planId=`, `GET /api/schedule/mine?weekOf=`; compatible `GET /api/schedule?planId=` and draft-only `POST /api/schedule/save`.

- [ ] **Step 1: Write RED constraint, parser, grid and transaction tests**

```ts
// src/features/scheduling/server/hard-constraints.test.ts
import { expect, it } from "vitest";
import { validateHardConstraints } from "./hard-constraints";

it("rejects manager assignments and leave overlap", () => {
  const issues = validateHardConstraints({
    storeId: "s1",
    weekOf: "2026-07-20",
    mode: "work5rest2",
    employees: [{ id: "m1", storeId: "s1", role: "manager", maxWeeklyHours: 40 }],
    assignments: [{ userId: "m1", date: "2026-07-20", shiftType: "morning" }],
    leaves: [],
    unavailable: [],
    requiredByPosition: {},
  });
  expect(issues.map((issue) => issue.code)).toContain("employee_role");
});
```

```ts
// src/features/scheduling/server/import-parser.test.ts
import { expect, it } from "vitest";
import { parseScheduleWorksheet } from "./import-parser";

it("returns exact row, column, value and suggestion for an unknown shift", () => {
  const result = parseScheduleWorksheet([
    ["员工工号", "姓名", "岗位", "2026-07-20"],
    ["E001", "小王", "sales", "通宵班"],
  ], "2026-07-20");
  expect(result.errors).toEqual([{ severity: "error", row: 2, column: "2026-07-20", value: "通宵班", code: "invalid_shift", suggestion: "仅允许早班、午班、晚班；同日双班用 + 分隔" }]);
});
```

```tsx
// src/features/scheduling/components/ScheduleGrid.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import ScheduleGrid from "./ScheduleGrid";

it("copies and pastes only inside the same plan week and revalidates", async () => {
  const onChange = vi.fn();
  const validate = vi.fn().mockReturnValue([]);
  render(<ScheduleGrid planId="p1" weekOf="2026-07-20" employees={[{ id: "e1", name: "小王" }]} days={["2026-07-20", "2026-07-21"]} cells={[{ userId: "e1", date: "2026-07-20", shifts: ["morning"] }]} onChange={onChange} validateCell={validate} />);
  await userEvent.pointer({ target: screen.getByTestId("cell-e1-2026-07-20"), keys: "[MouseRight]" });
  await userEvent.click(screen.getByRole("menuitem", { name: "复制" }));
  await userEvent.pointer({ target: screen.getByTestId("cell-e1-2026-07-21"), keys: "[MouseRight]" });
  await userEvent.click(screen.getByRole("menuitem", { name: "粘贴" }));
  expect(validate).toHaveBeenCalledWith({ userId: "e1", date: "2026-07-21", shifts: ["morning"] });
  expect(onChange).toHaveBeenCalled();
});
```

```tsx
// src/features/scheduling/components/MySchedulePage.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import MySchedulePage from "./MySchedulePage";

it("renders only the employee's published rows and weekly hours", () => {
  render(<MySchedulePage weekOf="2026-07-20" rows={[{ date: "2026-07-20", shiftType: "morning", hours: 4 }]} totalHours={4} />);
  expect(screen.getByText("早班 09:00–13:00")).toBeInTheDocument();
  expect(screen.getByText("本周 4 小时")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run src/features/scheduling/server/hard-constraints.test.ts src/features/scheduling/server/import-parser.test.ts src/features/scheduling/components/ScheduleGrid.test.tsx`

Expected: FAIL because the three target modules do not exist.

Run: `npm run test:integration -- tests/integration/schedule-commands.test.ts`

Expected: FAIL because `ScheduleImportBatch` and the command service do not exist.

- [ ] **Step 3: Add ExcelJS and the synchronized import-batch model**

Run: `npm install exceljs`

Add this model and inverse relations to both schemas. `normalizedRowsJson` is intentionally server-owned: commit reuses the exact validated snapshot instead of trusting a second client payload.

```prisma
model ScheduleImportBatch {
  id                 String       @id @default(cuid())
  storeId            String
  store              Store        @relation(fields: [storeId], references: [id], onDelete: Cascade)
  planId             String
  plan               SchedulePlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  fileName           String
  status             String       // validated | imported | failed
  totalRows          Int
  successRows        Int
  errorRows          Int
  errorsJson         String
  normalizedRowsJson String
  createdById        String
  createdAt          DateTime     @default(now())

  @@index([storeId, planId])
  @@index([createdById])
}
```

Add `scheduleImportBatches ScheduleImportBatch[]` to `Store` and `SchedulePlan`. Update seed deletion order; do not seed a fake imported batch.

- [ ] **Step 4: Implement the minimal parser and one hard-constraint pipeline**

```ts
// src/features/scheduling/server/import-parser.ts
import type { ScheduleAssignment, Shift } from "@/lib/contracts/scheduling";

const SHIFT_BY_LABEL: Record<string, Shift> = {
  早班: "morning",
  午班: "afternoon",
  晚班: "evening",
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
};

export function parseShiftCell(value: string): Shift[] | null {
  if (!value.trim()) return [];
  const shifts = value.split("+").map((part) => SHIFT_BY_LABEL[part.trim()]);
  return shifts.every(Boolean) && new Set(shifts).size === shifts.length ? shifts : null;
}

export type ParsedImport = { assignments: ScheduleAssignment[]; errors: Array<{ severity: "error"; row: number; column: string; value: string; code: string; suggestion: string }> };
```

`parseScheduleWorksheet(rows, weekOf)` must require headers `员工工号/姓名/岗位` plus exactly the seven `weekDays(weekOf)` columns, expand each `+`-delimited cell to assignments, reject duplicate employee rows, and report the precise issue fields. `validateHardConstraints` then validates employee store/role, plan week, shift set, approved leave, unavailable slots, rest interval, work-mode distinct days, individual weekly hours and position staffing gaps. Every edit, paste, draft save, import validate and publish calls this single pure function; no route may implement a second set of constraints.

- [ ] **Step 5: Implement draft, import, copy, restore and publish transactions**

Use request contracts with both `planId` and `version`:

```ts
export const versionedPlanCommandSchema = z.object({
  planId: z.string().min(1),
  version: z.number().int().nonnegative(),
});

export const saveDraftSchema = versionedPlanCommandSchema.extend({
  assignments: z.array(assignmentSchema),
  source: z.enum(["manual", "ai_generated"]),
  aiLogId: z.string().optional(),
  parseLogId: z.string().optional(),
});
```

`saveDraft()` and `publishSchedule()` must run `prisma.$transaction`: load the scoped plan, validate constraints, use `schedulePlan.updateMany({ where: { id, storeId, version }, data: { version: { increment: 1 } } })`, return 409 when count is 0, replace only that plan's schedules, and set every `Schedule.planId`. Draft save keeps status `draft` or `recommended`; publish reruns constraints, sets status `published` and `publishedAt`, then records `wasAccepted`, `wasEdited`, `editedCells`, `totalCells`, `editRatio` in the referenced AI logs.

All Task 5 command routes require `requireStoreAccess(["manager"])`; admin may only use the Task 4/5 GET endpoints to inspect a selected store.

`validate import` parses multipart `file`, checks `.xlsx`, size at most 5 MiB, employee number/name/store, plan week, duplicates and hard constraints, then stores normalized rows and issues in one `ScheduleImportBatch(status="validated")`. `commit import` accepts `{ batchId, version }`, loads the batch by `storeId + planId`, requires zero errors and `status="validated"`, then atomically replaces the plan schedules and marks the batch imported; any exception marks it failed in a separate transaction after rollback. `copy-history` loads a published source plan in the same store and remaps its seven day offsets into the target week before validation. `restore-recommendation` parses the server-owned `recommendationJson`, validates it against current leave/unavailable/config, and returns 422 with issues if it is no longer legal.

`GET /api/schedule/export` requires manager/admin scoped read access and streams an ExcelJS workbook with employee, position, seven dates, shifts and weekly hours. `GET /api/schedule/mine` requires employee role, derives `userId/storeId` only from session, returns only schedules whose plan status is published, and never accepts another user id.

- [ ] **Step 6: Implement dense ScheduleGrid and ImportPanel interactions**

`ScheduleGrid` uses employee rows, seven date columns, sticky employee/metric rows, horizontal scroll, approved shift colors, left-click edit dialog, right-click menu with edit/copy/paste/clear, and supports multiple shift blocks in one cell. “清空排班” requires a confirmation dialog. “恢复推荐” and “发布” show server-returned constraint issues and focus `cell-${userId}-${date}`. `ImportPanel` shows template download, upload progress, three counts, issue table with row/column/value/suggestion and enables “确认导入” only when `errors.length === 0`.

```ts
export type ScheduleGridProps = {
  planId: string;
  weekOf: string;
  version: number;
  employees: Array<{ id: string; name: string; position: string }>;
  days: string[];
  cells: ScheduleCell[];
  issues: ConstraintIssue[];
  onChange: (cells: ScheduleCell[]) => void;
  validateCell: (cell: ScheduleCell) => ConstraintIssue[];
};

export type ImportPanelProps = {
  planId: string;
  version: number;
  validation: ImportValidationResult | null;
  onValidated: (result: ImportValidationResult) => void;
  onCommitted: (nextVersion: number) => void;
};
```

`MySchedulePage` uses the same fixed shift labels/colors, a week selector and a read-only weekly-hours total. The manager toolbar adds “导出班表”; exporting never changes plan state.

- [ ] **Step 7: Run GREEN and regression checks**

Run: `npm run db:generate && npx vitest run src/features/scheduling/server/hard-constraints.test.ts src/features/scheduling/server/import-parser.test.ts src/features/scheduling/components/ScheduleGrid.test.tsx src/features/scheduling/components/ImportPanel.test.tsx src/features/scheduling/components/MySchedulePage.test.tsx`

Expected: all unit/RTL tests PASS.

Run: `npm run test:integration -- tests/integration/schedule-commands.test.ts`

Expected: valid import is atomic, invalid import leaves schedules untouched, injected create failure rolls back all rows, version mismatch returns 409, cross-store batch access is rejected, publish rejects manager assignments, employee schedule returns only self/published rows, and export contains seven date columns.

Run: `npx tsc --noEmit && npm run build`

Expected: both commands exit 0 and all six new API route groups build.

Run: `diff -u prisma/schema.prisma prisma/schema.postgres.prisma | sed -n '1,40p'`

Expected: only datasource provider differs.

- [ ] **Step 8: Commit Task 5**

```bash
git add package.json package-lock.json prisma/schema.prisma prisma/schema.postgres.prisma prisma/seed.ts src/lib/client.ts src/lib/contracts/scheduling.ts src/features/scheduling src/app/api/schedule/import src/app/api/schedule/copy-history src/app/api/schedule/publish src/app/api/schedule/restore-recommendation src/app/api/schedule/export src/app/api/schedule/mine src/app/api/schedule/route.ts src/app/api/schedule/save/route.ts 'src/app/(app)/my-schedule' tests/integration/schedule-commands.test.ts
git commit -m "feat: complete schedule grid and import publishing"
```

---

### Task 6: 审批中心、批量人工决定与 AI 合规建议

**Files:**
- Create: `src/lib/contracts/approvals.ts`
- Create: `src/features/approvals/server/approval-service.ts`
- Create: `src/features/approvals/server/approval-service.test.ts`
- Create: `src/features/approvals/components/ApprovalsPage.tsx`
- Create: `src/features/approvals/components/ApprovalsPage.test.tsx`
- Create: `src/features/approvals/components/MyApplicationsPage.tsx`
- Create: `src/features/approvals/components/MyApplicationsPage.test.tsx`
- Create: `src/app/api/punch-corrections/route.ts`
- Create: `src/app/api/shift-swaps/route.ts`
- Create: `tests/integration/approvals.test.ts`
- Modify: `prisma/schema.prisma`
- Modify: `prisma/schema.postgres.prisma`
- Modify: `src/app/api/approvals/route.ts`
- Modify: `src/app/api/approvals/decide/route.ts`
- Modify: `src/app/api/approvals/ai-check/route.ts`
- Modify: `src/app/(app)/approvals/page.tsx`
- Modify: `src/app/(app)/leave/page.tsx`
- Modify: `src/app/api/leave/route.ts`
- Modify: `src/lib/prompts.ts`
- Modify: `prompts/audit_compliance.md`
- Modify: `src/features/dashboard/server/dashboard-service.ts`
- Test: `src/features/approvals/server/approval-service.test.ts`
- Test: `src/features/approvals/components/ApprovalsPage.test.tsx`
- Test: `src/features/approvals/components/MyApplicationsPage.test.tsx`
- Test: `tests/integration/approvals.test.ts`

**Interfaces:**
- Consumes: existing `LeaveRequest`, `PunchCorrection`, `ShiftSwapRequest`, `AttendanceRecord`, `Schedule`; `requireStoreAccess`; `validateHardConstraints`; `getLLM()`, `retrieveRules()`, `auditCompliancePrompt()`.
- Produces: `ApprovalType = "leave" | "punch_correction" | "shift_swap"`; `ApprovalStatus = "pending" | "approved" | "rejected"`.
- Produces: `ApprovalItem = { id: string; type: ApprovalType; storeId: string; userId: string; employeeName: string; submittedAt: string; status: ApprovalStatus; summary: string; aiSuggestion: "compliant"|"suspicious"|null; aiReason: string|null }`.
- Produces: `ApprovalDecisionInput = { storeId?: string; items: Array<{ id: string; type: ApprovalType }>; decision: "approved"|"rejected"; reason: string | null; aiLogIds: string[] }`.
- Produces: `CreatePunchCorrectionInput = { date: string; direction: "in"|"out"; requestedTime: string; reason: string }`; `CreateShiftSwapInput = { reqScheduleId: string; targetUserId: string; tgtScheduleId: string }`.
- Produces compatible APIs: `GET /api/approvals?status=pending|history&type=...&storeId=...`, `POST /api/approvals/decide`, `POST /api/approvals/ai-check`, `GET/POST /api/punch-corrections`, `GET/POST /api/shift-swaps`.

- [ ] **Step 1: Write RED batch, store-isolation and AI-advisory tests**

```ts
// src/features/approvals/server/approval-service.test.ts
import { expect, it } from "vitest";
import { normalizeDecision } from "./approval-service";

it("requires a rejection reason and deduplicates selected items", () => {
  expect(() => normalizeDecision({ items: [{ id: "a", type: "leave" }], decision: "rejected", reason: null, aiLogIds: [] })).toThrow("驳回原因不能为空");
  expect(normalizeDecision({ items: [{ id: "a", type: "leave" }, { id: "a", type: "leave" }], decision: "approved", reason: null, aiLogIds: [] }).items).toHaveLength(1);
});
```

```tsx
// src/features/approvals/components/ApprovalsPage.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import ApprovalsPage from "./ApprovalsPage";

it("never applies an AI suggestion without an explicit human click", async () => {
  const decide = vi.fn();
  const aiCheck = vi.fn().mockResolvedValue({ suggestion: "compliant", reason: "余额充足", aiLogId: "log1" });
  render(<ApprovalsPage initialItems={[{ id: "l1", type: "leave", storeId: "s1", userId: "e1", employeeName: "小王", submittedAt: "2026-07-19", status: "pending", summary: "年假 4 小时", aiSuggestion: null, aiReason: null }]} onDecide={decide} onAiCheck={aiCheck} />);
  await userEvent.click(screen.getByRole("button", { name: "AI 合规建议" }));
  expect(await screen.findByText("余额充足")).toBeInTheDocument();
  expect(decide).not.toHaveBeenCalled();
});
```

```tsx
// src/features/approvals/components/MyApplicationsPage.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import MyApplicationsPage from "./MyApplicationsPage";

it("offers leave, punch correction and shift swap without a DOM tab", () => {
  render(<MyApplicationsPage leaveRows={[]} correctionRows={[]} swapRows={[]} />);
  expect(screen.getByRole("tab", { name: "请假" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "补卡" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "换班" })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: /DOM/ })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run src/features/approvals/server/approval-service.test.ts src/features/approvals/components/ApprovalsPage.test.tsx`

Expected: FAIL because the approval feature modules do not exist.

Run: `npm run test:integration -- tests/integration/approvals.test.ts`

Expected: FAIL until the unified batch service exists.

- [ ] **Step 3: Implement the minimal scoped approval query and transaction service**

```ts
// src/lib/contracts/approvals.ts
import { z } from "zod";

export const approvalTypeSchema = z.enum(["leave", "punch_correction", "shift_swap"]);
export const approvalDecisionSchema = z.object({
  storeId: z.string().optional(),
  items: z.array(z.object({ id: z.string().min(1), type: approvalTypeSchema })).min(1),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().max(500).nullable(),
  aiLogIds: z.array(z.string()),
}).superRefine((value, ctx) => {
  if (value.decision === "rejected" && !value.reason)
    ctx.addIssue({ code: "custom", path: ["reason"], message: "驳回原因不能为空" });
});
```

`listApprovals(scope, query)` must build the employee id set from `scope.storeId`, query all three models, normalize them to `ApprovalItem`, and never accept a client-supplied user id as an authorization filter. `decideApprovals(scope, input)` must run one transaction, load every record and related user/schedule, verify every record belongs to `scope.storeId` and is pending, then use conditional `updateMany` transitions; if any count is zero, throw a 409 and roll back the entire batch.

Approval GET allows manager/admin scoped viewing. AI-check and decide routes require `requireStoreAccess(["manager"])`; admin can inspect records and existing suggestions but cannot make or solicit a daily store decision.

Only `LeaveRequest.status="pending"`, `PunchCorrection.status="pending"` and `ShiftSwapRequest.status="pending_manager"` are actionable. A swap still at `pending_target` remains outside the manager queue and a decision request for it returns 409.

Add `aiSuggestion String?` and `aiReason String?` to `PunchCorrection` in both Prisma schemas so all three approval types retain an AI advisory after refresh. Keep existing `LeaveRequest.aiComplianceSuggestion/aiComplianceReason` and `ShiftSwapRequest.aiSuggestion/aiReason` names; normalize them only at the `ApprovalItem` output boundary.

Generalize `auditCompliancePrompt` to the exact signature `auditCompliancePrompt({ ruleChunks: string, approvalType: ApprovalType, approvalDetail: string }): string`; update `prompts/audit_compliance.md` to refer to “审批单” rather than only leave, while preserving the five-section prompt format and the `{ suggestion, reason }` output. All three approval types continue to call `getLLM()` and never make a decision from model output.

Update `dashboard-service.ts` so `pendingApprovals` counts actionable leave, punch-correction and manager-stage swap rows for the current store.

For approved leave, decrement the correct balance once and reject negative balance. For approved punch correction, create one `AttendanceRecord` with `direction`, `requestedTime`, `viaCode=false`, `corrected=true`. For approved swap, call `validateHardConstraints` on the resulting plan before swapping the two schedules. AI log feedback is written after successful transaction; the AI route only updates suggestion fields and returns text, never calls the decision service.

Update `src/app/api/leave/route.ts` so only employee can submit for self; manager proxy submissions required by the daily-exception flow are introduced through a scoped server service in Task 7, not by trusting a `userId` on the employee endpoint.

Implement employee-owned application routes with these exact schemas; both derive requester/user/store from session and reject manager/admin self-submission:

```ts
export const createPunchCorrectionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  direction: z.enum(["in", "out"]),
  requestedTime: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(1).max(500),
});

export const createShiftSwapSchema = z.object({
  reqScheduleId: z.string().min(1),
  targetUserId: z.string().min(1),
  tgtScheduleId: z.string().min(1),
});
```

Punch correction requires the requested timestamp to fall on `date`. Shift swap loads two published schedules from the same store/week, requires requester ownership and matching positions, calls `validateHardConstraints` for the proposed exchange, then creates status `pending_target`; it becomes `pending_manager` only after the target employee accepts through the same route. `MyApplicationsPage` replaces the current leave-only client with leave, correction and swap tabs while preserving `/leave` as the route.

- [ ] **Step 4: Implement the dense approval page**

Use pending/history tabs, type/date/employee query controls, row selection, batch pass/reject buttons, a rejection dialog, a detail drawer and per-row AI suggestion. Buttons use `useAsyncAction`; disable selection when status is not pending. There is no DOM type, tab, route, label or API branch. A 409 refreshes the list and shows “单据状态已变化，请核对后重试”.

```ts
export type ApprovalsPageProps = {
  initialItems: ApprovalItem[];
  onAiCheck: (item: ApprovalItem) => Promise<{ suggestion: "compliant" | "suspicious"; reason: string; aiLogId: string }>;
  onDecide: (input: ApprovalDecisionInput) => Promise<void>;
};

export const APPROVAL_TABS = [
  { key: "pending", label: "待审批" },
  { key: "history", label: "审批记录" },
] as const;
```

- [ ] **Step 5: Run GREEN and regression checks**

Run: `npx vitest run src/features/approvals/server/approval-service.test.ts src/features/approvals/components/ApprovalsPage.test.tsx src/features/approvals/components/MyApplicationsPage.test.tsx`

Expected: both test files PASS; AI suggestion does not trigger a decision.

Run: `npm run test:integration -- tests/integration/approvals.test.ts`

Expected: mixed batch commit is atomic, concurrent repeat returns 409 without double balance decrement, cross-store ids roll back the whole batch, employee submissions cannot target another user/store, target acceptance is required before manager queueing, punch approval creates one corrected record, and invalid shift swap is rejected.

Run: `npx tsc --noEmit && npm run build`

Expected: both commands exit 0.

Run: `diff -u prisma/schema.prisma prisma/schema.postgres.prisma | sed -n '1,40p'`

Expected: only datasource provider differs.

- [ ] **Step 6: Commit Task 6**

```bash
git add prisma/schema.prisma prisma/schema.postgres.prisma src/lib/contracts/approvals.ts src/lib/prompts.ts prompts/audit_compliance.md src/features/dashboard/server/dashboard-service.ts src/features/approvals src/app/api/approvals src/app/api/leave/route.ts src/app/api/punch-corrections src/app/api/shift-swaps 'src/app/(app)/approvals/page.tsx' 'src/app/(app)/leave/page.tsx' tests/integration/approvals.test.ts
git commit -m "feat: unify scoped attendance and leave approvals"
```

---

### Task 7: 动态码 Web 打卡、打卡记录与日考勤异常闭环

**Files:**
- Create: `src/lib/contracts/attendance.ts`
- Create: `src/features/attendance/server/clock-code.ts`
- Create: `src/features/attendance/server/clock-code.test.ts`
- Create: `src/features/attendance/server/calculate-daily-attendance.ts`
- Create: `src/features/attendance/server/calculate-daily-attendance.test.ts`
- Create: `src/features/attendance/server/attendance-service.ts`
- Create: `src/features/attendance/components/ClockCodePage.tsx`
- Create: `src/features/attendance/components/EmployeePunchPage.tsx`
- Create: `src/features/attendance/components/PunchesPage.tsx`
- Create: `src/features/attendance/components/DailyAttendancePage.tsx`
- Create: `src/features/attendance/components/DailyAttendancePage.test.tsx`
- Create: `src/app/api/clock-code/route.ts`
- Create: `src/app/api/attendance/punch/route.ts`
- Create: `src/app/api/attendance/punches/route.ts`
- Create: `src/app/api/attendance/daily/route.ts`
- Create: `src/app/api/attendance/daily/recalculate/route.ts`
- Create: `src/app/api/attendance/daily/confirm/route.ts`
- Create: `src/app/api/attendance/daily/unconfirm/route.ts`
- Create: `src/app/(app)/clock-code/page.tsx`
- Create: `src/app/(app)/attendance/punches/page.tsx`
- Create: `src/app/(app)/attendance/daily/page.tsx`
- Create: `tests/integration/daily-attendance.test.ts`
- Modify: `prisma/schema.prisma`
- Modify: `prisma/schema.postgres.prisma`
- Modify: `prisma/seed.ts`
- Modify: `.env.example`
- Modify: `src/lib/config.ts`
- Modify: `src/app/api/attendance/route.ts`
- Modify: `src/app/(app)/attendance/page.tsx`
- Modify: `src/features/approvals/server/approval-service.ts`
- Modify: `src/features/dashboard/server/dashboard-service.ts`
- Test: `src/features/attendance/server/clock-code.test.ts`
- Test: `src/features/attendance/server/calculate-daily-attendance.test.ts`
- Test: `src/features/attendance/components/DailyAttendancePage.test.tsx`
- Test: `tests/integration/daily-attendance.test.ts`

**Interfaces:**
- Consumes: published `Schedule`, valid `AttendanceRecord`, approved `LeaveRequest`, approved `PunchCorrection`; `SHIFT_TIMES`; `StoreScope`; approval proxy service from Task 6.
- Produces: `createClockCode(storeId: string, now: Date, secret: string): { code: string; expiresAt: string }`; `verifyClockCode(storeId: string, code: string, now: Date, secret: string): boolean`, accepting the current and immediately previous 60-second window.
- Produces: `AttendanceExceptionType = "late"|"early_leave"|"missing_in"|"missing_out"|"unscheduled"`.
- Produces: `DailyAttendanceInput = { date: string; assignments: ScheduleAssignment[]; punches: Array<{ time: Date; direction: "in"|"out" }>; approvedLeaves: Array<{ startTime: Date; endTime: Date }>; approvedCorrections: Array<{ requestedTime: Date; direction: "in"|"out" }> }`.
- Produces: `DailyAttendanceResult = { scheduledHours: number; workedHours: number; firstIn: string|null; lastOut: string|null; exceptions: Array<{ type: AttendanceExceptionType; minutes: number|null }> }`.
- Produces APIs: `GET /api/clock-code`, `POST /api/attendance/punch`, `GET /api/attendance/punches`, `GET /api/attendance/daily`, `POST /api/attendance/daily/recalculate|confirm|unconfirm`.

- [ ] **Step 1: Write RED HMAC, pure calculator and daily component tests**

```ts
// src/features/attendance/server/clock-code.test.ts
import { describe, expect, it } from "vitest";
import { createClockCode, verifyClockCode } from "./clock-code";

describe("clock code", () => {
  const secret = "test-only-secret";
  it("accepts current and previous windows but rejects older codes", () => {
    const current = new Date("2026-07-19T09:00:30+08:00");
    const previous = createClockCode("store-a", new Date("2026-07-19T08:59:30+08:00"), secret).code;
    const old = createClockCode("store-a", new Date("2026-07-19T08:58:30+08:00"), secret).code;
    expect(verifyClockCode("store-a", previous, current, secret)).toBe(true);
    expect(verifyClockCode("store-a", old, current, secret)).toBe(false);
  });
});
```

```ts
// src/features/attendance/server/calculate-daily-attendance.test.ts
import { expect, it } from "vitest";
import { calculateDailyAttendance } from "./calculate-daily-attendance";

it("calculates late and early leave against the earliest start and latest end", () => {
  const result = calculateDailyAttendance({
    date: "2026-07-20",
    assignments: [
      { userId: "e1", date: "2026-07-20", shiftType: "morning" },
      { userId: "e1", date: "2026-07-20", shiftType: "evening" },
    ],
    punches: [
      { time: new Date("2026-07-20T09:10:00+08:00"), direction: "in" },
      { time: new Date("2026-07-20T20:50:00+08:00"), direction: "out" },
    ],
    approvedLeaves: [],
    approvedCorrections: [],
  });
  expect(result.exceptions).toEqual([{ type: "late", minutes: 10 }, { type: "early_leave", minutes: 10 }]);
  expect(result.scheduledHours).toBe(8);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run src/features/attendance/server/clock-code.test.ts src/features/attendance/server/calculate-daily-attendance.test.ts src/features/attendance/components/DailyAttendancePage.test.tsx`

Expected: FAIL because the attendance feature modules do not exist.

Run: `npm run test:integration -- tests/integration/daily-attendance.test.ts`

Expected: FAIL because `AttendanceExceptionConfirmation` does not exist.

- [ ] **Step 3: Add synchronized exception-confirmation model and code secret**

```prisma
model AttendanceExceptionConfirmation {
  id            String   @id @default(cuid())
  storeId       String
  store         Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  date          DateTime
  type          String   // late | early_leave | missing_in | missing_out | unscheduled
  status        String   @default("unconfirmed") // unconfirmed | confirmed
  confirmedById String?
  confirmedAt   DateTime?

  @@unique([userId, date, type])
  @@index([storeId, date])
}
```

Add inverse relations to `Store` and `User` in both schemas. Add `CLOCK_CODE_SECRET=replace-with-a-long-random-secret` to `.env.example` and expose `config.attendance.clockCodeSecret`; the dynamic-code GET/POST routes must return a server configuration error if production is using the development default.

- [ ] **Step 4: Implement the minimal deterministic dynamic code and pure attendance calculation**

```ts
// src/features/attendance/server/clock-code.ts
import { createHmac, timingSafeEqual } from "node:crypto";

function codeForWindow(storeId: string, window: number, secret: string): string {
  const digest = createHmac("sha256", secret).update(`${storeId}:${window}`).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

export function createClockCode(storeId: string, now: Date, secret: string) {
  const window = Math.floor(now.getTime() / 60_000);
  return { code: codeForWindow(storeId, window, secret), expiresAt: new Date((window + 1) * 60_000).toISOString() };
}

export function verifyClockCode(storeId: string, code: string, now: Date, secret: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const window = Math.floor(now.getTime() / 60_000);
  return [window, window - 1].some((candidate) => {
    const expected = Buffer.from(codeForWindow(storeId, candidate, secret));
    return timingSafeEqual(expected, Buffer.from(code));
  });
}
```

`calculateDailyAttendance()` must be side-effect free. Approved leave removes overlapping scheduled time from expected work. Corrections merge with punches by direction/time. With a schedule, missing first in/out produces `missing_in`/`missing_out`; otherwise compare earliest in with earliest shift start and latest out with latest shift end. Punches without schedule or approved leave produce `unscheduled`. Worked hours are paired in/out durations, clamped to nonnegative values.

Update `dashboard-service.ts` to count current-store unconfirmed daily exceptions from `AttendanceExceptionConfirmation`, completing the manager dashboard without static fallback data.

- [ ] **Step 5: Implement scoped routes, confirmation writes and desktop pages**

`GET /api/clock-code` requires manager with a bound store and returns six digits plus expiry. `POST /api/attendance/punch` requires employee, validates `{ direction: "in"|"out", code: string }`, derives store only from session, rejects consecutive identical directions with 409, and writes `viaCode=true`. Replace legacy `POST /api/attendance` with a 308-compatible JSON error directing callers to `/api/attendance/punch`; keep its GET temporarily delegating to employee history.

Daily routes require manager/admin store scope. Recalculate loads only published schedules plus effective punches/leaves/corrections, computes pure results and upserts unconfirmed confirmation rows for currently present exception types while removing stale unconfirmed rows. Confirm/unconfirm accept same-type ids, load each row with user store, and update in one transaction; mixed types or cross-store ids return 409/403. From the daily drawer, “代提交请假/补卡” calls a server service that creates a normal pending approval for the selected employee after scoped ownership validation, then recalculates only after approval.

Daily/punch list GET routes allow manager/admin scoped viewing; recalculate, confirm, unconfirm and proxy-request writes require manager. Admin cannot resolve a store's daily exceptions.

`ClockCodePage` displays large six digits and a true expiry countdown; `EmployeePunchPage` uses a six-character input and direction choice; `PunchesPage` provides date/employee/direction/source query; `DailyAttendancePage` provides type/status filters, same-type batch confirm, confirm/unconfirm and proxy-request drawer.

```ts
// request/response boundary used by EmployeePunchPage
import { api } from "@/lib/client";

export type PunchInput = { direction: "in" | "out"; code: string };
export type PunchReceipt = { id: string; time: string; direction: "in" | "out"; viaCode: true };

export async function submitPunch(input: PunchInput): Promise<PunchReceipt> {
  return api<PunchReceipt>("/api/attendance/punch", { method: "POST", body: input });
}
```

- [ ] **Step 6: Run GREEN and regression checks**

Run: `npm run db:generate && npx vitest run src/features/attendance/server/clock-code.test.ts src/features/attendance/server/calculate-daily-attendance.test.ts src/features/attendance/components/DailyAttendancePage.test.tsx`

Expected: all tests PASS, including previous-window code and combined-shift timing.

Run: `npm run test:integration -- tests/integration/daily-attendance.test.ts`

Expected: cross-store access is rejected; recalculate creates only current exceptions; same-type batch confirmation is atomic; an approved correction changes the result; manager is never treated as a scheduled employee.

Run: `npx tsc --noEmit && npm run build`

Expected: both commands exit 0.

Run: `diff -u prisma/schema.prisma prisma/schema.postgres.prisma | sed -n '1,40p'`

Expected: only datasource provider differs.

- [ ] **Step 7: Commit Task 7**

```bash
git add .env.example prisma/schema.prisma prisma/schema.postgres.prisma prisma/seed.ts src/lib/config.ts src/lib/contracts/attendance.ts src/features/dashboard/server/dashboard-service.ts src/features/attendance src/features/approvals/server/approval-service.ts src/app/api/clock-code src/app/api/attendance src/app/'(app)'/clock-code src/app/'(app)'/attendance tests/integration/daily-attendance.test.ts
git commit -m "feat: close web punch and daily attendance exceptions"
```

---

### Task 8: 月度考勤汇总、零考勤处理、确认与自动失效

**Files:**
- Create: `src/lib/contracts/monthly-attendance.ts`
- Create: `src/features/attendance/server/monthly-attendance-service.ts`
- Create: `src/features/attendance/server/monthly-attendance-service.test.ts`
- Create: `src/features/attendance/server/invalidate-monthly-confirmation.ts`
- Create: `src/features/attendance/server/invalidate-monthly-confirmation.test.ts`
- Create: `src/features/attendance/components/MonthlyAttendancePage.tsx`
- Create: `src/features/attendance/components/MonthlyAttendancePage.test.tsx`
- Create: `src/app/api/attendance/monthly/route.ts`
- Create: `src/app/api/attendance/monthly/confirm/route.ts`
- Create: `src/app/api/attendance/monthly/unconfirm/route.ts`
- Create: `src/app/(app)/attendance/monthly/page.tsx`
- Create: `tests/integration/monthly-attendance.test.ts`
- Modify: `prisma/schema.prisma`
- Modify: `prisma/schema.postgres.prisma`
- Modify: `prisma/seed.ts`
- Modify: `src/features/scheduling/server/schedule-command-service.ts`
- Modify: `src/features/approvals/server/approval-service.ts`
- Modify: `src/app/api/attendance/punch/route.ts`
- Modify: `src/app/api/attendance/daily/recalculate/route.ts`
- Modify: `src/app/api/attendance/daily/confirm/route.ts`
- Modify: `src/app/api/attendance/daily/unconfirm/route.ts`
- Test: `src/features/attendance/server/monthly-attendance-service.test.ts`
- Test: `src/features/attendance/server/invalidate-monthly-confirmation.test.ts`
- Test: `src/features/attendance/components/MonthlyAttendancePage.test.tsx`
- Test: `tests/integration/monthly-attendance.test.ts`

**Interfaces:**
- Consumes: `DailyAttendanceResult`, `AttendanceExceptionConfirmation`, published schedules, punches, approved leave/corrections and all mutation services from Tasks 5–7.
- Produces: `ZeroAttendanceAction = "none"|"normal_attendance"|"supplement_hours"`; `MonthlyConfirmationStatus = "unconfirmed"|"confirmed"`.
- Produces: `MonthlyAttendanceRow = { userId: string; employeeName: string; month: string; scheduledHours: number; workedHours: number; exceptionCount: number; unconfirmedExceptionCount: number; zeroAttendance: boolean; zeroAttendanceAction: ZeroAttendanceAction; status: MonthlyConfirmationStatus; confirmedByName: string|null; confirmedAt: string|null }`.
- Produces: `invalidateMonthlyConfirmations(tx: Prisma.TransactionClient, input: { storeId: string; userIds: string[]; dates: Date[] }): Promise<number>`.
- Produces APIs: `GET /api/attendance/monthly?month=YYYY-MM&storeId=`, `POST /api/attendance/monthly/confirm`, `POST /api/attendance/monthly/unconfirm`.

- [ ] **Step 1: Write RED monthly-blocker, invalidation and component tests**

```ts
// src/features/attendance/server/monthly-attendance-service.test.ts
import { expect, it } from "vitest";
import { validateMonthlyConfirmation } from "./monthly-attendance-service";

it("blocks employees with unconfirmed daily exceptions and zero attendance without an action", () => {
  const result = validateMonthlyConfirmation([
    { userId: "e1", employeeName: "小王", month: "2026-07", scheduledHours: 40, workedHours: 0, exceptionCount: 2, unconfirmedExceptionCount: 1, zeroAttendance: true, zeroAttendanceAction: "none", status: "unconfirmed", confirmedByName: null, confirmedAt: null },
  ]);
  expect(result).toEqual({
    ok: false,
    blocked: [{ userId: "e1", reasons: ["仍有 1 条未确认日异常", "0 考勤必须选择处理方式"] }],
  });
});
```

```ts
// src/features/attendance/server/invalidate-monthly-confirmation.test.ts
import { beforeEach, expect, it } from "vitest";
import { prisma, resetTestDb } from "../../../../tests/helpers/test-db";
import { invalidateMonthlyConfirmations } from "./invalidate-monthly-confirmation";

beforeEach(resetTestDb);

it("only invalidates confirmed rows in affected user months", async () => {
  const store = await prisma.store.create({ data: { name: "A", code: "A" } });
  const user = await prisma.user.create({ data: { phone: "1", name: "小王", role: "employee", storeId: store.id } });
  await prisma.monthlyAttendanceConfirmation.create({ data: { storeId: store.id, userId: user.id, month: "2026-07", status: "confirmed" } });
  await prisma.$transaction((tx) => invalidateMonthlyConfirmations(tx, { storeId: store.id, userIds: [user.id], dates: [new Date("2026-07-20T00:00:00+08:00")] }));
  expect((await prisma.monthlyAttendanceConfirmation.findFirstOrThrow()).status).toBe("unconfirmed");
});
```

```tsx
// src/features/attendance/components/MonthlyAttendancePage.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import MonthlyAttendancePage from "./MonthlyAttendancePage";

it("disables confirmation and identifies the blocking employee", () => {
  render(<MonthlyAttendancePage initialRows={[{ userId: "e1", employeeName: "小王", month: "2026-07", scheduledHours: 40, workedHours: 32, exceptionCount: 1, unconfirmedExceptionCount: 1, zeroAttendance: false, zeroAttendanceAction: "none", status: "unconfirmed", confirmedByName: null, confirmedAt: null }]} onConfirm={vi.fn()} onUnconfirm={vi.fn()} />);
  expect(screen.getByText("小王")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "确认考勤" })).toBeDisabled();
  expect(screen.getByText("仍有 1 条未确认日异常")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run src/features/attendance/server/monthly-attendance-service.test.ts src/features/attendance/server/invalidate-monthly-confirmation.test.ts src/features/attendance/components/MonthlyAttendancePage.test.tsx`

Expected: FAIL because the monthly modules and Prisma model do not exist.

Run: `npm run test:integration -- tests/integration/monthly-attendance.test.ts`

Expected: FAIL because monthly confirm/unconfirm services do not exist.

- [ ] **Step 3: Add the synchronized monthly-confirmation model**

```prisma
model MonthlyAttendanceConfirmation {
  id                   String   @id @default(cuid())
  storeId              String
  store                Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)
  userId               String
  user                 User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  month                String
  status               String   @default("unconfirmed") // unconfirmed | confirmed
  zeroAttendanceAction String   @default("none") // none | normal_attendance | supplement_hours
  confirmedById        String?
  confirmedAt          DateTime?
  updatedAt            DateTime @updatedAt

  @@unique([userId, month])
  @@index([storeId, month])
}
```

Add inverse relations to `Store` and `User` in both schemas. Update seed deletion order; seed no confirmed months so test and demo confirmation always reflect current derived data.

- [ ] **Step 4: Implement the minimal monthly contracts, blocker and scoped transaction**

```ts
// src/lib/contracts/monthly-attendance.ts
import { z } from "zod";

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const zeroAttendanceActionSchema = z.enum(["none", "normal_attendance", "supplement_hours"]);
export const monthlyConfirmSchema = z.object({
  storeId: z.string().optional(),
  month: monthSchema,
  rows: z.array(z.object({
    userId: z.string().min(1),
    zeroAttendanceAction: zeroAttendanceActionSchema,
  })).min(1),
});

export type ZeroAttendanceAction = z.infer<typeof zeroAttendanceActionSchema>;
export type MonthlyAttendanceRow = {
  userId: string;
  employeeName: string;
  month: string;
  scheduledHours: number;
  workedHours: number;
  exceptionCount: number;
  unconfirmedExceptionCount: number;
  zeroAttendance: boolean;
  zeroAttendanceAction: ZeroAttendanceAction;
  status: "unconfirmed" | "confirmed";
  confirmedByName: string | null;
  confirmedAt: string | null;
};
```

```ts
// src/features/attendance/server/monthly-attendance-service.ts
import type { MonthlyAttendanceRow } from "@/lib/contracts/monthly-attendance";

export function validateMonthlyConfirmation(rows: MonthlyAttendanceRow[]) {
  const blocked = rows.flatMap((row) => {
    const reasons: string[] = [];
    if (row.unconfirmedExceptionCount > 0)
      reasons.push(`仍有 ${row.unconfirmedExceptionCount} 条未确认日异常`);
    if (row.zeroAttendance && row.zeroAttendanceAction === "none")
      reasons.push("0 考勤必须选择处理方式");
    return reasons.length ? [{ userId: row.userId, reasons }] : [];
  });
  return blocked.length ? { ok: false as const, blocked } : { ok: true as const, blocked: [] };
}
```

`getMonthlyAttendance(scope, month)` must enumerate current store employees only, derive scheduled/worked hours from the same daily calculator, count confirmation rows, and left-join monthly status. `confirmMonthlyAttendance(scope, input)` reruns the calculation inside a transaction, rejects the whole batch with HTTP 409 and a blocking employee list when any daily exception remains unconfirmed or zero attendance lacks an action, then upserts status `confirmed`, actor and timestamp. Unconfirm loads every row by store and updates the batch atomically.

Monthly GET allows manager/admin scoped viewing; confirm and unconfirm require manager role and the manager's session store.

- [ ] **Step 5: Wire automatic invalidation into every source mutation**

```ts
// src/features/attendance/server/invalidate-monthly-confirmation.ts
import type { Prisma } from "@prisma/client";
import { toDateStr } from "@/lib/dates";

export async function invalidateMonthlyConfirmations(
  tx: Prisma.TransactionClient,
  input: { storeId: string; userIds: string[]; dates: Date[] }
): Promise<number> {
  const months = [...new Set(input.dates.map((date) => toDateStr(date).slice(0, 7)))];
  if (input.userIds.length === 0 || months.length === 0) return 0;
  const result = await tx.monthlyAttendanceConfirmation.updateMany({
    where: { storeId: input.storeId, userId: { in: input.userIds }, month: { in: months }, status: "confirmed" },
    data: { status: "unconfirmed", confirmedById: null, confirmedAt: null },
  });
  return result.count;
}
```

Call this function inside the same transaction after schedule draft replacement/publish/import/copy, new punch, approved/rejected leave state change, approved correction creation, daily recalculation that changes exception types, and daily confirm/unconfirm. Pass only affected users and dates. A failed source mutation must roll back the invalidation; an invalidation must never affect another store or month.

- [ ] **Step 6: Implement the month summary page**

`MonthlyAttendancePage` renders month/store query, employee rows, planned hours, actual hours, exceptions, confirmation state and zero-attendance action. It supports selected-row confirmation and unconfirmation. Any blocker disables the final confirmation button and displays the employee/reason list. A source mutation after confirmation returns the row to “未确认” on refresh and shows “源数据已变化，需重新计算并确认”.

```ts
export type MonthlyAttendancePageProps = {
  initialRows: MonthlyAttendanceRow[];
  onConfirm: (input: { month: string; rows: Array<{ userId: string; zeroAttendanceAction: ZeroAttendanceAction }> }) => Promise<void>;
  onUnconfirm: (input: { month: string; userIds: string[] }) => Promise<void>;
};
```

- [ ] **Step 7: Run GREEN and regression checks**

Run: `npm run db:generate && npx vitest run src/features/attendance/server/monthly-attendance-service.test.ts src/features/attendance/server/invalidate-monthly-confirmation.test.ts src/features/attendance/components/MonthlyAttendancePage.test.tsx`

Expected: all test files PASS.

Run: `npm run test:integration -- tests/integration/monthly-attendance.test.ts`

Expected: unresolved exceptions block the whole confirmation batch; zero-attendance action is required; cross-store rows are rejected; schedule, punch, leave and correction mutations invalidate only affected confirmed months.

Run: `npx tsc --noEmit && npm run build`

Expected: both commands exit 0.

Run: `diff -u prisma/schema.prisma prisma/schema.postgres.prisma | sed -n '1,40p'`

Expected: only datasource provider differs.

- [ ] **Step 8: Commit Task 8**

```bash
git add prisma/schema.prisma prisma/schema.postgres.prisma prisma/seed.ts src/lib/contracts/monthly-attendance.ts src/features/attendance src/features/scheduling/server/schedule-command-service.ts src/features/approvals/server/approval-service.ts src/app/api/attendance/punch/route.ts src/app/api/attendance/daily src/app/api/attendance/monthly 'src/app/(app)/attendance/monthly' tests/integration/monthly-attendance.test.ts
git commit -m "feat: add monthly attendance confirmation lifecycle"
```

---

### Task 9: Monthly 工时报表、排班报表与 AI 指标

**Files:**
- Create: `src/lib/contracts/reports.ts`
- Create: `src/features/reports/server/report-service.ts`
- Create: `src/features/reports/server/report-service.test.ts`
- Create: `src/features/reports/components/MonthlyReportPage.tsx`
- Create: `src/features/reports/components/SchedulingReportPage.tsx`
- Create: `src/features/reports/components/ReportPages.test.tsx`
- Create: `src/app/api/reports/monthly/route.ts`
- Create: `src/app/api/reports/scheduling/route.ts`
- Create: `src/app/(app)/reports/monthly/page.tsx`
- Create: `src/app/(app)/reports/scheduling/page.tsx`
- Create: `tests/integration/reports.test.ts`
- Modify: `src/app/api/reports/route.ts`
- Modify: `src/app/(app)/reports/page.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`
- Modify: `src/features/dashboard/components/DashboardPage.tsx`
- Test: `src/features/reports/server/report-service.test.ts`
- Test: `src/features/reports/components/ReportPages.test.tsx`
- Test: `tests/integration/reports.test.ts`

**Interfaces:**
- Consumes: confirmed `MonthlyAttendanceConfirmation`, daily calculator, published schedules, `getStaffing()`, employee abilities/performance, `AiInteractionLog` feedback fields and `StoreScope`.
- Produces: `MonthlyReportRow = { userId: string; employeeName: string; scheduledHours: number; workedHours: number; leaveHours: number; correctionHours: number; exceptionCount: number; confirmationStatus: "unconfirmed"|"confirmed" }`.
- Produces: `SchedulingReport = { weekOf: string; employeeRows: Array<{ userId: string; employeeName: string; shifts: number; hours: number; ability: string; performance: string }>; gaps: Array<{ date: string; shift: Shift; position: Position; required: number; assigned: number; shortfall: number }>; v2s: Array<{ date: string; shift: Shift; visitors: number; staff: number; actualV2S: number|null; lower: number; upper: number }>; abilityBalance: Array<{ date: string; shift: Shift; high: number; mid: number; low: number }>; ai: { generatedPlans: number; acceptedPlans: number; editedPlans: number; acceptanceRate: number|null; averageEditRatio: number|null } }`.
- Produces APIs: `GET /api/reports/monthly?month=&storeId=` and `GET /api/reports/scheduling?weekOf=&storeId=`; legacy `GET /api/reports?month=` delegates to monthly service.

- [ ] **Step 1: Write RED aggregation, store-isolation and component tests**

```ts
// src/features/reports/server/report-service.test.ts
import { expect, it } from "vitest";
import { calculateAiMetrics } from "./report-service";

it("returns null rates for no AI plans and exact rates for known logs", () => {
  expect(calculateAiMetrics([])).toEqual({ generatedPlans: 0, acceptedPlans: 0, editedPlans: 0, acceptanceRate: null, averageEditRatio: null });
  expect(calculateAiMetrics([
    { wasAccepted: true, wasEdited: false, editRatio: 0 },
    { wasAccepted: false, wasEdited: true, editRatio: 0.25 },
  ])).toEqual({ generatedPlans: 2, acceptedPlans: 1, editedPlans: 1, acceptanceRate: 0.5, averageEditRatio: 0.125 });
});
```

```tsx
// src/features/reports/components/ReportPages.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import MonthlyReportPage from "./MonthlyReportPage";

it("shows confirmation state beside monthly hours", () => {
  render(<MonthlyReportPage initialData={{ month: "2026-07", rows: [{ userId: "e1", employeeName: "小王", scheduledHours: 40, workedHours: 36, leaveHours: 4, correctionHours: 0, exceptionCount: 0, confirmationStatus: "confirmed" }], totals: { scheduledHours: 40, workedHours: 36 } }} />);
  expect(screen.getByText("小王")).toBeInTheDocument();
  expect(screen.getByText("已确认")).toBeInTheDocument();
  expect(screen.getByText("36")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run src/features/reports/server/report-service.test.ts src/features/reports/components/ReportPages.test.tsx`

Expected: FAIL because report feature modules do not exist.

Run: `npm run test:integration -- tests/integration/reports.test.ts`

Expected: FAIL until scoped report queries exist.

- [ ] **Step 3: Implement the minimal report contracts and pure metrics**

```ts
// src/features/reports/server/report-service.ts
export type AiFeedbackRow = { wasAccepted: boolean | null; wasEdited: boolean | null; editRatio: number | null };

export function calculateAiMetrics(rows: AiFeedbackRow[]) {
  const generatedPlans = rows.length;
  const acceptedPlans = rows.filter((row) => row.wasAccepted === true).length;
  const editedPlans = rows.filter((row) => row.wasEdited === true).length;
  const ratios = rows.flatMap((row) => row.editRatio === null ? [] : [row.editRatio]);
  return {
    generatedPlans,
    acceptedPlans,
    editedPlans,
    acceptanceRate: generatedPlans ? acceptedPlans / generatedPlans : null,
    averageEditRatio: ratios.length ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length : null,
  };
}
```

`getMonthlyReport(scope, month)` must use the same underlying daily/monthly service as the confirmation page, not recompute with a separate formula. `getSchedulingReport(scope, weekOf)` must query published schedules only, calculate position gaps against `getStaffing()` output, use employee `salesAbility` for ability balance, calculate actual V2S as visitors/assigned when assigned > 0, and query only `AiInteractionLog(feature="schedule_advisor")` linked to the scoped store's managers and plan week feedback. Admin must provide store; manager cannot override session store.

- [ ] **Step 4: Implement dense report pages and compatibility redirects**

`MonthlyReportPage` renders query controls, totals, employee table and confirmation status; charts remain secondary to the table. `SchedulingReportPage` renders week/employee filters, weekly hours/shifts, gap table, ability distribution, V2S boundary status and AI acceptance/edit metrics. Replace `src/app/(app)/reports/page.tsx` with `redirect("/reports/monthly")`. Keep `src/app/api/reports/route.ts` as a thin call to `getMonthlyReport()` so existing clients do not break. Update dashboard quick links and counts to the new routes.

```tsx
// src/app/(app)/reports/page.tsx
import { redirect } from "next/navigation";

export default function ReportsIndexPage() {
  redirect("/reports/monthly");
}
```

- [ ] **Step 5: Run GREEN and regression checks**

Run: `npx vitest run src/features/reports/server/report-service.test.ts src/features/reports/components/ReportPages.test.tsx`

Expected: both test files PASS.

Run: `npm run test:integration -- tests/integration/reports.test.ts`

Expected: manager sees only own store, admin without storeId is rejected, monthly confirmation status matches Task 8, gaps are grouped by position, and empty AI data returns null rather than a fabricated percentage.

Run: `npx tsc --noEmit && npm run build`

Expected: both commands exit 0; legacy and new report routes build.

- [ ] **Step 6: Commit Task 9**

```bash
git add src/lib/contracts/reports.ts src/features/reports src/features/dashboard/components/DashboardPage.tsx src/app/api/reports src/app/'(app)'/reports src/app/'(app)'/dashboard/page.tsx tests/integration/reports.test.ts
git commit -m "feat: connect monthly and scheduling reports"
```

---

### Task 10: PPT 视觉回归、桌面可访问性与两条全链路验收

**Files:**
- Create: `scripts/extract-ppt-reference.py`
- Create: `tests/e2e/helpers/auth.ts`
- Create: `tests/e2e/manager-scheduling.spec.ts`
- Create: `tests/e2e/employee-attendance.spec.ts`
- Create: `tests/e2e/schedule-import.spec.ts`
- Create: `tests/e2e/authorization.spec.ts`
- Create: `tests/visual/desktop-pages.spec.ts`
- Create: `tests/visual/ppt-reference-checklist.md`
- Create after review: `tests/visual/__screenshots__/dashboard-1440x900.png`
- Create after review: `tests/visual/__screenshots__/dashboard-1366x768.png`
- Create after review: `tests/visual/__screenshots__/store-basic-1440x900.png`
- Create after review: `tests/visual/__screenshots__/store-basic-1366x768.png`
- Create after review: `tests/visual/__screenshots__/store-work-groups-1440x900.png`
- Create after review: `tests/visual/__screenshots__/store-work-groups-1366x768.png`
- Create after review: `tests/visual/__screenshots__/schedule-plans-1440x900.png`
- Create after review: `tests/visual/__screenshots__/schedule-plans-1366x768.png`
- Create after review: `tests/visual/__screenshots__/approvals-1440x900.png`
- Create after review: `tests/visual/__screenshots__/approvals-1366x768.png`
- Create after review: `tests/visual/__screenshots__/attendance-daily-1440x900.png`
- Create after review: `tests/visual/__screenshots__/attendance-daily-1366x768.png`
- Create after review: `tests/visual/__screenshots__/attendance-monthly-1440x900.png`
- Create after review: `tests/visual/__screenshots__/attendance-monthly-1366x768.png`
- Create after review: `tests/visual/__screenshots__/reports-monthly-1440x900.png`
- Create after review: `tests/visual/__screenshots__/reports-monthly-1366x768.png`
- Create after review: `tests/visual/__screenshots__/reports-scheduling-1440x900.png`
- Create after review: `tests/visual/__screenshots__/reports-scheduling-1366x768.png`
- Modify: `playwright.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Modify: `src/app/globals.css`
- Modify: `src/components/enterprise/AppShell.tsx`
- Modify: `src/features/store/components/StoreBasicPage.tsx`
- Modify: `src/features/store/components/WorkGroupsPage.tsx`
- Modify: `src/features/scheduling/components/ScheduleWizardPage.tsx`
- Modify: `src/features/scheduling/components/ScheduleGrid.tsx`
- Modify: `src/features/scheduling/server/schedule-command-service.ts`
- Modify: `src/app/api/schedule/import/commit/route.ts`
- Modify: `src/features/approvals/components/ApprovalsPage.tsx`
- Modify: `src/features/attendance/components/DailyAttendancePage.tsx`
- Modify: `src/features/attendance/components/MonthlyAttendancePage.tsx`
- Modify: `src/features/reports/components/MonthlyReportPage.tsx`
- Modify: `src/features/reports/components/SchedulingReportPage.tsx`
- Test: `tests/e2e/manager-scheduling.spec.ts`
- Test: `tests/e2e/employee-attendance.spec.ts`
- Test: `tests/e2e/schedule-import.spec.ts`
- Test: `tests/e2e/authorization.spec.ts`
- Test: `tests/visual/desktop-pages.spec.ts`

**Interfaces:**
- Consumes: all routes and APIs from Tasks 1–9; deterministic seed users (`13800000001` manager, `13810000001` employee, fixed code `123456`); source PPT path and two approved viewports.
- Produces: `loginAs(page: Page, phone: string): Promise<void>`; manager scheduling E2E; employee-to-manager attendance E2E; import success/error/rollback E2E; API/UI authorization E2E.
- Produces visual snapshots at exactly `1440×900` and `1366×768`; width `1279×900` must show only the wide-screen blocker.
- Produces PPT reference artifacts under ignored `test-results/ppt-reference/slide-001.png` through `slide-063.png`; the PPT itself is never copied into git.

- [ ] **Step 1: Write the failing Playwright flows before capturing any screenshots**

```ts
// tests/e2e/helpers/auth.ts
import type { Page } from "@playwright/test";

export async function loginAs(page: Page, phone: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("手机号").fill(phone);
  await page.getByLabel("验证码").fill("123456");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/dashboard");
}
```

```ts
// tests/e2e/manager-scheduling.spec.ts
import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";

test("manager configures a store, runs four steps and publishes", async ({ page }) => {
  await loginAs(page, "13800000001");
  await page.goto("/store/basic");
  await expect(page.getByRole("heading", { name: "门店基础" })).toBeVisible();
  await page.goto("/schedule/plans");
  await page.getByRole("button", { name: "创建计划" }).click();
  await page.getByLabel("计划周").fill("2026-07-27");
  await page.getByLabel("工作制").selectOption("work5rest2");
  await page.getByRole("button", { name: "确认创建" }).click();
  await expect(page).toHaveURL(/\/schedule\/plans\/[a-z0-9]+/);
  await page.getByRole("button", { name: "下一步：业务预测" }).click();
  await page.getByRole("button", { name: "下一步：人力预测" }).click();
  await page.getByRole("button", { name: "下一步：自动排班" }).click();
  await page.getByRole("button", { name: "生成推荐" }).click();
  await expect(page.getByText(/求解完成/)).toBeVisible();
  await page.getByRole("button", { name: "发布班表" }).click();
  await expect(page.getByText("发布成功")).toBeVisible();
});
```

```ts
// tests/e2e/authorization.spec.ts
import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";

test("employee cannot open manager pages or query another store API", async ({ page }) => {
  await loginAs(page, "13810000001");
  await page.goto("/schedule/plans");
  await expect(page).toHaveURL(/\/dashboard|\/forbidden/);
  const response = await page.request.get("/api/attendance/punches?storeId=store-b");
  expect(response.status()).toBe(403);
});
```

- [ ] **Step 2: Run Playwright to verify RED**

Run: `npm run db:reset && npx playwright test tests/visual/desktop-pages.spec.ts --project=chromium --grep '/dashboard at 1440x900'`

Expected: FAIL with “A snapshot doesn't exist” for `tests/visual/__screenshots__/dashboard-1440x900.png`; do not accept the generated actual image until it has been compared with the PPT reference set.

- [ ] **Step 3: Implement the minimal deterministic test fixtures and finish the two business journeys**

`employee-attendance.spec.ts` must execute: employee Web punch and leave/correction submission → manager AI suggestion → explicit approval → daily recalculation → daily exception confirmation → monthly confirmation → monthly report confirmed state. `schedule-import.spec.ts` must download the generated template, upload one valid workbook, assert validation counts, commit and publish; then upload one workbook with a cross-store employee and invalid shift, assert row/column/value/suggestion, and verify schedule count is unchanged after a forced database write failure fixture. Use API seeding only for preconditions that the UI does not expose; do not bypass the operation under test.

Inject a `ScheduleWriter` dependency into `schedule-command-service`. For Playwright only, start Next with `WFM_E2E_IMPORT_FAILURES=1`; when that flag is set and the validated batch filename is exactly `rollback-fixture.xlsx`, the commit route passes a writer that throws on row 2. The valid fixture uses another filename. Production leaves the flag unset and always constructs the Prisma writer, so no query/body field can trigger failure.

```ts
export type ScheduleWriter = {
  replaceAssignments: (assignments: ScheduleAssignment[]) => Promise<void>;
};

export function e2eImportFailureRow(fileName: string): number | null {
  return process.env.WFM_E2E_IMPORT_FAILURES === "1" && fileName === "rollback-fixture.xlsx" ? 2 : null;
}
```

- [ ] **Step 4: Extract the 63-page PPT reference without committing the source deck**

```py
# scripts/extract-ppt-reference.py
from pathlib import Path
import os
import subprocess

source_value = os.environ.get("WFM_PPT_REFERENCE", "").strip()
if not source_value:
    raise SystemExit(
        "WFM_PPT_REFERENCE must point to the authorized visual reference deck."
    )
source = Path(source_value)
output = Path("test-results/ppt-reference")
output.mkdir(parents=True, exist_ok=True)
if not source.exists():
    raise SystemExit(f"PPT reference not found: {source}")
for previous in output.glob("slide-*.png"):
    previous.unlink()
subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(output), str(source)], check=True)
pdf = output / f"{source.stem}.pdf"
subprocess.run(["pdftoppm", "-png", "-r", "120", str(pdf), str(output / "slide")], check=True)
slides = sorted(output.glob("slide-*.png"))
if len(slides) != 63:
    raise SystemExit(f"expected 63 slides, got {len(slides)}")
for index, slide in enumerate(slides, start=1):
    slide.rename(output / f"slide-{index:03d}.png")
```

`tests/visual/ppt-reference-checklist.md` must record, for every target route family, the reviewed PPT evidence categories: top module bar, 208px menu tree, query/tool/table order, dialogs/drawers, calendar, four-step sequence, schedule grid colors, approval status, daily/monthly tables and report density. Mark each route at both viewports with reviewer initials/date; this is a human fidelity gate, while Playwright snapshots protect the accepted implementation from later drift.

- [ ] **Step 5: Write exact visual and desktop-width regression tests**

```ts
// tests/visual/desktop-pages.spec.ts
import { expect, test } from "@playwright/test";
import { loginAs } from "../e2e/helpers/auth";

const routes = [
  "/dashboard",
  "/store/basic",
  "/store/work-groups",
  "/schedule/plans",
  "/approvals",
  "/attendance/daily",
  "/attendance/monthly",
  "/reports/monthly",
  "/reports/scheduling",
];

for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
  for (const route of routes) {
    test(`${route} at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await loginAs(page, "13800000001");
      await page.goto(route);
      await expect(page).toHaveScreenshot(`${route.slice(1).replaceAll("/", "-")}-${viewport.width}x${viewport.height}.png`, {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.01,
      });
    });
  }
}

test("1279px is blocked instead of becoming mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1279, height: 900 });
  await loginAs(page, "13800000001");
  await expect(page.getByText("请使用宽屏浏览器访问（最低 1280px）")).toBeVisible();
  await expect(page.locator("aside")).toBeHidden();
});
```

Capture snapshots only after reviewing the live pages against the extracted 63-slide PPT reference set. Fix concrete spacing, overflow, color, density, focus and scroll defects in their owning files; rerun the failed test after each fix, then run the full visual suite. Add `@axe-core/playwright` as a dev dependency and assert no critical/serious violations on dashboard, schedule wizard, approvals and daily/monthly pages.

Update `playwright.config.ts` to start both services so the manager journey must publish a real OR-Tools result:

```ts
webServer: [
  { command: "WFM_E2E_IMPORT_FAILURES=1 npm run dev", url: "http://127.0.0.1:3000", reuseExistingServer: !process.env.CI },
  { command: "cd schedule-engine && .venv/bin/python -m uvicorn main:app --port 8000", url: "http://127.0.0.1:8000/health", reuseExistingServer: !process.env.CI },
],
snapshotPathTemplate: "{testDir}/visual/__screenshots__/{arg}{ext}",
```

Run: `npm install --save-dev @axe-core/playwright`

- [ ] **Step 6: Run GREEN and regression checks for the full suite**

Run: `npm run db:reset && npm run test:unit`

Expected: all Vitest unit/contract/RTL files PASS.

Run: `npm run test:integration`

Expected: all SQLite integration tests PASS, including transactions, unique keys and cross-store isolation.

Run: `cd schedule-engine && .venv/bin/python test_solver.py`

Expected: all OR-Tools tests PASS with fixed three-shift times, work-mode day limits and position gaps.

Run: `npx tsc --noEmit && npm run lint && npm run build`

Expected: all three commands exit 0 with no type, lint or build failures.

Run: `npm run db:reset && npx playwright test tests/e2e --project=chromium`

Expected: manager scheduling, employee attendance, import and authorization suites all PASS.

Run: `python3 scripts/extract-ppt-reference.py && npm run test:visual`

Expected: exactly 63 PPT slide images are extracted; all 18 route/viewport screenshots and the 1279px blocker test PASS.

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only Task 10 files and concrete regression fixes are present.

- [ ] **Step 7: Commit Task 10**

```bash
git add .gitignore package.json package-lock.json playwright.config.ts scripts/extract-ppt-reference.py tests/e2e tests/visual
git add src/app/globals.css src/components/enterprise/AppShell.tsx src/features/store/components/StoreBasicPage.tsx src/features/store/components/WorkGroupsPage.tsx src/features/scheduling/components/ScheduleWizardPage.tsx src/features/scheduling/components/ScheduleGrid.tsx src/features/scheduling/server/schedule-command-service.ts src/app/api/schedule/import/commit/route.ts src/features/approvals/components/ApprovalsPage.tsx src/features/attendance/components/DailyAttendancePage.tsx src/features/attendance/components/MonthlyAttendancePage.tsx src/features/reports/components/MonthlyReportPage.tsx src/features/reports/components/SchedulingReportPage.tsx
git commit -m "test: verify WFM desktop workflows and visuals"
```

## Spec Coverage Matrix

| Approved requirement | Owning task and automated gate |
|---|---|
| 48px top bar, 208px menu, desktop-only 1280+ | Task 1 RTL; Task 10 1279 blocker + two viewport snapshots |
| employee/manager/admin and server-side role/store isolation | Task 1 authorization unit; every integration suite; Task 10 authorization E2E |
| store basic, operating days, V2S, staffing, events | Task 2 SQLite + RTL |
| work areas, work groups, leaders, member periods, employee tags | Task 3 overlap unit + SQLite + RTL |
| plans and four-step prepare/forecast/staffing/generate flow | Task 4 Vitest + solver + SQLite; Task 10 manager E2E |
| fixed shifts and manager excluded from scheduling | Global constraint; Tasks 4–5 solver/constraint tests |
| grid edit/copy/paste/clear/restore/publish | Task 5 RTL + SQLite |
| employee published schedule, weekly hours and manager export | Task 5 RTL + scoped SQLite |
| template, import validation, exact error detail and atomic commit | Task 5 parser/transaction; Task 10 import E2E |
| pending/history, batch pass/reject and AI advisory only | Task 6 unit/RTL/SQLite |
| employee leave, punch correction, target-accepted shift swap | Task 6 RTL/SQLite; Task 10 employee journey |
| dynamic code, Web punch, punch records and daily exceptions | Task 7 unit/RTL/SQLite; Task 10 employee journey |
| proxy leave/correction, daily confirm/unconfirm | Tasks 6–7 integration; Task 10 employee journey |
| monthly zero-attendance handling, blocker, confirm and invalidation | Task 8 unit/SQLite; Task 10 employee journey |
| Monthly and scheduling reports, V2S/gaps/ability/AI metrics | Task 9 unit/SQLite + Task 10 snapshots |
| API transactions, 409 concurrency and 422 infeasible results | Tasks 4–8 integration tests |
| AI/engine degradation with manual scheduling retained | Task 4 wizard RTL and manager E2E conditional branch |
| PPT fidelity and 1440×900 / 1366×768 acceptance | Task 10 63-slide extraction, review checklist and snapshots |

## Final Plan Audit Before Implementation

- [ ] Confirm the document has exactly ten independently reviewable tasks: `rg -c '^### Task [0-9]+:' docs/superpowers/plans/2026-07-19-wfm-desktop-web-replica-implementation.md` → `10`.
- [ ] Run forbidden-token scan: `rg -n 'T[B]D|T[O]DO|im[p]lement later|fill in deta[i]ls|类似任[务]|参照任[务]|适当的错误处[理]' docs/superpowers/plans/2026-07-19-wfm-desktop-web-replica-implementation.md` → no output, exit 1.
- [ ] Check every task contains file, interface, RED command, minimal implementation, GREEN/regression and commit sections: run `rg -c '^\*\*Files:\*\*'`, `rg -c '^\*\*Interfaces:\*\*'`, `rg -c 'verify R[E]D'`, `rg -c 'Implement the minima[l]'`, `rg -c 'Run GREEN and regression check[s]'` and `rg -c 'Commit Tas[k]'` against this plan → each command prints `10`.
- [ ] Check Prisma model changes always name both schema files in Tasks 2, 3, 4, 5, 6, 7 and 8: `rg -n 'Modify: `prisma/schema\.(prisma|postgres\.prisma)`' docs/superpowers/plans/2026-07-19-wfm-desktop-web-replica-implementation.md` → 14 lines, two per schema-changing task.
- [ ] Check signature consistency manually against the Locked File and Interface Map: `StoreScope`, `ScheduleAssignment`, `WorkMode`, `ConstraintIssue`, `ApprovalItem`, `DailyAttendanceResult`, `MonthlyAttendanceRow` and `SchedulingReport` have one owning task and later tasks only consume the same names.
- [ ] Before implementation begins, verify clean handoff: `git status --short` → no output after the plan-document-only commit.
