import { fail, ok, readJson } from "@/lib/api";
import { requireStoreAccess } from "@/lib/authorization";
import { assignmentSchema, versionedPlanCommandSchema } from "@/lib/contracts/scheduling";
import { publishSchedule, ScheduleCommandError } from "@/features/scheduling/server/schedule-command-service";

const schema = versionedPlanCommandSchema.extend({ assignments: assignmentSchema.array() });

export async function POST(request: Request) {
  const access = await requireStoreAccess(["manager"]);
  if ("error" in access) return fail(access.error, access.status);
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  try {
    return ok(await publishSchedule(access.scope, parsed.data));
  } catch (error) {
    if (error instanceof ScheduleCommandError) return fail(error.message, error.status, { code: error.code, issues: error.issues });
    throw error;
  }
}
