import { fail, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { localDateSchema } from "@/lib/contracts/scheduling";
import { prisma } from "@/lib/db";
import { toDateStr } from "@/lib/dates";

export async function GET(request: Request) {
  const auth = await requireSession(["employee"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  if (!auth.user.storeId) return fail("当前账号未绑定门店", 400);
  const parsed = localDateSchema.safeParse(new URL(request.url).searchParams.get("weekOf"));
  if (!parsed.success) return fail("weekOf 格式错误", 400);
  const schedules = await prisma.schedule.findMany({
    where: { userId: auth.user.id, storeId: auth.user.storeId, weekOf: parsed.data, plan: { status: "published" } },
    orderBy: [{ date: "asc" }, { shiftType: "asc" }],
  });
  const rows = schedules.map((row) => ({ date: toDateStr(row.date), shiftType: row.shiftType, hours: 4 }));
  return ok({ weekOf: parsed.data, rows, totalHours: rows.length * 4 });
}
