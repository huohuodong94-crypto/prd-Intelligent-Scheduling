import { prisma } from "./db";
import { config, POSITIONS, SHIFTS, SHIFT_TIMES, type Position, type Shift } from "./config";
import { previousWeekOf, toDateStr } from "./dates";
import type { EngineEmployee } from "./scheduleEngine";

// 从上周已保存的排班回算工时：上周班次数 × 每班时长。
// 取代原先直读 User.lastWeekHours（seed 写死的存量值），否则公平性软约束
// 拿到的是恒定假数据，等于失效。User.lastWeekHours 仅保留作缓存展示。
export async function getLastWeekHoursMap(
  storeId: string,
  weekOf: string,
  userIds: string[]
): Promise<Map<string, number>> {
  const grouped = await prisma.schedule.groupBy({
    by: ["userId"],
    where: { storeId, weekOf: previousWeekOf(weekOf), userId: { in: userIds } },
    _count: { _all: true },
  });
  const map = new Map<string, number>();
  for (const id of userIds) map.set(id, 0); // 上周无排班 → 0 小时
  for (const g of grouped) {
    map.set(g.userId, g._count._all * config.scheduling.shiftHours);
  }
  return map;
}

// 根据审批通过的请假记录，计算每个员工在本周各班次的不可用时段。
export async function buildEmployeesWithUnavailable(
  storeId: string,
  weekOf: string,
  days: string[]
): Promise<EngineEmployee[]> {
  const employees = await prisma.user.findMany({
    where: {
      storeId,
      role: "employee",
      position: { in: [...POSITIONS] },
      workGroupMemberships: {
        some: {
          effectiveFrom: { lte: new Date(`${days[days.length - 1]}T23:59:59.999`) },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gte: new Date(`${days[0]}T00:00:00`) } },
          ],
          workGroup: { active: true },
          workArea: { active: true },
        },
      },
    },
    include: {
      workGroupMemberships: {
        where: {
          effectiveFrom: { lte: new Date(`${days[days.length - 1]}T23:59:59.999`) },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gte: new Date(`${days[0]}T00:00:00`) } },
          ],
          workGroup: { active: true },
          workArea: { active: true },
        },
        select: { effectiveFrom: true, effectiveTo: true },
      },
    },
    orderBy: { name: "asc" },
  });

  const empIds = employees.map((e) => e.id);
  // 只将“已通过”的请假视为硬性不可用
  const [leaves, registeredSlots] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: {
        userId: { in: empIds },
        status: "approved",
        startTime: { lte: new Date(`${days[days.length - 1]}T23:59:59.999`) },
        endTime: { gte: new Date(`${days[0]}T00:00:00`) },
      },
    }),
    prisma.unavailableSlot.findMany({
      where: {
        userId: { in: empIds },
        date: {
          gte: new Date(`${days[0]}T00:00:00`),
          lte: new Date(`${days[days.length - 1]}T23:59:59.999`),
        },
      },
    }),
  ]);
  const lastWeekHours = await getLastWeekHoursMap(storeId, weekOf, empIds);

  const result: EngineEmployee[] = employees.map((e) => {
    const unavailableKeys = new Set<string>();
    for (const slot of registeredSlots.filter((slot) => slot.userId === e.id)) {
      unavailableKeys.add(`${toDateStr(slot.date)}:${slot.timeSlot}`);
    }
    const myLeaves = leaves.filter((l) => l.userId === e.id);
    for (const date of days) {
      const dayStart = new Date(`${date}T00:00:00`);
      const dayEnd = new Date(`${date}T23:59:59.999`);
      const hasActiveMembership = e.workGroupMemberships.some(
        (membership) =>
          membership.effectiveFrom <= dayEnd &&
          (membership.effectiveTo === null || membership.effectiveTo >= dayStart),
      );
      for (const s of SHIFTS) {
        if (!hasActiveMembership) {
          unavailableKeys.add(`${date}:${s}`);
          continue;
        }
        const { start, end } = SHIFT_TIMES[s as Shift];
        const shiftStart = new Date(`${date}T00:00:00`);
        shiftStart.setHours(start);
        const shiftEnd = new Date(`${date}T00:00:00`);
        shiftEnd.setHours(end);
        // 任一请假区间与该班次时间有重叠 → 不可用
        const overlap = myLeaves.some(
          (l) => l.startTime < shiftEnd && l.endTime > shiftStart
        );
        if (overlap) unavailableKeys.add(`${date}:${s}`);
      }
    }
    return {
      id: e.id,
      name: e.name,
      position: e.position as Position,
      max_weekly_hours: e.maxWeeklyHours,
      last_week_hours: lastWeekHours.get(e.id) ?? 0,
      unavailable: [...unavailableKeys].map((key) => {
        const [date, shift] = key.split(":");
        return { date, shift: shift as Shift };
      }),
    };
  });

  return result;
}
