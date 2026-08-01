import { fail } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { requireStoreAccess } from "@/lib/authorization";
import { POSITIONS } from "@/lib/config";
import { prisma } from "@/lib/db";
import { createScheduleTemplate, type ImportEmployee } from "@/features/scheduling/server/import-parser";

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
  const rows = await prisma.user.findMany({
    where: { storeId: plan.storeId, role: "employee", employeeNo: { not: null }, position: { in: [...POSITIONS] } },
    select: { id: true, employeeNo: true, name: true, position: true },
    orderBy: { employeeNo: "asc" },
  });
  const employees: ImportEmployee[] = rows.map((row) => ({ id: row.id, employeeNo: row.employeeNo!, name: row.name, position: row.position as ImportEmployee["position"] }));
  const workbook = await createScheduleTemplate(plan.weekOf, employees);
  const body = new Uint8Array(workbook.byteLength);
  body.set(workbook);
  return new Response(body, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="schedule-${plan.weekOf}.xlsx"` } });
}
