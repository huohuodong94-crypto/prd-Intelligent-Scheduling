import { fail, ok, readJson } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { acceptTargetSwapSchema, createShiftSwapSchema } from "@/lib/contracts/approvals";
import { ApprovalServiceError, acceptTargetSwap, createShiftSwap, listShiftSwaps } from "@/features/approvals/server/approval-service";

function failure(error: unknown) {
  if (error instanceof ApprovalServiceError) return fail(error.message, error.status);
  throw error;
}

export async function GET() {
  const auth = await requireSession(["employee"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  try {
    const rows = await listShiftSwaps(auth.user);
    return ok(rows.map((row) => ({ ...row, currentUserId: auth.user.id })));
  } catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  const auth = await requireSession(["employee"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  const body = await readJson<unknown>(req);
  try {
    if (typeof body === "object" && body !== null && "action" in body) {
      const parsed = acceptTargetSwapSchema.safeParse(body);
      if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "参数错误", 400);
      return ok(await acceptTargetSwap(auth.user, parsed.data.requestId));
    }
    const parsed = createShiftSwapSchema.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "参数错误", 400);
    return ok(await createShiftSwap(auth.user, parsed.data), 201);
  } catch (error) { return failure(error); }
}
