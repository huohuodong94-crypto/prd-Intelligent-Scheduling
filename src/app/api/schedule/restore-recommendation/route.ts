import { fail, ok, readJson } from "@/lib/api";
import { requireStoreAccess } from "@/lib/authorization";
import { versionedPlanCommandSchema } from "@/lib/contracts/scheduling";
import { restoreRecommendation, ScheduleCommandError } from "@/features/scheduling/server/schedule-command-service";

export async function POST(request: Request) {
  const access = await requireStoreAccess(["manager"]);
  if ("error" in access) return fail(access.error, access.status);
  const parsed = versionedPlanCommandSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  try {
    return ok(await restoreRecommendation(access.scope, parsed.data));
  } catch (error) {
    if (error instanceof ScheduleCommandError) return fail(error.message, error.status, { code: error.code, issues: error.issues });
    throw error;
  }
}
