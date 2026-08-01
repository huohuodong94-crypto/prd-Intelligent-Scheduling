import { ZodError } from "zod";

import { MonthlyAttendanceServiceError, unconfirmMonthlyAttendance } from "@/features/attendance/server/monthly-attendance-service";
import { fail, ok, readJson } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { requireStoreAccess } from "@/lib/authorization";
import { monthlyUnconfirmSchema } from "@/lib/contracts/monthly-attendance";

export async function POST(req: Request) {
  const auth = await requireSession(["manager"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  try {
    const input = monthlyUnconfirmSchema.parse(await readJson(req));
    const access = await requireStoreAccess(["manager"], input.storeId);
    if ("error" in access) return fail(access.error, access.status);
    return ok(await unconfirmMonthlyAttendance(access.scope, input));
  } catch (error) {
    if (error instanceof ZodError) return fail(error.issues[0]?.message ?? "参数错误", 400);
    if (error instanceof MonthlyAttendanceServiceError) return fail(error.message, error.status, { code: error.code, details: error.details });
    throw error;
  }
}
