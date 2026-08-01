import { z } from "zod";
import { fail, ok, readJson } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

const schema = z.object({ planId: z.string().min(1).optional(), aiLogId: z.string().min(1), wasAccepted: z.boolean().optional(), wasEdited: z.boolean().optional() });

export async function POST(request: Request) {
  const auth = await requireSession();
  if ("error" in auth) return fail(auth.error, auth.status);
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  const log = await prisma.aiInteractionLog.findUnique({ where: { id: parsed.data.aiLogId } });
  if (!log) return fail("AI 日志不存在", 404);
  if (log.feature === "schedule_advisor" || log.eventKind === "schedule_plan_metric") {
    if (parsed.data.planId) {
      const plan = await prisma.schedulePlan.findUnique({ where: { id: parsed.data.planId } });
      if (!plan) return fail("排班计划不存在", 404);
      if (!auth.user.storeId || plan.storeId !== auth.user.storeId) return fail("无权操作其他门店的反馈", 403);
      if (log.storeId !== plan.storeId || log.planId !== plan.id || plan.recommendationAiLogId !== log.id) {
        return fail("该日志不是当前计划的 canonical recommendation metric", 409);
      }
    }
    return fail("排班采纳指标只能由显式发布写入", 409);
  }
  if (log.userId !== auth.user.id) return fail("无权修改他人的 AI 反馈", 403);
  if (log.storeId && auth.user.storeId && log.storeId !== auth.user.storeId) {
    return fail("无权修改其他门店的 AI 反馈", 403);
  }
  await prisma.aiInteractionLog.update({ where: { id: log.id }, data: { wasAccepted: parsed.data.wasAccepted, wasEdited: parsed.data.wasEdited } });
  return ok({});
}
