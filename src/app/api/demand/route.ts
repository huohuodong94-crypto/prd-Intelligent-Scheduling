import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { requireStoreAccess } from "@/lib/authorization";
import { ok, fail, readJson } from "@/lib/api";
import {
  legacyStaffingRowSchema,
  updateStaffingSchema,
} from "@/lib/contracts/store";
import { replaceStaffingRows } from "@/features/store/server/store-service";

// 最低人力配置（门店 + 星期几 + 时段 + 岗位 → 最低人数）。
// 旧 POST 保持仅管理员可写；店长仅通过新 PUT 批量编辑本店。
// 排班引擎的人数需求经 getDemandForecast 读取本表（Sprint 2 起改由预测链路折算）。
export async function GET(req: Request) {
  const auth = await requireSession(["admin", "manager"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  const url = new URL(req.url);
  const stores = await prisma.store.findMany({
    where: auth.user.role === "manager" ? { id: auth.user.storeId ?? "" } : undefined,
    orderBy: { name: "asc" },
  });
  // 管理员无绑定门店时，默认取第一个门店
  const requestedStoreId =
    url.searchParams.get("storeId") || auth.user.storeId || stores[0]?.id;
  if (!requestedStoreId) return fail("暂无门店，请先创建门店");
  const scoped = await requireStoreAccess(["admin", "manager"], requestedStoreId);
  if ("error" in scoped) return fail(scoped.error, scoped.status);

  const configs = await prisma.minStaffingConfig.findMany({
    where: { storeId: scoped.scope.storeId },
    orderBy: [{ dayOfWeek: "asc" }, { timeSlot: "asc" }, { position: "asc" }],
  });
  return ok({ storeId: scoped.scope.storeId, stores, configs });
}

// 更新单个配置项
export async function POST(req: Request) {
  const parsed = legacyStaffingRowSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  const { storeId, dayOfWeek, timeSlot, position, minHeadcount } = parsed.data;
  const auth = await requireStoreAccess(["admin"], storeId);
  if ("error" in auth) return fail(auth.error, auth.status);

  const saved = await prisma.minStaffingConfig.upsert({
    where: {
      storeId_dayOfWeek_timeSlot_position: {
        storeId,
        dayOfWeek,
        timeSlot,
        position,
      },
    },
    update: { minHeadcount },
    create: { storeId, dayOfWeek, timeSlot, position, minHeadcount },
  });
  return ok(saved);
}

export async function PUT(req: Request) {
  const parsed = updateStaffingSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  const auth = await requireStoreAccess(["admin", "manager"], parsed.data.storeId);
  if ("error" in auth) return fail(auth.error, auth.status);
  return ok(await replaceStaffingRows(auth.scope, parsed.data.rows));
}
