# WFM 智能排班系统 · MVP

零售/连锁门店场景的智能排班 WFM 最小闭环：**真实数据库持久化 + 真实优化引擎（OR-Tools）+ 可插拔真实 LLM 调用 + AI 反馈埋点闭环**。

> 核心验证点：排班由 **Python OR-Tools CP-SAT 优化引擎**计算（绝不由 LLM 生成）；LLM 只负责自然语言解析、结果解释、合规建议与问答；每次 AI 交互都落库到 `AiInteractionLog` 以衡量效果。

---

## 架构分层

```
预测层（MVP 固定配置 store_demand_config，接口 getDemandForecast）
      │
      ▼
优化引擎层（Python + OR-Tools CP-SAT，REST: POST /solve-schedule）  ← 排班唯一计算来源
      │
      ▼
LLM 交互层（可插拔 Provider：mock / Anthropic Claude）
   · 排班：自然语言 → 结构化软约束 → 引擎求解 → 自然语言解释
   · 审批：读单据 + 合规规则 → 合规/存疑建议（人工确认，AI 不自动审批）
   · 助手：RAG 检索规则片段 + LLM 生成回答
```

技术栈：Next.js(App Router)+TypeScript+Tailwind｜Prisma｜SQLite/PostgreSQL｜Python OR-Tools｜jose(JWT)。

---

## 两种启动方式

### 方式 A：本地无 Docker（推荐先用这个跑通，默认 SQLite）

> 适用于本机没有 Docker/Postgres 的情况。数据库用 SQLite，RAG 用内存余弦检索，LLM 用 mock（无需任何 Key）。

需要：Node ≥ 18、Python ≥ 3.9。

**1) 启动优化引擎（终端 1）**
```bash
cd schedule-engine
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000
# 可先跑最小测试用例：python test_solver.py
```

**2) 启动 Web（终端 2）**
```bash
npm install
cp .env.example .env          # 默认即为 SQLite + mock，无需改动
npx prisma db push            # 建表（SQLite: prisma/dev.db）
npm run db:seed               # 灌入 2 门店/每店 5 员工 + 1 经理 + 管理员 + 规则库
npm run dev                   # http://localhost:3000
```

### 方式 B：docker-compose 一键启动（web + postgres + engine）

> 需先安装 Docker Desktop。使用 Postgres（pgvector 镜像）。

```bash
docker compose up --build
# web:    http://localhost:3000
# engine: http://localhost:8000
# db:     postgres://wfm:wfm@localhost:5432/wfm
```
容器启动时会自动 `prisma db push` + seed。

---

## 测试账号（验证码固定 `123456`）

| 角色 | 手机号 | 说明 |
|---|---|---|
| 系统管理员 | `13900000000` | 需求配置、报表 |
| 望京店经理 | `13800000001` | 李经理：审批、排班、报表 |
| 望京店员工 | `13810000001`~`13810000005` | 小王/小李/小张/小赵/小孙 |
| 中关村店经理 | `13800000002` | 王经理 |
| 中关村店员工 | `13820000001`~`13820000005` | 小周/小吴/小郑/小冯/小陈 |

---

## 体验路径（建议顺序）

1. **员工**（13810000001）：打卡 → 申请一条年假/病假 → 右下角 AI 助手问「我还有多少年假」「怎么申请病假」「去打卡」。
2. **经理**（13800000001）：审批 → 对刚才的请假单点「运行 AI 合规校验」→ 人工点通过/驳回。
3. **经理**：排班页 → 输入「这周多给小王排早班」→ 点「AI 智能排班」→ 查看引擎求解结果与 AI 解释 → 「采纳并保存」（可先手动改某格再保存）。
4. **报表**：查看本月工时汇总图表。

---

## 切换到真实 LLM / 真实向量

编辑 `.env`：
```bash
LLM_PROVIDER="anthropic"
ANTHROPIC_API_KEY="sk-ant-..."       # 填入真实 Key
# 模型名均可配置（按任务分层）：
LLM_MODEL_ASSISTANT="claude-haiku-4-5"
LLM_MODEL_SCHEDULE_PARSE="claude-sonnet-4-5"
LLM_MODEL_AUDIT_CHECK="claude-sonnet-4-5"
LLM_MODEL_SCHEDULE_EXPLAIN="claude-haiku-4-5"

# 可选：真实向量 embedding（RAG）
EMBEDDING_PROVIDER="openai"
OPENAI_API_KEY="sk-..."
```
> 未配置 Key 时会自动降级为 mock 并告警，链路仍可跑通。
> 模型 ID 请按你账号可用的实际模型替换（`.env` 中为占位默认值）。

## 切换到 PostgreSQL（本地不走 Docker 时）

1. 起一个 Postgres，改 `.env` 的 `DATABASE_URL` 为 `postgresql://...`
2. `cp prisma/schema.postgres.prisma prisma/schema.prisma`
3. `npx prisma generate && npx prisma db push && npm run db:seed`

---

## 目录结构

```
.
├─ prisma/
│  ├─ schema.prisma            # 数据模型（默认 SQLite）
│  ├─ schema.postgres.prisma   # Postgres 版本（切换用）
│  └─ seed.ts                  # 种子数据 + RAG 规则库(含 embedding)
├─ prompts/                    # 所有 system prompt 模板（五段式，独立于业务代码）
│  ├─ assistant.md             # 全局助手
│  ├─ schedule_parse.md        # 排班自然语言解析
│  ├─ schedule_explain.md      # 排班结果解释
│  └─ audit_compliance.md      # 审批合规校验
├─ schedule-engine/            # Python OR-Tools 优化引擎（独立服务）
│  ├─ solver.py                # CP-SAT 求解核心
│  ├─ main.py                  # FastAPI: POST /solve-schedule
│  └─ test_solver.py           # 最小测试用例（4 员工 / 3 天）
├─ src/
│  ├─ app/                     # Next.js App Router
│  │  ├─ page.tsx              # 登录
│  │  ├─ (app)/               # 登录后页面（共享鉴权布局 + AI 助手）
│  │  │  ├─ dashboard/ attendance/ leave/ approvals/ schedule/ reports/ admin/demand/
│  │  └─ api/                  # 后端 API Routes
│  ├─ lib/                     # db / auth / config / llm(可插拔) / embedding / rag / prompts / forecast / scheduleEngine / aiLog
│  └─ components/              # Shell 布局 / AssistantWidget 悬浮助手
├─ docker-compose.yml
└─ .env.example
```

---

## 数据模型（核心表）

`User` `Store` `AttendanceRecord` `LeaveRequest` `Schedule` `StoreDemandConfig` `RuleChunk`（RAG）、
以及反馈闭环核心表 **`AiInteractionLog`**（feature / inputText / outputText / model / wasAccepted / wasEdited）。

---

## 相对原型的技术选择说明

- **数据库双轨**：需求建议 Postgres+pgvector；因目标机无 Docker/Postgres，默认落 SQLite 保证「立即可跑」，同时保留 docker-compose 的 Postgres 方案。RAG 统一用「存 embedding + 应用层余弦」，两库同一套代码。
- **LLM 可插拔 + mock 降级**：未拿到真实 Key 前，用确定性 mock 打通全链路（含导航意图、排班解析、合规判断、结果解释），填 Key 即切真实 Claude，不改业务代码。
- **排班严格由优化引擎计算**：LLM 仅产出软约束与解释文本，硬约束（请假不排、周工时≤40h、两班间隔≥8h、满足人数需求/返回缺口）全部在 CP-SAT 中。
- **预测层留接口**：`getDemandForecast()` 抽象，MVP 用固定配置表，标注 TODO 便于接入真实预测模型。
