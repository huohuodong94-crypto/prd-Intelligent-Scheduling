import { getMonthlyAttendance } from "@/features/attendance/server/monthly-attendance-service";
import type { StoreScope } from "@/lib/authorization";
import { config, POSITIONS, SHIFTS, type Position, type Shift } from "@/lib/config";
import type {
  AiReportMetrics,
  MonthlyReport,
  MonthlyReportRow,
  MonthlyReportTotals,
  SchedulingReport,
} from "@/lib/contracts/reports";
import { shanghaiDateOnly } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { getStaffing } from "@/lib/forecast";

export class ReportServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

export type AiFeedbackRow = {
  wasAccepted: boolean | null;
  wasEdited: boolean | null;
  editRatio: number | null;
};

function assertReportReadScope(scope: StoreScope) {
  if (!scope.storeId || !["manager", "admin"].includes(scope.user.role)) {
    throw new ReportServiceError("无权查看报表", 403, "forbidden");
  }
  if (scope.user.role === "manager" && scope.user.storeId !== scope.storeId) {
    throw new ReportServiceError("无权访问其他门店", 403, "cross_store");
  }
}

export function calculateAiMetrics(rows: AiFeedbackRow[]): AiReportMetrics {
  const generatedPlans = rows.length;
  const acceptedPlans = rows.filter((row) => row.wasAccepted === true).length;
  const editedPlans = rows.filter((row) => row.wasEdited === true).length;
  const ratios = rows.flatMap((row) => row.editRatio === null ? [] : [row.editRatio]);
  return {
    generatedPlans,
    acceptedPlans,
    editedPlans,
    acceptanceRate: generatedPlans ? acceptedPlans / generatedPlans : null,
    averageEditRatio: ratios.length ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length : null,
  };
}

function sumMonthlyRows(rows: MonthlyReportRow[]): MonthlyReportTotals {
  return rows.reduce((totals, row) => ({
    scheduledHours: totals.scheduledHours + row.scheduledHours,
    workedHours: totals.workedHours + row.workedHours,
    leaveHours: totals.leaveHours + row.leaveHours,
    correctionHours: totals.correctionHours + row.correctionHours,
    exceptionCount: totals.exceptionCount + row.exceptionCount,
  }), { scheduledHours: 0, workedHours: 0, leaveHours: 0, correctionHours: 0, exceptionCount: 0 });
}

export async function getMonthlyReport(scope: StoreScope, month: string): Promise<MonthlyReport> {
  assertReportReadScope(scope);
  const attendanceRows = await getMonthlyAttendance(scope, month);
  const rows = attendanceRows.map((row) => ({
    userId: row.userId,
    employeeName: row.employeeName,
    scheduledHours: row.scheduledHours,
    workedHours: row.workedHours,
    leaveHours: row.leaveHours,
    correctionHours: row.correctionHours,
    exceptionCount: row.exceptionCount,
    confirmationStatus: row.status,
  }));
  return { month, rows, totals: sumMonthlyRows(rows) };
}

function emptySchedulingReport(weekOf: string): SchedulingReport {
  return {
    weekOf,
    employeeRows: [],
    gaps: [],
    v2s: [],
    abilityBalance: [],
    ai: calculateAiMetrics([]),
  };
}

export async function getSchedulingReport(scope: StoreScope, weekOf: string): Promise<SchedulingReport> {
  assertReportReadScope(scope);
  const plan = await prisma.schedulePlan.findFirst({
    where: { storeId: scope.storeId, weekOf, status: "published" },
    include: {
      schedules: { include: { user: true } },
      forecasts: true,
      recommendationAiLog: true,
    },
  });
  if (!plan) return emptySchedulingReport(weekOf);

  const schedules = plan.schedules.filter((row) =>
    row.planId === plan.id
    && row.storeId === scope.storeId
    && row.weekOf === weekOf
    && row.user.role === "employee"
    && row.user.storeId === scope.storeId
    && SHIFTS.includes(row.shiftType as Shift)
    && POSITIONS.includes(row.user.position as Position));
  const visitorCells = plan.forecasts
    .filter((row) => SHIFTS.includes(row.timeSlot as Shift))
    .map((row) => ({
      date: shanghaiDateOnly(row.date),
      shift: row.timeSlot as Shift,
      visitors: row.adjusted ?? row.predicted,
    }))
    .sort((left, right) => left.date.localeCompare(right.date) || SHIFTS.indexOf(left.shift) - SHIFTS.indexOf(right.shift));
  const staffing = await getStaffing(scope.storeId, visitorCells);

  const employeeMap = new Map<string, SchedulingReport["employeeRows"][number]>();
  for (const schedule of schedules) {
    const existing = employeeMap.get(schedule.userId) ?? {
      userId: schedule.userId,
      employeeName: schedule.user.name,
      shifts: 0,
      hours: 0,
      ability: schedule.user.salesAbility,
      performance: schedule.user.performanceBand,
    };
    existing.shifts += 1;
    existing.hours += config.scheduling.shiftHours;
    employeeMap.set(schedule.userId, existing);
  }

  const assigned = (date: string, shift: Shift, position?: Position) => schedules.filter((row) =>
    shanghaiDateOnly(row.date) === date
    && row.shiftType === shift
    && (!position || row.user.position === position));
  const gaps = staffing.flatMap((cell) => POSITIONS.map((position) => {
    const assignedCount = assigned(cell.date, cell.shift, position).length;
    const required = cell.perPosition[position];
    return {
      date: cell.date,
      shift: cell.shift,
      position,
      required,
      assigned: assignedCount,
      shortfall: Math.max(0, required - assignedCount),
    };
  }));
  const v2s = staffing.map((cell) => {
    const staff = assigned(cell.date, cell.shift).length;
    return {
      date: cell.date,
      shift: cell.shift,
      visitors: cell.visitors,
      staff,
      actualV2S: staff > 0 ? cell.visitors / staff : null,
      lower: cell.v2sLower,
      upper: cell.v2sUpper,
    };
  });
  const abilityBalance = staffing.map((cell) => {
    const assignedUsers = assigned(cell.date, cell.shift);
    return {
      date: cell.date,
      shift: cell.shift,
      high: assignedUsers.filter((row) => row.user.salesAbility === "high").length,
      mid: assignedUsers.filter((row) => row.user.salesAbility === "mid").length,
      low: assignedUsers.filter((row) => row.user.salesAbility === "low").length,
    };
  });
  const metric = plan.recommendationAiLog;
  const canonicalMetric = metric
    && metric.id === plan.recommendationAiLogId
    && metric.storeId === plan.storeId
    && metric.planId === plan.id
    && metric.feature === "schedule_advisor"
    && metric.eventKind === "schedule_plan_metric"
      ? [{ wasAccepted: metric.wasAccepted, wasEdited: metric.wasEdited, editRatio: metric.editRatio }]
      : [];

  return {
    weekOf,
    employeeRows: [...employeeMap.values()].sort((left, right) => left.employeeName.localeCompare(right.employeeName) || left.userId.localeCompare(right.userId)),
    gaps,
    v2s,
    abilityBalance,
    ai: calculateAiMetrics(canonicalMetric),
  };
}
