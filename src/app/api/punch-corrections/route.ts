import { fail, ok, readJson } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import type { CreatePunchCorrectionInput } from "@/lib/contracts/approvals";
import { ApprovalServiceError, createPunchCorrection, listPunchCorrections } from "@/features/approvals/server/approval-service";

function failure(error: unknown) {
  if (error instanceof ApprovalServiceError) return fail(error.message, error.status);
  throw error;
}

export async function GET() {
  const auth = await requireSession(["employee"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  try { return ok(await listPunchCorrections(auth.user)); } catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  const auth = await requireSession(["employee"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  try { return ok(await createPunchCorrection(auth.user, await readJson<CreatePunchCorrectionInput>(req)), 201); } catch (error) { return failure(error); }
}
