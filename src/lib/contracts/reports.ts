import { z } from "zod";

import type { Position, Shift } from "@/lib/config";
import type { MonthlyConfirmationStatus } from "./monthly-attendance";
import { dateOnlySchema, monthOnlySchema } from "./store";

const optionalStoreIdSchema = z.string().trim().min(1).optional();

export const monthlyReportQuerySchema = z.object({
  month: monthOnlySchema,
  storeId: optionalStoreIdSchema,
}).strict();

export const mondayOnlySchema = dateOnlySchema.refine(
  (value) => new Date(`${value}T12:00:00Z`).getUTCDay() === 1,
  "weekOf 必须为周一",
);

export const schedulingReportQuerySchema = z.object({
  weekOf: mondayOnlySchema,
  storeId: optionalStoreIdSchema,
}).strict();

export type MonthlyReportRow = {
  userId: string;
  employeeName: string;
  scheduledHours: number;
  workedHours: number;
  leaveHours: number;
  correctionHours: number;
  exceptionCount: number;
  confirmationStatus: MonthlyConfirmationStatus;
};

export type MonthlyReportTotals = Pick<
  MonthlyReportRow,
  "scheduledHours" | "workedHours" | "leaveHours" | "correctionHours" | "exceptionCount"
>;

export type MonthlyReport = {
  month: string;
  rows: MonthlyReportRow[];
  totals: MonthlyReportTotals;
};

export type AiReportMetrics = {
  generatedPlans: number;
  acceptedPlans: number;
  editedPlans: number;
  acceptanceRate: number | null;
  averageEditRatio: number | null;
};

export type SchedulingReport = {
  weekOf: string;
  employeeRows: Array<{
    userId: string;
    employeeName: string;
    shifts: number;
    hours: number;
    ability: string;
    performance: string;
  }>;
  gaps: Array<{
    date: string;
    shift: Shift;
    position: Position;
    required: number;
    assigned: number;
    shortfall: number;
  }>;
  v2s: Array<{
    date: string;
    shift: Shift;
    visitors: number;
    staff: number;
    actualV2S: number | null;
    lower: number;
    upper: number;
  }>;
  abilityBalance: Array<{
    date: string;
    shift: Shift;
    high: number;
    mid: number;
    low: number;
  }>;
  ai: AiReportMetrics;
};
