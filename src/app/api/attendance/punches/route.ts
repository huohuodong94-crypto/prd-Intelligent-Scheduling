import { ZodError } from "zod";

import { AttendanceServiceError, listPunches } from "@/features/attendance/server/attendance-service";
import { fail, ok } from "@/lib/api";
import { requireStoreAccess } from "@/lib/authorization";
import { punchHistoryQuerySchema } from "@/lib/contracts/attendance";

export async function GET(req: Request) {
  try {
    const query = punchHistoryQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const access = await requireStoreAccess(["manager", "admin"], query.storeId);
    if ("error" in access) return fail(access.error, access.status);
    if (access.scope.user.role === "admin" && !query.storeId) return fail("管理员必须显式指定门店", 400);
    return ok(await listPunches(access.scope, query));
  } catch (error) {
    if (error instanceof ZodError) return fail(error.issues[0]?.message ?? "参数错误", 400);
    if (error instanceof AttendanceServiceError) return fail(error.message, error.status, { code: error.code });
    throw error;
  }
}
