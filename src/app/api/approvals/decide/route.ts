import { fail, ok, readJson } from "@/lib/api";
import { requireStoreAccess } from "@/lib/authorization";
import type { ApprovalDecisionInput } from "@/lib/contracts/approvals";
import { ApprovalServiceError, decideApprovals } from "@/features/approvals/server/approval-service";

export async function POST(req: Request) {
  const body = await readJson<ApprovalDecisionInput & { leaveId?: string; aiLogId?: string }>(req);
  const access = await requireStoreAccess(["manager"], body.storeId);
  if ("error" in access) return fail(access.error, access.status);
  const input: ApprovalDecisionInput = body.items
    ? body
    : {
        storeId: body.storeId,
        items: body.leaveId ? [{ type: "leave", id: body.leaveId }] : [],
        decision: body.decision,
        reason: body.reason ?? null,
        aiLogIds: body.aiLogId ? [body.aiLogId] : [],
      };
  try {
    return ok(await decideApprovals(access.scope, input));
  } catch (error) {
    if (error instanceof ApprovalServiceError) return fail(error.message, error.status);
    throw error;
  }
}
