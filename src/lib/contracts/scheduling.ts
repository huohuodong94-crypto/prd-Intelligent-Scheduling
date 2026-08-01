import { z } from "zod";

import { POSITIONS, SHIFTS, type Position, type Shift } from "@/lib/config";
import { dateOnlySchema, type OperatingDayInput } from "@/lib/contracts/store";

export const workModeSchema = z.enum(["work5rest2", "work6rest1"]);
export const localDateSchema = dateOnlySchema;
export const assignmentSchema = z.object({
  userId: z.string().min(1),
  date: localDateSchema,
  shiftType: z.enum(SHIFTS),
});
export const versionedPlanCommandSchema = z.object({
  planId: z.string().min(1),
  version: z.number().int().nonnegative(),
});
export const saveDraftSchema = versionedPlanCommandSchema.extend({
  assignments: z.array(assignmentSchema),
  source: z.enum(["manual", "ai_generated"]),
  aiLogId: z.string().optional(),
  parseLogId: z.string().optional(),
});
export const createPlanSchema = z.object({
  storeId: z.string().min(1).optional(),
  weekOf: localDateSchema,
  mode: workModeSchema,
});
export const generateScheduleSchema = z.object({
  planId: z.string().min(1),
  instruction: z.string().trim().max(1000).optional(),
  version: z.number().int().min(0).optional(),
});
export const scheduleRecommendationSchema = z.object({
  assignments: z.array(
    assignmentSchema.extend({ userName: z.string().optional() }),
  ),
  gaps: z.array(
    z.object({
      date: localDateSchema,
      shift: z.enum(SHIFTS),
      position: z.enum(POSITIONS).optional(),
      required: z.number().int().min(0),
      shortfall: z.number().int().min(0),
    }),
  ),
  note: z.string(),
  explanation: z.string(),
  solveTimeMs: z.number().int().min(0).optional(),
  status: z.enum(["feasible", "feasible_with_gaps"]),
});

export function parseScheduleRecommendation(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    const parsed = scheduleRecommendationSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type WorkMode = z.infer<typeof workModeSchema>;
export type ScheduleAssignment = z.infer<typeof assignmentSchema>;
export type ConstraintIssue = {
  code:
    | "employee_store"
    | "employee_role"
    | "week_range"
    | "invalid_shift"
    | "leave"
    | "unavailable"
    | "rest"
    | "weekly_hours"
    | "staffing_gap";
  userId?: string;
  date?: string;
  shiftType?: Shift;
  message: string;
};
export type ImportIssue = {
  severity: "warning" | "error";
  row: number;
  column: string;
  value: string;
  code: string;
  suggestion: string;
};
export type ImportValidationResult = {
  batchId: string;
  importable: number;
  totalRows?: number;
  successRows?: number;
  errorRows?: number;
  warnings: ImportIssue[];
  errors: ImportIssue[];
};
export type ScheduleCell = {
  userId: string;
  date: string;
  shifts: Shift[];
};
export type ScheduleRecommendation = z.infer<typeof scheduleRecommendationSchema>;
export type PositionDemand = Record<
  string,
  Record<Shift, Record<Position, number>>
>;
export type RequiredByPosition = Record<
  string,
  Partial<Record<Shift, Partial<Record<Position, number>>>>
>;
export type SchedulePlanSummary = {
  id: string;
  storeId: string;
  weekOf: string;
  mode: WorkMode;
  status: "draft" | "recommended" | "published";
  version: number;
  publishedAt: string | null;
};
export type WizardEmployee = {
  id: string;
  name: string;
  storeId: string;
  role: "employee";
  position: Position;
  maxWeeklyHours: number;
  memberships: Array<{
    effectiveFrom: string;
    effectiveTo: string | null;
    workGroupActive: boolean;
    workAreaActive: boolean;
  }>;
};
export type UnavailableSlotDto = {
  id: string;
  userId: string;
  date: string;
  timeSlot: Shift;
  reason: string | null;
  source: "unavailable" | "approved_leave";
};
export type SchedulePlanDetail = SchedulePlanSummary & {
  days: string[];
  operatingDays: OperatingDayInput[];
  employees: WizardEmployee[];
  approvedLeaves: Array<{
    userId: string;
    status: "approved";
    startTime: string;
    endTime: string;
  }>;
  unavailable: UnavailableSlotDto[];
  requiredByPosition: RequiredByPosition;
  schedules: Array<ScheduleAssignment & { source: string }>;
};
export type { Position, Shift };
