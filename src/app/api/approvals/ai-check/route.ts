import { fail, ok, readJson } from "@/lib/api";
import { requireStoreAccess } from "@/lib/authorization";
import { approvalAiCheckSchema, type ApprovalType } from "@/lib/contracts/approvals";
import { config } from "@/lib/config";
import { getLLM } from "@/lib/llm";
import { auditCompliancePrompt } from "@/lib/prompts";
import { retrieveRules } from "@/lib/rag";
import {
  ApprovalServiceError,
  getApprovalAiContext,
  normalizeAiAdvice,
  saveApprovalAdvice,
} from "@/features/approvals/server/approval-service";

export async function POST(req: Request) {
  const raw = await readJson<{ id?: string; type?: ApprovalType; storeId?: string; leaveId?: string }>(req);
  const parsed = approvalAiCheckSchema.safeParse({
    id: raw.id ?? raw.leaveId,
    type: raw.type ?? (raw.leaveId ? "leave" : undefined),
    storeId: raw.storeId,
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "参数错误");
  const access = await requireStoreAccess(["manager"], parsed.data.storeId);
  if ("error" in access) return fail(access.error, access.status);
  try {
    const identity = { id: parsed.data.id, type: parsed.data.type };
    const context = await getApprovalAiContext(access.scope, identity);
    const chunks = await retrieveRules(context.query, 3);
    const ruleChunks = chunks.map((chunk) => `【${chunk.title}】${chunk.content}`).join("\n");
    const system = auditCompliancePrompt({ ruleChunks, approvalType: identity.type, approvalDetail: context.detail });
    const response = await getLLM().complete({
      system,
      user: "请对上述审批单给出合规校验建议。",
      model: config.llm.models.auditCheck,
      feature: "audit_check",
      jsonMode: true,
      mockContext: context.mockContext,
    });
    const advice = normalizeAiAdvice(response.text);
    const aiLogId = await saveApprovalAdvice(access.scope, identity, advice, {
      provider: response.provider,
      model: response.model,
      inputText: context.detail,
      outputText: JSON.stringify(advice),
    });
    return ok({ ...advice, aiLogId });
  } catch (error) {
    if (error instanceof ApprovalServiceError) return fail(error.message, error.status);
    throw error;
  }
}
