import { prisma } from "./db";
import type { LLMFeature } from "./llm";

// AiInteractionLog 埋点 —— 反馈闭环的核心。
// 每次 AI 交互都记录：输入、输出、实际 provider/模型、是否采纳、是否人工修改。
// 注意：provider/model 必须取自 complete() 的返回值（实际调用结果），
//       不能传 config.llm.models.*（那是「期望的」模型名，mock 降级时会失真）。

type Feature = "assistant" | "schedule_advisor" | "audit_checker";

export async function logAiInteraction(params: {
  userId?: string | null;
  storeId?: string | null;
  planId?: string | null;
  eventKind?: string | null;
  feature: Feature;
  provider?: string;
  model?: string;
  inputText: string;
  outputText: string;
  wasAccepted?: boolean | null;
  wasEdited?: boolean | null;
}): Promise<string> {
  const log = await prisma.aiInteractionLog.create({
    data: {
      userId: params.userId ?? null,
      storeId: params.storeId ?? null,
      planId: params.planId ?? null,
      eventKind: params.eventKind ?? null,
      feature: params.feature,
      provider: params.provider ?? null,
      model: params.model ?? null,
      inputText: params.inputText,
      outputText: params.outputText,
      wasAccepted: params.wasAccepted ?? null,
      wasEdited: params.wasEdited ?? null,
    },
  });
  return log.id;
}

// 用户对某条 AI 输出给出反馈（采纳/修改）时回填
export async function updateAiFeedback(
  id: string,
  feedback: { wasAccepted?: boolean; wasEdited?: boolean }
): Promise<void> {
  await prisma.aiInteractionLog.update({
    where: { id },
    data: feedback,
  });
}

// 映射 LLM feature -> 日志 feature
export function llmFeatureToLog(f: LLMFeature): Feature {
  if (f === "assistant") return "assistant";
  if (f === "audit_check") return "audit_checker";
  return "schedule_advisor";
}
