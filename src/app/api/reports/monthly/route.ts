import { ZodError } from "zod";

import { getMonthlyReport, ReportServiceError } from "@/features/reports/server/report-service";
import { fail, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { requireStoreAccess } from "@/lib/authorization";
import { monthlyReportQuerySchema } from "@/lib/contracts/reports";

export async function GET(request: Request) {
  const session = await requireSession(["manager", "admin"]);
  if ("error" in session) return fail(session.error, session.status);
  if (!["manager", "admin"].includes(session.user.role)) return fail("无权查看报表", 403);
  try {
    const query = monthlyReportQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const access = await requireStoreAccess(
      ["manager", "admin"],
      query.storeId,
      { adminRequiresExplicitStore: true },
    );
    if ("error" in access) return fail(access.error, access.status);
    return ok(await getMonthlyReport(access.scope, query.month));
  } catch (error) {
    if (error instanceof ZodError) return fail(error.issues[0]?.message ?? "参数错误", 400);
    if (error instanceof ReportServiceError) return fail(error.message, error.status, { code: error.code });
    throw error;
  }
}
