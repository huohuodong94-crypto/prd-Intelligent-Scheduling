# CLAUDE.md — WFM 智能排班系统 · 仓库工作说明

> 本文件供 Claude Code 在本仓库工作时遵守。与《WFM系统二期改造PRD_v1.0.md》（docs/ 目录）配合使用。
> 任务清单见 `SPRINT1_TASKS.md`，按其顺序执行，**不要提前实现 Sprint 2–4 的内容**。

---

## 1. 项目是什么

零售连锁门店的 WFM 智能排班系统。核心架构哲学（不可违反）：

```
预测层（getDemandForecast 抽象）
   ▼
优化引擎层（schedule-engine/ Python + OR-Tools CP-SAT，REST）←—— 排班的唯一计算来源
   ▼
LLM 交互层（可插拔 Provider）——只做：自然语言解析 / 结果解释 / 合规建议 / RAG 问答
   ▼
应用层（Next.js 14 App Router + Prisma + SQLite/Postgres 双轨）
```

技术栈：Next.js 14.2 (App Router) + TypeScript + Tailwind｜Prisma 5｜SQLite（默认）/ PostgreSQL（docker-compose）｜Python 3.9+ / FastAPI / OR-Tools｜jose(JWT)。

## 2. 架构红线（任何任务都不得触碰）

1. **排班计算只能发生在 `schedule-engine/solver.py` 的 CP-SAT 中**。严禁让 LLM 生成、修改、"优化"任何排班分配。LLM 输出的偏好一律作为软约束参数传给引擎。
2. **AI 不自动审批**。所有 AI 合规校验只产出 `{suggestion, reason}` 建议文本，通过/驳回必须由人工接口触发。
3. **LLM Provider 抽象层不许绕过**。所有 LLM 调用必须经 `getLLM()` 工厂（`src/lib/llm/index.ts`）。禁止在业务代码里直接 fetch 任何模型 API。mock 降级机制必须保留。
4. **Prompt 即配置资产**。所有 system prompt 存放于 `/prompts/*.md`，保持五段式结构（[角色定义][权限边界][知识来源约束][输出格式约束][边界处理][记忆策略]），由 `src/lib/prompts.ts` 加载并注入占位符。禁止把 prompt 硬编码进业务代码。
5. **SQLite / Postgres 双轨兼容**：`prisma/schema.prisma`（SQLite）与 `prisma/schema.postgres.prisma` 必须同步修改。SQLite 侧禁用原生 enum 和数组（枚举用 String + 注释标注取值），embedding 一律 JSON 字符串存储，RAG 走应用层余弦（`src/lib/rag.ts`），两库共用同一套代码。
6. **班次制度锁死**：三班 4 小时（morning 09:00–13:00 / afternoon 13:00–17:00 / evening 17:00–21:00），常量在 `src/lib/config.ts` 与 `schedule-engine/solver.py` 各有一份，禁止提供班次时间编辑功能。
7. **不要在任何代码、文档、提交中写入真实 API Key**。只更新 `.env.example` 占位符。

## 3. 目录地图

```
prisma/schema.prisma            # SQLite schema（默认）
prisma/schema.postgres.prisma   # Postgres schema（必须与上者同步改）
prisma/seed.ts                  # 种子数据（Sprint 1 将全量重写）
prompts/                        # 五段式 prompt 模板（assistant / schedule_parse / schedule_explain / audit_compliance）
schedule-engine/solver.py       # CP-SAT 求解核心（Sprint 1 不改，Sprint 2 才动）
schedule-engine/main.py         # FastAPI POST /solve-schedule
schedule-engine/test_solver.py  # 引擎最小测试
src/lib/config.ts               # 集中环境变量 + 班次常量
src/lib/llm/{index,provider,anthropic,mock}.ts   # LLM 工厂与实现
src/lib/{rag,embedding}.ts      # RAG 检索 + 本地 hash embedding
src/lib/forecast.ts             # 预测层抽象 getDemandForecast()
src/lib/{aiLog,auth,api,db,dates,prompts,scheduleBuild,scheduleEngine,client}.ts
src/app/api/**/route.ts         # 15 个 API 路由
src/app/(app)/                  # 登录后页面（dashboard/attendance/leave/approvals/schedule/reports/admin）
src/components/                 # Shell + AssistantWidget
```

## 4. 已知缺陷坐标（Sprint 1 要修的债，先读懂再改）

| 缺陷 | 位置 |
|---|---|
| 埋点记录"配置的模型名"而非实际调用的 provider/模型（mock 降级时日志仍写 claude-*） | `src/lib/aiLog.ts` 的 model 字段 + 各调用点传 `config.llm.models.*`：`src/app/api/assistant/route.ts`、`src/app/api/schedule/generate/route.ts`、`src/app/api/approvals/ai-check/route.ts` |
| AI 排班按钮无防抖（实测出现 1 秒间隔 8 连击） | `src/app/(app)/schedule/` 页面组件的生成按钮；同类问题排查 assistant 发送与 ai-check 按钮 |
| `source=ai_generated` 回填矛盾（AI 采纳保存后 Schedule.source 仍全为 manual） | `src/app/api/schedule/save/route.ts` 与排班页前端保存调用的 `source` 传参链路 |
| 请假批准不扣减假期余额 | `src/app/api/approvals/decide/route.ts` |
| `lastWeekHours` seed 写死，公平性软约束失效 | `prisma/seed.ts` + `src/lib/scheduleBuild.ts`（应改为从上周 Schedule 表回算） |

## 5. 常用命令与验证

```bash
# 引擎（终端 1）
cd schedule-engine && source .venv/bin/activate && uvicorn main:app --port 8000
python test_solver.py                      # 引擎单测，任何引擎改动后必须通过

# Web（终端 2）
npm run db:reset                           # 重建库 + seed（本项目允许破坏性重建，模拟数据无保留价值）
npm run dev                                # http://localhost:3000
npx tsc --noEmit                           # 类型检查，每个任务完成后必须通过
```

登录方式：手机号 + 固定验证码 `123456`（`FIXED_OTP_CODE`），此机制保持不变。

## 6. 编码约定

- API 路由统一用 `src/lib/api.ts` 的 `ok/fail/readJson` 与 `src/lib/auth.ts` 的 `requireSession(roles?)`。
- 多表写入必须包在 `prisma.$transaction` 中。
- 入参校验用 zod（已在依赖中）。
- 枚举值以 String 存储时，必须在 schema 字段注释里列全取值。
- 中文注释，风格与现有代码一致（每个文件头部一句话说明职责）。
- 不升级 Next.js / Prisma / React 的大版本；不引入新的重型依赖（如需新依赖，先在任务产出中说明理由）。
- 每完成 SPRINT1_TASKS.md 中的一个任务：`git add -A && git commit -m "T<编号>: <摘要>"`。仓库若无 git，先 `git init` 并做基线提交。

## 7. 遇到冲突或拿不准时

规格优先级：`SPRINT1_TASKS.md` > `docs/WFM系统二期改造PRD_v1.0.md` > 本文件 > 现有代码注释。
若两份文档冲突、或实现中发现规格缺失/不合理：**停下，输出问题清单向用户确认，不要自行猜测扩大改动面**。
