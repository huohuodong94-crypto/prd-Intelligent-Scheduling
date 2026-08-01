import { z } from "zod";

import { fail, ok, readJson } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { requireStoreAccess } from "@/lib/authorization";
import { prisma } from "@/lib/db";
import { SHIFTS, type Shift } from "@/lib/config";
import { localDateSchema } from "@/lib/contracts/scheduling";
import { toDateStr, weekDays } from "@/lib/dates";
import { getForecastDetail, getStaffing } from "@/lib/forecast";
import {
  PlanDomainError,
  mutatePlanInput,
  normalizePlanWeek,
} from "@/features/scheduling/server/plan-service";

async function resolvePlan(
  storeId: string,
  input: { planId?: string | null; weekOf?: string | null },
) {
  const plan = input.planId
    ? await prisma.schedulePlan.findUnique({ where: { id: input.planId } })
    : input.weekOf
      ? await prisma.schedulePlan.findUnique({
          where: {
            storeId_weekOf: {
              storeId,
              weekOf: normalizePlanWeek(input.weekOf),
            },
          },
        })
      : null;
  if (!plan) throw new PlanDomainError("排班计划不存在", 404);
  if (plan.storeId !== storeId) {
    throw new PlanDomainError("无权访问其他门店的排班计划", 403);
  }
  return plan;
}

async function readForecast(storeId: string, planId: string, weekOf: string) {
  const days = weekDays(weekOf);
  const [detail, saved] = await Promise.all([
    getForecastDetail(storeId, days),
    prisma.trafficForecast.findMany({ where: { planId } }),
  ]);
  const savedByKey = new Map(
    saved.map((row) => [`${toDateStr(row.date)}_${row.timeSlot}`, row]),
  );
  const cells = detail.map((cell) => {
    const row = savedByKey.get(`${cell.date}_${cell.shift}`);
    return {
      ...cell,
      predicted: row?.predicted ?? cell.predicted,
      adjusted: row?.adjusted ?? null,
      adjustReason: row?.adjustReason ?? null,
      effective: row?.adjusted ?? row?.predicted ?? cell.predicted,
    };
  });
  const staffing = await getStaffing(
    storeId,
    cells.map((cell) => ({
      date: cell.date,
      shift: cell.shift,
      visitors: cell.effective,
    })),
  );
  const plan = await prisma.schedulePlan.findUniqueOrThrow({
    where: { id: planId },
    select: { id: true, version: true },
  });
  return { planId, plan, weekOf, days, shifts: SHIFTS, cells, staffing };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth = await requireSession(["manager", "admin"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  let requestedStoreId = url.searchParams.get("storeId");
  if (!requestedStoreId && url.searchParams.get("planId")) {
    requestedStoreId =
      (
        await prisma.schedulePlan.findUnique({
          where: { id: url.searchParams.get("planId")! },
          select: { storeId: true },
        })
      )?.storeId ?? null;
  }
  const access = await requireStoreAccess(
    ["manager", "admin"],
    requestedStoreId,
  );
  if ("error" in access) return fail(access.error, access.status);
  try {
    const plan = await resolvePlan(access.scope.storeId, {
      planId: url.searchParams.get("planId"),
      weekOf: url.searchParams.get("weekOf"),
    });
    return ok(await readForecast(access.scope.storeId, plan.id, plan.weekOf));
  } catch (error) {
    if (error instanceof PlanDomainError) return fail(error.message, error.status);
    throw error;
  }
}

const adjustSchema = z
  .object({
    planId: z.string().min(1).optional(),
    storeId: z.string().min(1).optional(),
    weekOf: localDateSchema.optional(),
    date: localDateSchema,
    timeSlot: z.enum(SHIFTS),
    adjusted: z.number().finite().min(0).nullable(),
    reason: z.string().trim().min(1, "调整必须填写原因").max(200),
    version: z.number().int().min(0),
  })
  .refine((input) => input.planId || input.weekOf, "缺少 planId 或 weekOf");

export async function POST(req: Request) {
  const auth = await requireSession(["manager"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  const parsed = adjustSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return fail(
      `参数错误：${parsed.error.issues.map((issue) => issue.message).join("；")}`,
    );
  }
  const access = await requireStoreAccess(["manager"], parsed.data.storeId);
  if ("error" in access) return fail(access.error, access.status);
  try {
    const plan = await resolvePlan(access.scope.storeId, parsed.data);
    const baseline = await getForecastDetail(
      access.scope.storeId,
      weekDays(plan.weekOf),
    );
    const cell = baseline.find(
      (row) => row.date === parsed.data.date && row.shift === parsed.data.timeSlot,
    );
    if (!cell) return fail("该格预测不存在", 404);
    const changed = await mutatePlanInput(
      access.scope,
      { planId: plan.id, version: parsed.data.version },
      (tx) =>
        tx.trafficForecast.upsert({
          where: {
            planId_date_timeSlot: {
              planId: plan.id,
              date: new Date(`${parsed.data.date}T00:00:00`),
              timeSlot: parsed.data.timeSlot,
            },
          },
          update: {
            adjusted: parsed.data.adjusted,
            adjustReason: parsed.data.adjusted === null ? null : parsed.data.reason,
          },
          create: {
            planId: plan.id,
            date: new Date(`${parsed.data.date}T00:00:00`),
            timeSlot: parsed.data.timeSlot,
            predicted: cell.predicted,
            adjusted: parsed.data.adjusted,
            adjustReason: parsed.data.adjusted === null ? null : parsed.data.reason,
          },
        }),
    );
    return ok({
      id: changed.result.id,
      adjusted: changed.result.adjusted,
      effective: changed.result.adjusted ?? changed.result.predicted,
      plan: changed.plan,
    });
  } catch (error) {
    if (error instanceof PlanDomainError) return fail(error.message, error.status);
    throw error;
  }
}
