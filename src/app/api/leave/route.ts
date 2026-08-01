import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, fail, readJson } from "@/lib/api";

// 计算请假时长（小时）。全天按 8h/天；时段按起止时间差。
function computeHours(start: Date, end: Date, isFullDay: boolean): number {
  if (isFullDay) {
    const msPerDay = 24 * 3600 * 1000;
    const days =
      Math.floor((end.setHours(0, 0, 0, 0) - new Date(start).setHours(0, 0, 0, 0)) / msPerDay) + 1;
    return Math.max(1, days) * 8;
  }
  const hours = (end.getTime() - start.getTime()) / (3600 * 1000);
  return Math.round(hours * 10) / 10;
}

// 发起请假：年假/病假，全天/时段，自动算时长，进入待审批。
export async function POST(req: Request) {
  const auth = await requireSession(["employee"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  const body = await readJson<{
    type: "annual" | "sick";
    startTime: string;
    endTime: string;
    isFullDay: boolean;
    reason?: string;
  }>(req);

  if (!["annual", "sick"].includes(body.type)) return fail("请假类型仅支持 年假/病假");
  const start = new Date(body.startTime);
  const end = new Date(body.endTime);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return fail("起止时间无效");
  if (end.getTime() < start.getTime()) return fail("结束时间不能早于开始时间");

  const hours = computeHours(new Date(start), new Date(end), !!body.isFullDay);

  // 余额校验（对齐规则库「年假余额不足时无法提交」）：不足则直接拒绝提交，
  // 避免出现「批准即把余额扣成负数」的脏数据。
  // 注意要把「已提交但未审批」的单据一并计入占用 —— 否则多张单各自都 ≤ 余额、
  // 却在逐张批准后把余额累计扣成负数。
  const me = await prisma.user.findUnique({ where: { id: auth.user.id } });
  if (!me) return fail("账号不存在", 404);
  const balance =
    body.type === "annual" ? me.annualLeaveBalance : me.sickLeaveBalance;
  const pendingAgg = await prisma.leaveRequest.aggregate({
    where: { userId: auth.user.id, type: body.type, status: "pending" },
    _sum: { hours: true },
  });
  const pendingHours = pendingAgg._sum.hours ?? 0;
  const available = balance - pendingHours;
  if (hours > available) {
    const label = body.type === "annual" ? "年假" : "病假";
    const tail =
      pendingHours > 0 ? `（余额 ${balance}，待审批占用 ${pendingHours}）` : "";
    return fail(
      `余额不足：本次申请 ${hours} 小时，当前${label}可用 ${available} 小时${tail}`
    );
  }

  const leave = await prisma.leaveRequest.create({
    data: {
      userId: auth.user.id,
      type: body.type,
      startTime: start,
      endTime: end,
      isFullDay: !!body.isFullDay,
      hours,
      reason: body.reason || null,
      status: "pending",
    },
  });
  return ok(leave);
}

// 查询本人请假记录
export async function GET() {
  const auth = await requireSession(["employee"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  const list = await prisma.leaveRequest.findMany({
    where: { userId: auth.user.id },
    orderBy: { createdAt: "desc" },
  });
  return ok(list);
}
