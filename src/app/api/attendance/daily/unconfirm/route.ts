import { ZodError } from "zod";

import { AttendanceServiceError, unconfirmDailyExceptions } from "@/features/attendance/server/attendance-service";
import { fail, ok, readJson } from "@/lib/api";
import { requireStoreAccess } from "@/lib/authorization";
import { attendanceTransitionSchema } from "@/lib/contracts/attendance";

export async function POST(req: Request) {
  const access = await requireStoreAccess(["manager"]);
  if ("error" in access) return fail(access.error, access.status);
  try {
    const input = attendanceTransitionSchema.parse(await readJson(req));
    return ok(await unconfirmDailyExceptions(access.scope, input.items));
  } catch (error) {
    if (error instanceof ZodError) return fail(error.issues[0]?.message ?? "参数错误", 400);
    if (error instanceof AttendanceServiceError) return fail(error.message, error.status, { code: error.code });
    throw error;
  }
}
