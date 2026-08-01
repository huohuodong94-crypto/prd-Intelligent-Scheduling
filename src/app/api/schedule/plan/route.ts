import { z } from "zod";

import { fail, ok, readJson } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { requireStoreAccess } from "@/lib/authorization";
import { prisma } from "@/lib/db";
import { SHIFTS, SHIFT_LABELS, SHIFT_TIMES } from "@/lib/config";
import { toDateStr } from "@/lib/dates";
import {
  parseScheduleRecommendation,
  workModeSchema,
} from "@/lib/contracts/scheduling";
import {
  PlanDomainError,
  createPlan,
  getPlanDetail,
  normalizePlanWeek,
  updatePlanMode,
} from "@/features/scheduling/server/plan-service";

function domainFailure(error: unknown) {
  if (error instanceof PlanDomainError) return fail(error.message, error.status);
  throw error;
}

async function resolvePlanId(
  storeId: string,
  input: { id?: string | null; weekOf?: string | null },
) {
  if (input.id) return input.id;
  if (!input.weekOf) return null;
  const weekOf = normalizePlanWeek(input.weekOf);
  const plan = await prisma.schedulePlan.findUnique({
    where: { storeId_weekOf: { storeId, weekOf } },
    select: { id: true },
  });
  return plan?.id ?? null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth = await requireSession(["manager", "admin"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  let requestedStoreId = url.searchParams.get("storeId");
  if (!requestedStoreId && url.searchParams.get("id")) {
    requestedStoreId =
      (
        await prisma.schedulePlan.findUnique({
          where: { id: url.searchParams.get("id")! },
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
    const id = await resolvePlanId(access.scope.storeId, {
      id: url.searchParams.get("id"),
      weekOf: url.searchParams.get("weekOf"),
    });
    if (!id) return fail("排班计划不存在", 404);
    const detail = await getPlanDetail(access.scope, id);
    const [store, events, persisted] = await Promise.all([
      prisma.store.findUnique({
        where: { id: access.scope.storeId },
        select: { id: true, name: true },
      }),
      prisma.storeEvent.findMany({
        where: {
          storeId: access.scope.storeId,
          date: {
            gte: new Date(`${detail.days[0]}T00:00:00`),
            lte: new Date(`${detail.days[6]}T23:59:59.999`),
          },
        },
      }),
      prisma.schedulePlan.findUnique({
        where: { id },
        select: { recommendationJson: true },
      }),
    ]);
    return ok({
      ...detail,
      plan: {
        id: detail.id,
        storeId: detail.storeId,
        weekOf: detail.weekOf,
        mode: detail.mode,
        status: detail.status,
        version: detail.version,
        publishedAt: detail.publishedAt,
      },
      store,
      shifts: SHIFTS.map((shift) => ({
        key: shift,
        label: SHIFT_LABELS[shift],
        start: SHIFT_TIMES[shift].start,
        end: SHIFT_TIMES[shift].end,
      })),
      events: events.map((event) => ({
        id: event.id,
        date: toDateStr(event.date),
        label: event.label,
        factor: event.factor,
      })),
      recommendation: parseScheduleRecommendation(persisted?.recommendationJson),
    });
  } catch (error) {
    return domainFailure(error);
  }
}

const updateSchema = z
  .object({
    id: z.string().min(1).optional(),
    storeId: z.string().min(1).optional(),
    weekOf: z.string().optional(),
    mode: workModeSchema,
    version: z.number().int().min(0).optional(),
  })
  .refine((input) => input.id || input.weekOf, "缺少 id 或 weekOf");

export async function POST(req: Request) {
  const auth = await requireSession(["manager"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  const parsed = updateSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  const access = await requireStoreAccess(["manager"], parsed.data.storeId);
  if ("error" in access) return fail(access.error, access.status);
  try {
    const id = await resolvePlanId(access.scope.storeId, parsed.data);
    if (!id) {
      if (!parsed.data.weekOf) return fail("排班计划不存在", 404);
      return ok(
        await createPlan(access.scope, {
          storeId: parsed.data.storeId,
          weekOf: parsed.data.weekOf,
          mode: parsed.data.mode,
        }),
        201,
      );
    }
    return ok(
      await updatePlanMode(access.scope, {
        id,
        mode: parsed.data.mode,
        version: parsed.data.version,
      }),
    );
  } catch (error) {
    return domainFailure(error);
  }
}
