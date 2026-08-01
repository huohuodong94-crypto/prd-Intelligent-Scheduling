import { fail, ok, readJson } from "@/lib/api";
import { requireStoreAccess } from "@/lib/authorization";
import { saveDraftSchema } from "@/lib/contracts/scheduling";
import { saveDraft, ScheduleCommandError } from "@/features/scheduling/server/schedule-command-service";

export async function POST(request: Request) {
  const access = await requireStoreAccess(["manager"]);
  if ("error" in access) return fail(access.error, access.status);
  const parsed = saveDraftSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  try {
    return ok(await saveDraft(access.scope, { planId: parsed.data.planId, version: parsed.data.version, assignments: parsed.data.assignments, source: parsed.data.source }));
  } catch (error) {
    if (error instanceof ScheduleCommandError) return fail(error.message, error.status, { code: error.code, issues: error.issues });
    throw error;
  }
}
