import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, fail, readJson } from "@/lib/api";
import { SHIFTS } from "@/lib/config";
import { localDateSchema } from "@/lib/contracts/scheduling";
import { mondayOf, toDateStr } from "@/lib/dates";
import {
  PlanDomainError,
  invalidatePlansForDate,
  mutatePlanInput,
} from "@/features/scheduling/server/plan-service";

// 不可供班登记（向导 Step 1）：员工自助提交，店长可代为增删。
// 引擎会把这些时段作为硬约束，不排班。
const addSchema = z.object({
  planId: z.string().min(1).optional(),
  version: z.number().int().min(0).optional(),
  userId: z.string().min(1).optional(),
  date: localDateSchema,
  timeSlot: z.enum(SHIFTS),
  reason: z.string().max(100).optional(),
});

export async function POST(req: Request) {
  const auth = await requireSession(["employee", "manager"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  const storeId = auth.user.storeId;
  if (!storeId) return fail("当前账号未绑定门店");

  const parsed = addSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("参数错误");
  const { date, timeSlot, reason } = parsed.data;
  const userId = auth.user.role === "employee" ? auth.user.id : parsed.data.userId;
  if (!userId) return fail("缺少员工", 400);

  // 只能操作本店员工
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.storeId !== storeId || target.role !== "employee") {
    return fail("该员工不属于本门店", 403);
  }
  const slotDate = new Date(`${date}T00:00:00`);
  try {
    if (auth.user.role === "manager") {
      if (!parsed.data.planId || parsed.data.version === undefined) {
        return fail("店长修改不可供班必须携带计划与版本", 400);
      }
      const changed = await mutatePlanInput(
        { user: auth.user, storeId },
        { planId: parsed.data.planId, version: parsed.data.version },
        async (tx, plan) => {
          if (plan.weekOf !== mondayOf(date)) {
            throw new PlanDomainError("不可供班日期不在计划周内", 400);
          }
          return tx.unavailableSlot.upsert({
            where: { userId_date_timeSlot: { userId, date: slotDate, timeSlot } },
            update: { reason: reason || null },
            create: { userId, date: slotDate, timeSlot, reason: reason || null },
          });
        },
      );
      return ok({ id: changed.result.id, plan: changed.plan });
    }
    const result = await prisma.$transaction(async (tx) => {
      const slot = await tx.unavailableSlot.upsert({
        where: { userId_date_timeSlot: { userId, date: slotDate, timeSlot } },
        update: { reason: reason || null },
        create: { userId, date: slotDate, timeSlot, reason: reason || null },
      });
      const plans = await invalidatePlansForDate(tx, storeId, slotDate);
      return { slot, plans };
    });
    return ok({ id: result.slot.id, plans: result.plans });
  } catch (error) {
    if (error instanceof PlanDomainError) return fail(error.message, error.status);
    throw error;
  }
}

export async function DELETE(req: Request) {
  const auth = await requireSession(["employee", "manager"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  const storeId = auth.user.storeId;
  if (!storeId) return fail("当前账号未绑定门店");

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return fail("缺少 id");

  const slot = await prisma.unavailableSlot.findUnique({ where: { id }, include: { user: { select: { storeId: true } } } });
  if (!slot) return fail("记录不存在", 404);
  if (slot.user.storeId !== storeId) return fail("无权操作", 403);
  if (auth.user.role === "employee" && slot.userId !== auth.user.id) {
    return fail("只能删除自己的不可供班记录", 403);
  }
  try {
    if (auth.user.role === "manager") {
      const planId = url.searchParams.get("planId");
      const versionRaw = url.searchParams.get("version");
      if (!planId || versionRaw === null || !/^\d+$/.test(versionRaw)) {
        return fail("店长删除不可供班必须携带计划与版本", 400);
      }
      const changed = await mutatePlanInput(
        { user: auth.user, storeId },
        { planId, version: Number(versionRaw) },
        async (tx, plan) => {
          const current = await tx.unavailableSlot.findUnique({ where: { id } });
          if (!current) throw new PlanDomainError("记录不存在", 404);
          if (plan.weekOf !== mondayOf(toDateStr(current.date))) {
            throw new PlanDomainError("不可供班日期不在计划周内", 400);
          }
          return tx.unavailableSlot.delete({ where: { id } });
        },
      );
      return ok({ deleted: id, plan: changed.plan });
    }
    const result = await prisma.$transaction(async (tx) => {
      const deleted = await tx.unavailableSlot.delete({ where: { id } });
      const plans = await invalidatePlansForDate(tx, storeId, deleted.date);
      return { plans };
    });
    return ok({ deleted: id, plans: result.plans });
  } catch (error) {
    if (error instanceof PlanDomainError) return fail(error.message, error.status);
    throw error;
  }
}

export async function GET(req: Request) {
  const auth = await requireSession(["employee", "manager", "admin"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  const url = new URL(req.url);
  const requestedStoreId = url.searchParams.get("storeId");
  const storeId = auth.user.role === "admin" ? requestedStoreId : auth.user.storeId;
  if (!storeId) return fail("必须指定门店", 400);
  if (auth.user.role === "manager" && requestedStoreId && requestedStoreId !== storeId) {
    return fail("无权访问其他门店", 403);
  }
  const requestedUserId = url.searchParams.get("userId");
  const userId = auth.user.role === "employee" ? auth.user.id : requestedUserId;
  const rows = await prisma.unavailableSlot.findMany({
    where: {
      ...(userId ? { userId } : { user: { storeId } }),
      user: { storeId },
    },
    orderBy: [{ date: "asc" }, { timeSlot: "asc" }],
  });
  return ok(
    rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      date: row.date.toLocaleDateString("en-CA"),
      timeSlot: row.timeSlot,
      reason: row.reason,
    })),
  );
}
