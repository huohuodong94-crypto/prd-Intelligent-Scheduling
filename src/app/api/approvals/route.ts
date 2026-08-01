import { fail, ok } from "@/lib/api";
import { requireStoreAccess } from "@/lib/authorization";
import { approvalQuerySchema } from "@/lib/contracts/approvals";
import { ApprovalServiceError, listApprovals } from "@/features/approvals/server/approval-service";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = approvalQuerySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    storeId: url.searchParams.get("storeId") ?? undefined,
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "参数错误");
  const access = await requireStoreAccess(["manager", "admin"], parsed.data.storeId);
  if ("error" in access) return fail(access.error, access.status);
  try {
    return ok(await listApprovals(access.scope, parsed.data));
  } catch (error) {
    if (error instanceof ApprovalServiceError) return fail(error.message, error.status);
    throw error;
  }
}
