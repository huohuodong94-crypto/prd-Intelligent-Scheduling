import { ZodError } from "zod";

import { AttendanceServiceError, punchWithCode } from "@/features/attendance/server/attendance-service";
import { fail, ok, readJson } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { ClockCodeConfigurationError, getAttendanceNow, getClockCodeSecret } from "@/lib/config";
import { punchInputSchema } from "@/lib/contracts/attendance";

export async function POST(req: Request) {
  const auth = await requireSession(["employee"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  try {
    const input = punchInputSchema.parse(await readJson(req));
    const row = await punchWithCode(auth.user, input, getAttendanceNow(), getClockCodeSecret());
    return ok({ id: row.id, userId: row.userId, storeId: row.storeId, time: row.time.toISOString(), direction: row.direction, viaCode: true }, 201);
  } catch (error) {
    if (error instanceof ZodError) return fail(error.issues[0]?.message ?? "参数错误", 400);
    if (error instanceof AttendanceServiceError) return fail(error.message, error.status, { code: error.code });
    if (error instanceof ClockCodeConfigurationError) return fail(error.message, 500);
    throw error;
  }
}
