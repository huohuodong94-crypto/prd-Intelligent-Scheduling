# WFM Third-Party Brand Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove unauthorized third-party branding and affiliation cues from the WFM desktop Web UI and distributable repository text without changing authentication, scheduling, import behavior, or data models.

**Architecture:** Keep the existing login state and API flow, but collapse its presentation to one centered column. Neutralize only user-facing technology labels, require an explicit environment variable for the external visual reference, and add a tracked-text regression guard for the two legacy brands that must disappear repository-wide.

**Tech Stack:** Next.js 14 App Router, TypeScript, React 18, Tailwind CSS, Vitest, Testing Library, Playwright, Python `unittest`, Prisma SQLite/Postgres dual schemas unchanged.

## Global Constraints

- Desktop browser Web only; do not add phone layouts, apps, responsive mobile variants, or native desktop clients.
- Do not add a tenant system, SSO integration, or another login method.
- Preserve phone/code authentication, demo-account selection, role routing, and server-side role/store authorization.
- Do not modify fixed shifts, scheduling constraints, store permissions, Prisma models, or the Python solver.
- Do not add third-party logos, brand colors, icons, fonts, or external visual assets.
- User-visible copy must not name the identified retail brand, cloud identity product, optimization-engine brand, or office-product brand.
- Internal provider configuration, environment-variable names, class names, and required dependency package names remain unchanged unless explicitly listed below.
- The external visual reference remains outside Git and is supplied only through `WFM_PPT_REFERENCE`.
- Use RED -> GREEN TDD for every behavior change; never update snapshots blindly.
- Do not claim legal clearance. Product naming, dependency notices, authorization evidence, and Git-history rewriting remain separate pre-release compliance work.

---

## File Structure

- `src/app/page.tsx`: render the single-column login surface and keep the existing login behavior.
- `src/app/page.test.tsx`: unit-level login semantics and third-party surface absence.
- `tests/e2e/authorization.spec.ts`: real-browser login layout and absence regression.
- `src/features/scheduling/components/GenerateStep.tsx`: neutral scheduling panel title.
- `src/features/scheduling/components/ScheduleWizardPage.test.tsx`: component regression for the neutral title.
- `src/app/api/schedule/import/validate/route.ts`: neutral malformed-workbook error text.
- `tests/integration/schedule-commands.test.ts`: route-level malformed-workbook regression.
- `prisma/seed.ts`: neutral user-visible RAG explanation that can surface in the assistant.
- `scripts/extract-ppt-reference.py`: require an explicit authorized reference path instead of embedding a local branded path.
- `tests/scripts/test_extract_ppt_reference.py`: verify explicit path configuration and synchronize the approved checklist contract.
- `tests/scripts/test_brand_neutrality.py`: scan all tracked UTF-8 text for the two prohibited legacy brands.
- `tests/visual/ppt-reference-checklist.md`: retain visual evidence without a third-party file name or local absolute path.
- `.gitignore`, `docs/WFM系统二期改造PRD_v1.0.md`, `docs/superpowers/specs/2026-07-19-wfm-desktop-web-replica-design.md`, `docs/superpowers/plans/2026-07-19-wfm-desktop-web-replica-implementation.md`: neutralize distributable historical references.
- `src/features/reports/components/ReportPages.test.tsx`: remove legacy literal-brand assertions now covered by the repository guard.

### Task 1: Single-Column Brand-Neutral Login

**Files:**
- Modify: `src/app/page.test.tsx`
- Modify: `src/app/page.tsx:44-147`
- Modify: `tests/e2e/authorization.spec.ts`

**Interfaces:**
- Consumes: existing `api<LoginResult>("/api/auth/login", { method: "POST", body: { phone, code } })` and `router.push(...)` behavior.
- Produces: a `form` with accessible name `登录账户` and a centered card identified by `data-testid="login-card"`.

- [ ] **Step 1: Write the failing unit test**

Append this test to `src/app/page.test.tsx` before the routing tests:

```tsx
it("renders only the primary login method in a centered single-column card", () => {
  render(<LoginPage />);

  expect(screen.getByRole("form", { name: "登录账户" })).toBeInTheDocument();
  expect(screen.getByTestId("login-card")).toHaveClass("max-w-lg");
  expect(screen.queryByText(/租户/)).not.toBeInTheDocument();
  expect(screen.queryByText("或使用以下方式登录")).not.toBeInTheDocument();
  expect(screen.queryByText(/企业 SSO/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("手机号")).toHaveValue("13800000001");
  expect(screen.getByLabelText("验证码")).toHaveValue("123456");
});
```

- [ ] **Step 2: Run the unit test to verify RED**

Run:

```bash
npx vitest run --config vitest.config.ts src/app/page.test.tsx
```

Expected: FAIL because the form has no accessible name, `login-card` does not exist, and the old tenant/alternate-login surface is still rendered.

- [ ] **Step 3: Add the browser-level regression before implementation**

Add this test after the imports in `tests/e2e/authorization.spec.ts`:

```ts
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
```

- [ ] **Step 4: Implement the minimal single-column login**

In `src/app/page.tsx`, replace the outer card opening and the start of the form column:

```tsx
      <div
        data-testid="login-card"
        className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-2xl"
      >
        <div className="p-8">
          <div className="mb-6 text-center">
            <h1 className="text-3xl font-bold tracking-widest text-gray-700">WFM</h1>
            <div className="mt-1 text-[12px] text-gray-400">智能排班系统 · 登录到您的账户</div>
          </div>

          <form aria-label="登录账户" onSubmit={submit} className="space-y-4">
```

Delete the complete tenant-label block before the form. Keep all fields, error handling, submit behavior, and demo-account buttons unchanged. Delete the complete right-hand alternate-login panel after the form column, then close only the remaining card and page wrapper:

```tsx
        </div>
      </div>
    </div>
```

- [ ] **Step 5: Run focused unit tests to verify GREEN**

Run:

```bash
npx vitest run --config vitest.config.ts src/app/page.test.tsx
```

Expected: all login tests PASS, including manager/admin routing.

- [ ] **Step 6: Run the real-browser login regression**

Run:

```bash
npm run test:e2e -- --grep "login stays single-column"
```

Expected: PASS at `1440x900`; card width is at most `512px`, and the tenant/alternate-login copy count is zero.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/app/page.tsx src/app/page.test.tsx tests/e2e/authorization.spec.ts
git commit -m "fix: remove third-party login branding"
```

### Task 2: Neutral User-Visible Scheduling and Import Copy

**Files:**
- Modify: `src/features/scheduling/components/ScheduleWizardPage.test.tsx`
- Modify: `src/features/scheduling/components/GenerateStep.tsx:327`
- Modify: `tests/integration/schedule-commands.test.ts`
- Modify: `src/app/api/schedule/import/validate/route.ts:25`
- Modify: `prisma/seed.ts:88-94`

**Interfaces:**
- Consumes: existing `GenerateStep` detail fetch, `Panel` title, import validation route, and RAG seed schema.
- Produces: visible title `智能排班`, malformed-file error `表格文件（.xlsx）无法解析`, and a provider-neutral assistant explanation.

- [ ] **Step 1: Write the failing scheduling-title test**

Add after `shows every legal shift for one employee on the same date` in `src/features/scheduling/components/ScheduleWizardPage.test.tsx`:

```tsx
it("uses a provider-neutral title for schedule generation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(detailResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );

  render(<GenerateStep planId="p1" readOnly={false} onPrev={() => undefined} />);

  expect(await screen.findByText("智能排班", { exact: true })).toBeInTheDocument();
  expect(screen.queryByText(/OR-Tools/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Write the failing malformed-workbook route test**

Add inside `describe("Task 5 route authorization and read models", ...)` in `tests/integration/schedule-commands.test.ts`:

```ts
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
```

- [ ] **Step 3: Run both tests to verify RED**

Run:

```bash
npx vitest run --config vitest.config.ts src/features/scheduling/components/ScheduleWizardPage.test.tsx
npm run test:integration -- tests/integration/schedule-commands.test.ts
```

Expected: the component test cannot find the exact neutral title, and the integration test receives the old malformed-workbook message.

- [ ] **Step 4: Implement the minimal copy changes**

In `src/features/scheduling/components/GenerateStep.tsx`:

```tsx
      <Panel title="智能排班">
```

In `src/app/api/schedule/import/validate/route.ts`:

```ts
    return fail("表格文件（.xlsx）无法解析", 400);
```

In `prisma/seed.ts`, keep the same rule title/category and replace only its content:

```ts
    content:
      "AI 智能排班由优化引擎计算，保证满足硬约束并尽量满足人数需求。经理可用自然语言描述偏好（如“这周多给小王排早班”），系统解析为软约束交给引擎，算完后给出自然语言解释。排班结果不足以覆盖需求时会提示人数缺口。",
```

- [ ] **Step 5: Run focused tests to verify GREEN**

Run:

```bash
npx vitest run --config vitest.config.ts src/features/scheduling/components/ScheduleWizardPage.test.tsx
npm run test:integration -- tests/integration/schedule-commands.test.ts
```

Expected: both commands PASS; import status and authorization behavior remain unchanged.

- [ ] **Step 6: Confirm no old user-facing technology labels remain in scoped sources**

Run:

```bash
rg -n 'OR-Tools 智能排班|Excel 文件无法解析' src/app src/features prisma/seed.ts
```

Expected: no output. Internal client/provider/package references outside these visible-copy patterns may remain.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/features/scheduling/components/GenerateStep.tsx src/features/scheduling/components/ScheduleWizardPage.test.tsx src/app/api/schedule/import/validate/route.ts tests/integration/schedule-commands.test.ts prisma/seed.ts
git commit -m "fix: neutralize user-facing product copy"
```

### Task 3: Repository Text Guard and Neutral Reference Handling

**Files:**
- Create: `tests/scripts/test_brand_neutrality.py`
- Modify: `scripts/extract-ppt-reference.py:14-17,308`
- Modify: `tests/scripts/test_extract_ppt_reference.py:24-87,430-470`
- Modify: `tests/visual/ppt-reference-checklist.md:13,133`
- Modify: `.gitignore:26`
- Modify: `docs/WFM系统二期改造PRD_v1.0.md:3,45`
- Modify: `docs/superpowers/specs/2026-07-19-wfm-desktop-web-replica-design.md:7,27,56`
- Modify: `docs/superpowers/plans/2026-07-19-wfm-desktop-web-replica-implementation.md:14,2338-2343`
- Modify: `src/features/reports/components/ReportPages.test.tsx:80-105`

**Interfaces:**
- Consumes: `git ls-files -z`, `WFM_PPT_REFERENCE`, the current 63-slide extraction contract, and the signed checklist byte hash.
- Produces: `BrandNeutralityTests.test_tracked_text_has_no_prohibited_legacy_brand`, `source_from_environment() -> Path`, and approved checklist SHA-256 `7d556b5cba12358c1561a7bfc73e4c180b3309644a80e6aae02654478dc2dfee`.

- [ ] **Step 1: Create the tracked-text regression guard**

Create `tests/scripts/test_brand_neutrality.py`:

```py
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
PROHIBITED_MARKERS = (
    ("legacy-retail-brand-latin", "".join(("adi", "das"))),
    ("legacy-retail-brand-cjk", "".join(("阿迪", "达斯"))),
    ("legacy-cloud-identity-brand", "".join(("azure", "ad"))),
    ("legacy-cloud-identity-brand-spaced", "".join(("azure", " ad"))),
)


class BrandNeutralityTests(unittest.TestCase):
    def test_tracked_text_has_no_prohibited_legacy_brand(self) -> None:
        result = subprocess.run(
            ["git", "ls-files", "-z"],
            cwd=REPOSITORY_ROOT,
            check=True,
            capture_output=True,
        )
        violations: list[str] = []
        for encoded_path in result.stdout.split(b"\0"):
            if not encoded_path:
                continue
            relative_path = Path(os.fsdecode(encoded_path))
            path = REPOSITORY_ROOT / relative_path
            if not path.is_file():
                continue
            try:
                text = path.read_text(encoding="utf-8").casefold()
            except UnicodeDecodeError:
                continue
            for label, marker in PROHIBITED_MARKERS:
                if marker.casefold() in text:
                    violations.append(f"{relative_path}: {label}")

        self.assertEqual(violations, [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the guard to verify RED**

Run:

```bash
python3 -m unittest tests/scripts/test_brand_neutrality.py
```

Expected: FAIL and list the current login-independent references in `.gitignore`, source-reference tooling, tests, PRD, approved design, old implementation plan, and visual checklist.

- [ ] **Step 3: Require an explicit authorized visual-reference path**

In `scripts/extract-ppt-reference.py`, delete `DEFAULT_SOURCE` and add:

```py
def source_from_environment() -> Path:
    source_value = os.environ.get("WFM_PPT_REFERENCE", "").strip()
    if not source_value:
        raise SystemExit(
            "WFM_PPT_REFERENCE must point to the authorized visual reference deck."
        )
    return Path(source_value)
```

At the start of `main()`, replace the fallback lookup with:

```py
    source = source_from_environment()
```

Add this test to `ExtractPptReferenceTests`:

```py
    def test_requires_explicit_authorized_reference_path(self) -> None:
        environment = os.environ.copy()
        environment.pop("WFM_PPT_REFERENCE", None)
        result = subprocess.run(
            ["python3", str(SCRIPT)],
            cwd=self.workspace,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "WFM_PPT_REFERENCE must point to the authorized visual reference deck",
            result.stderr,
        )
```

- [ ] **Step 4: Neutralize the checklist and synchronize its signed contract**

Use these exact checklist lines:

```md
- [x] 源文件路径仅通过 `WFM_PPT_REFERENCE` 环境变量传入；源文件未复制或提交到 Git。
- [x] 不复刻旧版参考中的第三方品牌、讲义蓝框、红色序号/手指标注或水印。
```

Mirror the same two strings in `EXPECTED_CHECKED_ITEMS` and replace `APPROVED_CHECKLIST_SHA256` with:

```py
APPROVED_CHECKLIST_SHA256 = (
    "7d556b5cba12358c1561a7bfc73e4c180b3309644a80e6aae02654478dc2dfee"
)
```

- [ ] **Step 5: Neutralize remaining distributable references**

Apply these exact replacements:

```text
.gitignore:
*_WFM排班项目_店铺经理操作手册.pptx

Approved design baseline:
**视觉与流程基准：** 由 `WFM_PPT_REFERENCE` 指向的经授权旧版视觉参考
2. 经授权旧版视觉参考中的界面与业务流程。
- 第三方企业身份登录、真实短信网关、总部十角色权限矩阵。

PRD source note:
> 基于一期 MVP 代码审计 + 经授权旧版视觉参考 + 需求澄清两轮问答产出。
以经授权旧版视觉参考为需求输入，将其移动端功能全部迁移至 Web 端，交付一个可完整演示「配置 → 预测 → 智能排班 → 打卡考勤 → 异常处理 → 换班 → 报表 → AI 反馈度量」全链路的试点级系统。

Old implementation-plan baseline:
- PPT 视觉/流程基准由 `WFM_PPT_REFERENCE` 指向经授权旧版视觉参考；已核对共 63 页。
```

Replace the old plan's Python fallback example with this complete explicit-path block:

```py
source_value = os.environ.get("WFM_PPT_REFERENCE", "").strip()
if not source_value:
    raise SystemExit(
        "WFM_PPT_REFERENCE must point to the authorized visual reference deck."
    )
source = Path(source_value)
```

Replace the two affected report tests with these brand-neutral versions; the repository guard now owns the literal-brand check:

```tsx
it("formats all monthly report hours consistently", () => {
  render(<MonthlyReportPage initialData={{
    month: "2026-07",
    rows: [{ userId: "e1", employeeName: "小王", scheduledHours: 4, workedHours: 3.6666666666666665, leaveHours: 0, correctionHours: 0, exceptionCount: 2, confirmationStatus: "unconfirmed" }],
    totals: { scheduledHours: 4, workedHours: 3.6666666666666665, leaveHours: 0, correctionHours: 0, exceptionCount: 2 },
  }} />);

  expect(screen.getAllByText("4 h")).toHaveLength(2);
  expect(screen.getAllByText("3.67 h")).toHaveLength(2);
  expect(screen.getAllByText("0 h")).toHaveLength(4);
  expect(screen.queryByText(/3\.6666666666666665/)).not.toBeInTheDocument();
});

it("renders scheduling enums in Chinese and gives every empty result table a deterministic state", () => {
  render(<SchedulingReportPage initialData={{
    ...schedulingReport("2026-07-20", "小王"),
    employeeRows: [
      { userId: "e1", employeeName: "小王", shifts: 1, hours: 4, ability: "none", performance: "frequently" },
      { userId: "e2", employeeName: "小李", shifts: 1, hours: 4, ability: "high", performance: "always" },
    ],
  }} />);

  expect(screen.getByText("无")).toBeInTheDocument();
  expect(screen.getByText("经常")).toBeInTheDocument();
  expect(within(screen.getByRole("table", { name: "员工排班报表" })).getByText("高")).toBeInTheDocument();
  expect(screen.getByText("总是达标")).toBeInTheDocument();
  expect(screen.queryByText(/none|frequently|always/)).not.toBeInTheDocument();
  expect(screen.getByText("当前周暂无岗位人力缺口")).toBeInTheDocument();
  expect(screen.getByText("当前周暂无 V2S 数据")).toBeInTheDocument();
  expect(screen.getByText("当前周暂无能力搭配数据")).toBeInTheDocument();
});
```

- [ ] **Step 6: Run the Python regressions to verify GREEN**

Run:

```bash
python3 -m unittest tests/scripts/test_brand_neutrality.py
python3 -m unittest tests/scripts/test_extract_ppt_reference.py
```

Expected: both commands PASS; the extraction test still verifies 63-slide handling, cleanup, rendering selection, CJK coverage, and checklist integrity.

- [ ] **Step 7: Run the reports tests after removing obsolete literal assertions**

Run:

```bash
npx vitest run --config vitest.config.ts src/features/reports/components/ReportPages.test.tsx
```

Expected: PASS with hours, enum localization, empty states, and loading/error behavior unchanged.

- [ ] **Step 8: Commit Task 3**

```bash
git add .gitignore scripts/extract-ppt-reference.py tests/scripts/test_extract_ppt_reference.py tests/scripts/test_brand_neutrality.py tests/visual/ppt-reference-checklist.md docs/WFM系统二期改造PRD_v1.0.md docs/superpowers/specs/2026-07-19-wfm-desktop-web-replica-design.md docs/superpowers/plans/2026-07-19-wfm-desktop-web-replica-implementation.md src/features/reports/components/ReportPages.test.tsx
git commit -m "docs: neutralize legacy reference branding"
```

## Final Verification Gate

- [ ] **Step 1: Run all unit, integration, Python, build, browser, and visual gates**

```bash
npm test
npm run test:integration
python3 -m unittest tests/scripts/test_brand_neutrality.py tests/scripts/test_extract_ppt_reference.py
npm run build
npm run test:e2e
npm run test:visual
```

Expected: every command exits `0`. Existing 18 visual baselines must pass without `--update-snapshots`; if an intended text change affects a baseline, stop and visually review that case before accepting a new image.

- [ ] **Step 2: Recheck scoped visible technical copy**

```bash
rg -n 'OR-Tools 智能排班|Excel 文件无法解析' src/app src/features prisma/seed.ts
```

Expected: no output.

- [ ] **Step 3: Verify the actual local and shared preview**

Open `/` at `1440x900` on the running local preview and the current public tunnel. Confirm the centered single-column card, phone/code labels, demo accounts, successful login, and absence of tenant/alternate-login surfaces. Save a review screenshot outside the repository under `/private/tmp/wfm-brand-removal-login-1440x900.png`.

- [ ] **Step 4: Confirm repository state and report residual compliance work**

```bash
git status --short
git log -4 --oneline
```

Expected: clean worktree and three implementation commits after the approved design/plan commits. Report dependency notices, product-name trademark clearance, authorization evidence, and historical Git cleanup as unresolved pre-release compliance items; do not describe them as completed.
