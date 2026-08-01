import { z } from "zod";

import { monthOnlySchema } from "./store";

export const zeroAttendanceActionSchema = z.enum(["none", "normal_attendance", "supplement_hours"]);
export const monthlyConfirmationStatusSchema = z.enum(["unconfirmed", "confirmed"]);
export const monthlyInvalidationReasonSchema = z.enum([
  "schedule_changed",
  "punch_created",
  "leave_approval_changed",
  "correction_approval_changed",
  "shift_swap_approved",
  "daily_result_changed",
  "daily_confirmation_changed",
]);

export const monthlyConfirmRowSchema = z.object({
  userId: z.string().min(1),
  zeroAttendanceAction: zeroAttendanceActionSchema,
  expectedRevision: z.number().int().nonnegative(),
  expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const monthlyUnconfirmRowSchema = z.object({
  userId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
}).strict();

function uniqueUserIds(rows: Array<{ userId: string }>) {
  return new Set(rows.map((row) => row.userId)).size === rows.length;
}

export const monthlyQuerySchema = z.object({
  month: monthOnlySchema,
  storeId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
}).strict();

export const monthlyConfirmSchema = z.object({
  storeId: z.string().min(1).optional(),
  month: monthOnlySchema,
  rows: z.array(monthlyConfirmRowSchema).min(1).max(200),
}).strict().refine((value) => uniqueUserIds(value.rows), { message: "员工不得重复", path: ["rows"] });

export const monthlyUnconfirmSchema = z.object({
  storeId: z.string().min(1).optional(),
  month: monthOnlySchema,
  rows: z.array(monthlyUnconfirmRowSchema).min(1).max(200),
}).strict().refine((value) => uniqueUserIds(value.rows), { message: "员工不得重复", path: ["rows"] });

export type ZeroAttendanceAction = z.infer<typeof zeroAttendanceActionSchema>;
export type MonthlyConfirmationStatus = z.infer<typeof monthlyConfirmationStatusSchema>;
export type MonthlyInvalidationReason = z.infer<typeof monthlyInvalidationReasonSchema>;
export type MonthlyConfirmInput = z.infer<typeof monthlyConfirmSchema>;
export type MonthlyUnconfirmInput = z.infer<typeof monthlyUnconfirmSchema>;

export type MonthlyInvalidationChange = {
  userId: string;
  localDate: string;
  reason: MonthlyInvalidationReason;
  actorId: string;
  sourceRef: string;
};

export type MonthlySourceSnapshot = {
  storeId: string;
  userId: string;
  month: string;
  schedules: Array<{ id: string; localDate: string; shiftType: string }>;
  punches: Array<{ id: string; time: string; direction: string }>;
  leaves: Array<{ id: string; startTime: string; endTime: string }>;
  corrections: Array<{ id: string; requestedTime: string; direction: string }>;
  days: Array<{
    localDate: string;
    scheduledHours: number;
    workedHours: number;
    exceptions: Array<{ type: string; minutes: number | null }>;
  }>;
  confirmations: Array<{ id: string; localDate: string; type: string; status: string; revision: number }>;
};

export type MonthlyAttendanceRow = {
  userId: string;
  employeeName: string;
  month: string;
  scheduledHours: number;
  workedHours: number;
  leaveHours: number;
  correctionHours: number;
  exceptionCount: number;
  unconfirmedExceptionCount: number;
  zeroAttendance: boolean;
  zeroAttendanceAction: ZeroAttendanceAction;
  status: MonthlyConfirmationStatus;
  confirmedByName: string | null;
  confirmedAt: string | null;
  revision: number;
  sourceHash: string;
  needsReconfirmation: boolean;
  lastInvalidationReason: string | null;
};

export function validateMonthlyConfirmation(rows: MonthlyAttendanceRow[]) {
  const blocked = rows.flatMap((row) => {
    const reasons: string[] = [];
    if (row.unconfirmedExceptionCount > 0) reasons.push(`仍有 ${row.unconfirmedExceptionCount} 条未确认日异常`);
    if (row.zeroAttendance && row.zeroAttendanceAction === "none") reasons.push("0 考勤必须选择处理方式");
    if (!row.zeroAttendance && row.zeroAttendanceAction !== "none") reasons.push("非 0 考勤不能选择处理方式");
    return reasons.length ? [{ userId: row.userId, reasons }] : [];
  });
  return blocked.length ? { ok: false as const, blocked } : { ok: true as const, blocked: [] };
}
