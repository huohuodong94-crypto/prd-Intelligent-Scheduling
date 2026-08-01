export type DashboardSummary = {
  store: { id: string; name: string } | null;
  pendingApprovals: number;
  draftPlans: number;
  scheduleGapCount: number | null;
  attendanceExceptionCount: number | null;
};
