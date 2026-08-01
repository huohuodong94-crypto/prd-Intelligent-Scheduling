import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, fail, readJson } from "@/lib/api";
import { getLLM } from "@/lib/llm";
import { config } from "@/lib/config";
import { retrieveRules } from "@/lib/rag";
import { assistantPrompt, ROLE_FEATURES, ROLE_LABELS } from "@/lib/prompts";
import { logAiInteraction } from "@/lib/aiLog";

// 全局 AI 助手：RAG 检索业务规则 → 交给 LLM 生成回答 → 记录埋点。
export async function POST(req: Request) {
  const auth = await requireSession();
  if ("error" in auth) return fail(auth.error, auth.status);
  const { message } = await readJson<{ message: string }>(req);
  if (!message?.trim()) return fail("请输入问题");

  // 1. RAG 检索
  const chunks = await retrieveRules(message, 3);
  const ruleText =
    chunks.length > 0
      ? chunks.map((c, i) => `【片段${i + 1}·${c.title}】${c.content}`).join("\n")
      : "（未检索到相关规则）";

  // 2. 组装结构化 system prompt（五段式，来自 /prompts 模板）
  const system = assistantPrompt({
    role: ROLE_LABELS[auth.user.role] || auth.user.role,
    allowedFeatures: ROLE_FEATURES[auth.user.role] || "基础功能",
    ruleChunks: ruleText,
  });

  // 供 mock provider 使用的结构化上下文（真实 provider 忽略）
  const me = await prisma.user.findUnique({ where: { id: auth.user.id } });

  const llm = getLLM();
  const res = await llm.complete({
    system,
    user: message,
    model: config.llm.models.assistant,
    feature: "assistant",
    mockContext: {
      chunks,
      leaveBalance: me
        ? { annual: me.annualLeaveBalance, sick: me.sickLeaveBalance }
        : undefined,
    },
  });
  const output = res.text;

  // 3. 埋点记录（provider/model 取实际调用结果，降级为 mock 时如实记录）
  const logId = await logAiInteraction({
    userId: auth.user.id,
    feature: "assistant",
    provider: res.provider,
    model: res.model,
    inputText: message,
    outputText: output,
  });

  // 4. 尝试解析导航意图
  let action: { action: string; target: string } | null = null;
  try {
    const parsed = JSON.parse(output);
    if (parsed?.action === "navigate" && parsed?.target) action = parsed;
  } catch {
    /* 纯文本回答 */
  }

  return ok({
    reply: action ? `正在为你跳转到 ${action.target}` : output,
    action,
    aiLogId: logId,
    retrieved: chunks.map((c) => ({ title: c.title, score: Number(c.score.toFixed(3)) })),
  });
}
