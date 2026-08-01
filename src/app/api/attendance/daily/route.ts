import { ZodError } from "zod";

import { AttendanceServiceError, listDailyAttendance } from "@/features/attendance/server/attendance-service";
import { fail, ok } from "@/lib/api";
import { readJson } from "@/lib/api";
import { requireStoreAccess } from "@/lib/authorization";
import { getAttendanceNow } from "@/lib/config";
import { dailyAttendanceQuerySchema, proxyAttendanceRequestSchema } from "@/lib/contracts/attendance";
import { ApprovalServiceError, createManagerProxyApproval } from "@/features/approvals/server/approval-service";

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(getAttendanceNow());
}

export async function GET(req: Request) {
  try {
    const raw = Object.fromEntries(new URL(req.url).searchParams);
    const query = dailyAttendanceQuerySchema.parse({ ...raw, from: raw.from || today(), to: raw.to || raw.from || today() });
    const access = await requireStoreAccess(["manager", "admin"], query.storeId);
    if ("error" in access) return fail(access.error, access.status);
    if (access.scope.user.role === "admin" && !query.storeId) return fail("管理员必须显式指定门店", 400);
    return ok(await listDailyAttendance(access.scope, { ...query, from: query.from!, to: query.to! }));
  } catch (error) {
    if (error instanceof ZodError) return fail(error.issues[0]?.message ?? "参数错误", 400);
    if (error instanceof AttendanceServiceError) return fail(error.message, error.status, { code: error.code });
    throw error;
  }
}

export async function POST(req: Request) {
  const access = await requireStoreAccess(["manager"]);
  if ("error" in access) return fail(access.error, access.status);
  try {
    const input = proxyAttendanceRequestSchema.parse(await readJson(req));
    return ok(await createManagerProxyApproval(access.scope, input), 201);
  } catch (error) {
    if (error instanceof ZodError) return fail(error.issues[0]?.message ?? "参数错误", 400);
    if (error instanceof ApprovalServiceError) return fail(error.message, error.status, { code: error.code });
    throw error;
  }
}
