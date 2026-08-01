import { fail } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { requireStoreAccess } from "@/lib/authorization";
import { prisma } from "@/lib/db";
import { exportScheduleWorkbook, ScheduleCommandError } from "@/features/scheduling/server/schedule-command-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireSession(["manager", "admin"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  const planId = new URL(request.url).searchParams.get("planId");
  if (!planId) return fail("缺少 planId", 400);
  const plan = await prisma.schedulePlan.findUnique({ where: { id: planId } });
  if (!plan) return fail("排班计划不存在", 404);
  const access = await requireStoreAccess(["manager", "admin"], plan.storeId);
  if ("error" in access) return fail(access.error, access.status);
  try {
    const workbook = await exportScheduleWorkbook(access.scope, planId);
    return new Response(workbook, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="schedule-${plan.weekOf}.xlsx"` } });
  } catch (error) {
    if (error instanceof ScheduleCommandError) return fail(error.message, error.status, { code: error.code });
    throw error;
  }
}
