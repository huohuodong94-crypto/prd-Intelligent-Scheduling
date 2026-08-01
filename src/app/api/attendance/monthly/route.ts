import { ZodError } from "zod";

import { getMonthlyAttendance, MonthlyAttendanceServiceError } from "@/features/attendance/server/monthly-attendance-service";
import { fail, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { requireStoreAccess } from "@/lib/authorization";
import { monthlyQuerySchema } from "@/lib/contracts/monthly-attendance";

export async function GET(req: Request) {
  const auth = await requireSession(["employee", "manager", "admin"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  try {
    const query = monthlyQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    if (auth.user.role === "admin" && !query.storeId) return fail("管理员必须显式指定门店", 400);
    const requestedStoreId = auth.user.role === "employee" ? auth.user.storeId : query.storeId;
    const access = await requireStoreAccess([auth.user.role], requestedStoreId);
    if ("error" in access) return fail(access.error, access.status);
    const selfUserId = auth.user.role === "employee" ? auth.user.id : query.userId;
    return ok(await getMonthlyAttendance(access.scope, query.month, selfUserId));
  } catch (error) {
    if (error instanceof ZodError) return fail(error.issues[0]?.message ?? "参数错误", 400);
    if (error instanceof MonthlyAttendanceServiceError) return fail(error.message, error.status, { code: error.code, details: error.details });
    throw error;
  }
}
