import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { requireStoreAccess } from "@/lib/authorization";
import { ok, fail } from "@/lib/api";
import { currentMonday, weekDays, toDateStr } from "@/lib/dates";
import { getDemandForecast } from "@/lib/forecast";
import { getLastWeekHoursMap } from "@/lib/scheduleBuild";

// 排班页初始数据：本店员工、本周需求、已存在排班。
export async function GET(req: Request) {
  const auth = await requireSession(["manager", "admin"]);
  if ("error" in auth) return fail(auth.error, auth.status);

  const url = new URL(req.url);
  const planId = url.searchParams.get("planId");
  const plan = planId
    ? await prisma.schedulePlan.findUnique({ where: { id: planId } })
    : null;
  if (planId && !plan) return fail("排班计划不存在", 404);

  const requestedStoreId = plan?.storeId ?? auth.user.storeId;
  if (!requestedStoreId) return fail("当前账号未绑定门店");
  const access = await requireStoreAccess(["manager", "admin"], requestedStoreId);
  if ("error" in access) return fail(access.error, access.status);
  const storeId = access.scope.storeId;
  const weekOf = plan?.weekOf ?? url.searchParams.get("weekOf") ?? currentMonday();
  const days = weekDays(weekOf);

  const rows = await prisma.user.findMany({
    where: { storeId, role: "employee" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  // 表格里的「上周 xH」同样按上周实际排班回算，与引擎输入保持同一口径，
  // 不再读 User.lastWeekHours 存量值
  const lastWeekHours = await getLastWeekHoursMap(
    storeId,
    weekOf,
    rows.map((e) => e.id)
  );
  const employees = rows.map((e) => ({
    ...e,
    lastWeekHours: lastWeekHours.get(e.id) ?? 0,
  }));

  const schedules = await prisma.schedule.findMany({
    where: plan ? { storeId, planId: plan.id } : { storeId, weekOf },
    include: { user: { select: { name: true } } },
  });

  const demand = await getDemandForecast(storeId, days);

  return ok({
    plan: plan ? {
      id: plan.id,
      storeId: plan.storeId,
      weekOf: plan.weekOf,
      status: plan.status,
      version: plan.version,
      publishedAt: plan.publishedAt?.toISOString() ?? null,
    } : null,
    weekOf,
    days,
    employees,
    demand,
    schedules: schedules.map((s) => ({
      id: s.id,
      userId: s.userId,
      userName: s.user.name,
      // 用本地日期格式化：date 存的是本地午夜，toISOString() 会按 UTC 退一天
      date: toDateStr(s.date),
      shiftType: s.shiftType,
      source: s.source,
    })),
  });
}
