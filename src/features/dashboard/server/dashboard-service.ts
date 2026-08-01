import { prisma } from "@/lib/db";
import type { DashboardSummary } from "@/lib/contracts/dashboard";
import { parseScheduleRecommendation } from "@/lib/contracts/scheduling";

export async function getDashboardSummary(storeId: string): Promise<DashboardSummary> {
  const [store, pendingLeaves, pendingCorrections, pendingSwaps, draftPlans, latestPlan, attendanceExceptionCount] = await Promise.all([
    prisma.store.findUnique({ where: { id: storeId }, select: { id: true, name: true } }),
    prisma.leaveRequest.count({
      where: { status: "pending", user: { storeId } },
    }),
    prisma.punchCorrection.count({ where: { status: "pending", user: { storeId } } }),
    prisma.shiftSwapRequest.count({ where: { status: "pending_manager", reqSchedule: { storeId } } }),
    prisma.schedulePlan.count({ where: { storeId, status: "draft" } }),
    prisma.schedulePlan.findFirst({
      where: { storeId, status: { in: ["recommended", "published"] } },
      orderBy: { updatedAt: "desc" },
      select: { recommendationJson: true },
    }),
    prisma.attendanceExceptionConfirmation.count({ where: { storeId, active: true, status: "unconfirmed" } }),
  ]);
  const recommendation = parseScheduleRecommendation(latestPlan?.recommendationJson);

  return {
    store,
    pendingApprovals: pendingLeaves + pendingCorrections + pendingSwaps,
    draftPlans,
    scheduleGapCount: recommendation
      ? recommendation.gaps.reduce((total, gap) => total + gap.shortfall, 0)
      : 0,
    attendanceExceptionCount,
  };
}
