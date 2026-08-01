# SPRINT1_TASKS.md — Sprint 1 任务清单（地基与还债）

> 执行者：Claude Code。先通读 `CLAUDE.md` 与 `docs/WFM系统二期改造PRD_v1.0.md`（下称 PRD），再按 T1→T13 顺序执行。
> 每个任务完成后：跑该任务的「验收」命令，通过后 git commit，再进入下一任务。
> **本 Sprint 不实现**：排班四步向导、引擎 v2 约束、预测页面、动态码、换班/补卡流程、报表——那些属于 Sprint 2–4。本 Sprint 只做：数据层、LLM 层、缺陷修复、种子数据。
> 已锁定决策（不要再问）：允许 `db push --force-reset` 破坏性重建；换班仅限同岗位（无技能字段）；新员工阈值经 `SENIORITY_MONTHS` 配置（默认 6）；兼职员工周上限 24h。

---

## T1 · Git 基线

若仓库无 `.git`：`git init`，创建 `.gitignore`（node_modules、.venv、.env、prisma/dev.db、.next、tsconfig.tsbuildinfo），基线提交 `chore: baseline before sprint 1`。

**验收**：`git log --oneline` 有基线提交；`git status` 干净。

---

## T2 · Prisma schema 全量迁移（本 Sprint 最大任务，先做，后续任务全依赖它）

同步修改 `prisma/schema.prisma` 与 `prisma/schema.postgres.prisma`。以 PRD §7 为准，本任务给出精确字段规格：

**修改 `User`**：
- `position String?` — cashier | sales；manager 与 admin 为 null（店长不排班，不占人力）
- `hireDate DateTime @default(now())`
- `employmentType String @default("fulltime")` — fulltime | parttime
- `maxWeeklyHours Float @default(40)` — 兼职 seed 为 24
- `salesAbility String @default("none")` — high | mid | low | none
- `performanceBand String @default("frequently")` — always | almost_always | frequently | sometimes | rarely
- 保留 `lastWeekHours` 字段但语义变更：不再由 seed 决定业务值（见 T9）

**修改 `AttendanceRecord`**：`checkInTime` 重命名为 `time`；新增 `direction String @default("in")`（in | out）、`viaCode Boolean @default(false)`、`corrected Boolean @default(false)`。

**修改 `Schedule`**：新增 `planId String?`；`source` 注释扩为 manual | ai_generated | swap。

**修改 `AiInteractionLog`**：新增 `provider String?`（实际调用的 provider 名）、`editedCells Int?`、`totalCells Int?`、`editRatio Float?`。

**删除 `StoreDemandConfig`**（连同 seed 与 `src/lib/forecast.ts` 中的引用——forecast 本 Sprint 先改为读 `MinStaffingConfig` 的兜底人数返回，保证现有排班接口不报错，真正的预测链路属于 Sprint 2；在 forecast.ts 标注 `TODO(Sprint2)`）。

**新增表**（字段类型自行按 Prisma 惯例补齐 id/createdAt/关系与索引；枚举一律 String+注释）：
- `SchedulePlan`：storeId, weekOf(String YYYY-MM-DD), mode(work5rest2|work6rest1), status(draft|published), createdById；`@@unique([storeId, weekOf])`
- `V2SConfig`：storeId, dayOfWeek(Int 0-6), v2sLower(Float), v2sUpper(Float)；`@@unique([storeId, dayOfWeek])`
- `MinStaffingConfig`：storeId, dayOfWeek, timeSlot(morning|afternoon|evening), position(cashier|sales), minHeadcount(Int)；`@@unique([storeId, dayOfWeek, timeSlot, position])`
- `StoreEvent`：storeId, date(DateTime), label(promo|new_arrival|holiday), factor(Float)；`@@unique([storeId, date, label])`
- `TrafficRecord`：storeId, date, timeSlot, visitors(Int)；`@@unique([storeId, date, timeSlot])`
- `TrafficForecast`：planId, date, timeSlot, predicted(Float), adjusted(Float?), adjustReason(String?)；`@@unique([planId, date, timeSlot])`
- `UnavailableSlot`：userId, date, timeSlot, reason(String?)；`@@unique([userId, date, timeSlot])`
- `PunchCorrection`：userId, date, direction(in|out), requestedTime(DateTime), reason, status(pending|approved|rejected), decidedById(String?)
- `ShiftSwapRequest`：requesterId, targetUserId, reqScheduleId, tgtScheduleId, status(pending_target|pending_manager|approved|rejected), engineCheckResult(String? JSON), aiSuggestion(String?), aiReason(String?), decidedById(String?)

**验收**：`npx prisma format && npx prisma db push --force-reset` 无报错；`npx tsc --noEmit` 通过（允许 seed 暂时报错，T11 修复前可先给 seed 打最小补丁保证编译）。两份 schema 文件 diff 后模型结构一致（仅 datasource 差异）。

---

## T3 · config.ts 扩展

`src/lib/config.ts`：
- `llm.provider` 支持取值 `deepseek`；新增 `deepseekApiKey`（env `DEEPSEEK_API_KEY`）、`deepseekBaseUrl`（env `DEEPSEEK_BASE_URL`，默认 `https://api.deepseek.com`）
- `llm.models` 四个点位默认值全部改为 `deepseek-chat`；新增第五点位 `swapCheck`（env `LLM_MODEL_SWAP_CHECK`，默认 `deepseek-chat`）
- `scheduling.minRestHours` 的**默认值由 8 改为 4**（决策 D3；现有引擎已参数化，改默认值即可让「早+晚」同日组合生效）
- 新增 `scheduling.seniorityMonths`（env `SENIORITY_MONTHS`，默认 6）
- 新增导出 `POSITIONS = ["cashier","sales"]`、`POSITION_LABELS`（收银/销售）

**验收**：`npx tsc --noEmit` 通过。

---

## T4 · DeepSeek Provider

新增 `src/lib/llm/deepseek.ts`，注册进 `src/lib/llm/index.ts` 工厂：
- OpenAI 兼容格式：`POST {deepseekBaseUrl}/chat/completions`，header `Authorization: Bearer <key>`，body `{model, messages:[{role:"system"},{role:"user"}], max_tokens: 1024}`
- `req.jsonMode === true` 时附加 `response_format: {type:"json_object"}` 并设 `temperature: 0.2`；否则 feature 为 `schedule_explain` 时 `temperature: 0.5`，`assistant` 时 `0.7`
- 响应取 `choices[0].message.content`，trim 后返回；非 2xx 抛错并带响应文本
- 工厂逻辑：`LLM_PROVIDER=deepseek` 且有 Key → DeepseekProvider；无 Key → console.warn 降级 mock（沿用 anthropic 的降级模式）。AnthropicProvider 保留不删。
- 不引入任何 SDK，直接 fetch（与现有 anthropic.ts 风格一致）

**验收**：`npx tsc --noEmit` 通过；`.env` 配置 `LLM_PROVIDER=deepseek` + 假 Key 时启动不崩、调用时报可读错误；配真 Key 时（由用户手动验证）assistant 问答返回真实模型输出。

---

## T5 · 埋点修复：记录实际 provider 与模型

- `LLMProvider` 接口（`src/lib/llm/provider.ts`）：`complete` 的返回改为 `{ text: string; provider: string; model: string }`（mock 返回 `provider:"mock", model:"mock"`；deepseek/anthropic 返回真实值）。同步改三个实现与所有调用点。
- `logAiInteraction`（`src/lib/aiLog.ts`）新增 `provider` 参数写入 T2 的新字段；`model` 一律写 complete 返回的实际模型。
- 排查三个调用点（assistant / schedule/generate / approvals/ai-check）全部改用返回的实际值，不再传 `config.llm.models.*` 进日志。

**验收**：未配 Key 状态下发一条助手消息，查库：`sqlite3 prisma/dev.db "SELECT provider, model FROM AiInteractionLog ORDER BY createdAt DESC LIMIT 1"` 返回 `mock|mock`（而非 claude-* 或 deepseek-*）。

---

## T6 · 前端 AI 按钮防抖

排班页「AI 智能排班」、审批页「运行 AI 合规校验」、助手发送按钮：请求进行中 `disabled` + loading 态（转圈或文案「生成中…」），完成或失败后恢复。禁止用 setTimeout 假防抖，必须以请求状态为准。

**验收**：手动连点排班生成按钮 5 次，`AiInteractionLog` 只新增 1 组记录（可查库确认）。

---

## T7 · source=ai_generated 回填修复

排查排班页前端「采纳并保存」调用 `/api/schedule/save` 的传参：AI 推荐来源必须传 `source:"ai_generated"` 与 `aiLogId/parseLogId`；纯手动保存传 `source:"manual"`。修复传参断点（一期实测 35 条排班全为 manual 但存在采纳日志，矛盾点大概率在前端状态未携带 source 或保存时被覆写）。

**验收**：走一遍「AI 生成 → 采纳并保存」，查库 `SELECT DISTINCT source FROM Schedule` 出现 `ai_generated`，且对应 AiInteractionLog 的 `wasAccepted=1`。

---

## T8 · 请假余额闭环

`src/app/api/approvals/decide/route.ts`：批准年假/病假时，在同一 `$transaction` 内按 `hours` 扣减对应余额；驳回不扣。
`src/app/api/leave/route.ts`：提交时校验余额充足，不足则 `fail("余额不足")`（对齐规则库「年假余额不足时无法提交」）。

**验收**：为某员工提交 16h 年假并批准，查库余额减 16；再提交超余额申请被拒绝提交。

---

## T9 · lastWeekHours 真实回算

`src/lib/scheduleBuild.ts` 的 `buildEmployeesWithUnavailable`：`last_week_hours` 不再读 User 表存量字段，改为实时查询上一周（weekOf 减 7 天）该员工已保存 Schedule 条数 × `config.scheduling.shiftHours`。User.lastWeekHours 字段保留但仅作缓存展示用（可同时回写）。

**验收**：为上周手动保存若干班次后触发排班生成，通过引擎请求日志或临时断点确认传入的 `last_week_hours` 等于上周班次数×4。

---

## T10 · 角色岗位两层模型落地

- 全站类型与 UI：员工列表、审批单、排班表格中展示岗位徽标（收银/销售）；店长/管理员无岗位。
- `buildEmployeesWithUnavailable` 只返回 `position != null` 的员工（**店长从排班员工集合中剔除**，决策 D4），并在返回结构中带上 `position`、`max_weekly_hours`（读 User.maxWeeklyHours）。
- 权限矩阵按 PRD §2.3 核对现有路由的 `requireSession` 角色数组，修正不一致处（本 Sprint 不新增页面，只对既有页面校准）。

**验收**：店长账号不出现在排班生成结果与排班表格行中；`npx tsc --noEmit` 通过。

---

## T11 · seed 全量重构

重写 `prisma/seed.ts`：
- **10 家门店**：望京、中关村、三里屯、西单、国贸、五道口、朝阳大悦城、王府井、亦庄、回龙观。
- **账号**：1 名 admin；每店 1 店长 + 10~14 名员工（收银 2–3 人，其余销售）。手机号编码规则自行设计（必须唯一、有规律、易演示），并把完整账号表写进 README（T13）。验证码固定 123456 不变。
- **员工属性分布**：新员工（hireDate 距今 ≤ SENIORITY_MONTHS）约 25%；兼职约 20%（`employmentType=parttime, maxWeeklyHours=24`）；salesAbility 高 20%/中 50%/低 25%/无 5%；performanceBand 正态偏中（frequently 最多）。
- **配置数据**：每店 V2SConfig（周一~周四 30/60，周五 35/70，周末 40/80）；每店 MinStaffingConfig（收银各班次 1；销售早/午/晚 2，周六周日各 +1）。
- **8 周历史客流** `TrafficRecord`：严格按 PRD §4.1 公式（base 每店 80–150 随机、dow 系数、shiftFactor 早 0.8/午 1.2/晚 1.0、活动系数、正态噪声 σ=0.1，向下取整且 ≥0）。
- **活动日历**：每店未来 4 周内随机 3–5 条 `StoreEvent`（promo 1.3 / new_arrival 1.15 / holiday 1.4），历史 8 周内也撒 2–3 条使客流数据含事件效应。
- **RAG 规则库扩至约 20 条**：保留原 8 条（其中「排班规则」条目更新：休息间隔改为 4 小时、注明一天最多早+晚两班、注明做五休二/做六休一模式），新增：动态码打卡规则、补卡申请流程、换班流程与同岗位限制、不可供班登记说明、新老员工搭班规则、迟到/早退/缺卡判定标准、兼职工时上限、店长不参与排班说明、V2S 与人力预测说明、活动日历说明、AI 指标与反馈说明、隐私与数据说明。内容依据 PRD 对应章节撰写，每条 100–200 字，风格与原 8 条一致，embedding 用现有 `embed()` 生成。

**验收**：`npm run db:reset` 成功；查库：Store=10、User=admin+10店长+员工总数在 100~140 区间、TrafficRecord 条数 = 10店×56天×3班次 = 1680、RuleChunk≈20；随机登录 2 家店的店长与员工账号可进入系统。

---

## T12 · swap_check prompt 模板

新增 `prompts/swap_check.md`（Sprint 3 才接入调用，本 Sprint 只备好模板与加载器）：
- 严格五段式；角色定义为「换班合规校验助手」；权限边界写明严禁自主批准换班
- 占位符：`{{ruleChunks}}`（规则片段）、`{{swapDetail}}`（换班双方、班次、引擎校验结果 engineCheckResult）
- 输出格式：仅 JSON `{"suggestion":"compliant"|"suspicious","reason":"<中文，60字内>"}`；引擎校验已含违规项时必须输出 suspicious 并引用违规原因
- `src/lib/prompts.ts` 注册加载函数 `swapCheckPrompt()`，风格对齐现有四个

**验收**：`npx tsc --noEmit` 通过；`node -e` 或临时脚本调用 `swapCheckPrompt` 能正确渲染占位符。

---

## T13 · 环境变量与 README 更新

- `.env.example`：新增 `DEEPSEEK_API_KEY=""`、`DEEPSEEK_BASE_URL="https://api.deepseek.com"`、`LLM_PROVIDER="mock"`（注释说明可切 deepseek/anthropic）、五个模型点位默认 `deepseek-chat`、`MIN_REST_HOURS=4`、`SENIORITY_MONTHS=6`
- `README.md`：更新架构说明（DeepSeek 优先）、10 店账号表（来自 T11）、休息间隔 4h 规则说明、体验路径保持一期风格但账号替换
- docker-compose.yml 环境变量段同步补齐 DeepSeek 变量透传

**验收**：按 README 从零走一遍「方式 A 本地启动」全部命令成功；`grep -r "sk-" --include="*.ts" --include="*.md" src prompts README.md` 无任何真实 Key。

---

## 最终回归（全部任务完成后）

1. `cd schedule-engine && python test_solver.py` 通过（本 Sprint 未改引擎，应天然通过）
2. `npx tsc --noEmit` 零错误
3. `npm run db:reset && npm run dev`，用新账号完整走：员工打卡 → 请假（余额校验）→ 店长 AI 合规 → 批准（余额扣减）→ AI 排班生成（防抖生效）→ 采纳保存（source=ai_generated + 埋点 provider 正确）
4. `git log --oneline` 呈现 T1~T13 的独立提交
5. 输出一份《Sprint 1 完成报告》：每任务状态、遇到的规格偏差、给 Sprint 2 的遗留事项
