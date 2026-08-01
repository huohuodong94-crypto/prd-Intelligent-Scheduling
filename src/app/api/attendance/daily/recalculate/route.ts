import { ZodError } from "zod";

import { AttendanceServiceError, recalculateDailyAttendance } from "@/features/attendance/server/attendance-service";
import { fail, ok, readJson } from "@/lib/api";
import { requireStoreAccess } from "@/lib/authorization";
import { recalculateAttendanceSchema } from "@/lib/contracts/attendance";

export async function POST(req: Request) {
  const access = await requireStoreAccess(["manager"]);
  if ("error" in access) return fail(access.error, access.status);
  try { return ok(await recalculateDailyAttendance(access.scope, recalculateAttendanceSchema.parse(await readJson(req)))); }
  catch (error) {
    if (error instanceof ZodError) return fail(error.issues[0]?.message ?? "参数错误", 400);
    if (error instanceof AttendanceServiceError) return fail(error.message, error.status, { code: error.code });
    throw error;
  }
}
