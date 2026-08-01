import { z } from "zod";

import { dateOnlySchema } from "./store";

export const attendanceDirectionSchema = z.enum(["in", "out"]);
export const attendanceExceptionTypeSchema = z.enum(["late", "early_leave", "missing_in", "missing_out", "unscheduled"]);
export const attendanceConfirmationStatusSchema = z.enum(["unconfirmed", "confirmed"]);
export const punchSourceSchema = z.enum(["dynamic_code", "correction", "legacy"]);

export const clockCodeResponseSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  currentCode: z.string().regex(/^\d{6}$/),
  previousCode: z.string().regex(/^\d{6}$/),
  refreshAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const punchInputSchema = z.object({
  direction: attendanceDirectionSchema,
  code: z.string().regex(/^\d{6}$/, "动态码必须为 6 位数字"),
}).strict();

export const punchReceiptSchema = z.object({
  id: z.string(), userId: z.string(), storeId: z.string(), time: z.string().datetime(),
  direction: attendanceDirectionSchema, viaCode: z.literal(true),
});

export const punchHistoryQuerySchema = z.object({
  storeId: z.string().min(1).optional(), from: dateOnlySchema.optional(), to: dateOnlySchema.optional(),
  userId: z.string().min(1).optional(), direction: attendanceDirectionSchema.optional(), source: punchSourceSchema.optional(),
}).strict();

export const punchHistoryRowSchema = z.object({
  id: z.string(), userId: z.string(), employeeName: z.string(), storeId: z.string(), time: z.string().datetime(),
  direction: attendanceDirectionSchema, source: punchSourceSchema, valid: z.boolean(),
});

export const dailyAttendanceQuerySchema = z.object({
  storeId: z.string().min(1).optional(), from: dateOnlySchema.optional(), to: dateOnlySchema.optional(),
  userId: z.string().min(1).optional(), type: attendanceExceptionTypeSchema.optional(), status: attendanceConfirmationStatusSchema.optional(),
}).strict();

export const dailyAttendanceRowSchema = z.object({
  id: z.string(), revision: z.number().int().positive(), userId: z.string(), employeeName: z.string(), date: dateOnlySchema,
  type: attendanceExceptionTypeSchema, minutes: z.number().int().nonnegative().nullable(), status: attendanceConfirmationStatusSchema,
  confirmedAt: z.string().datetime().nullable(),
});

export const recalculateAttendanceSchema = z.object({
  from: dateOnlySchema, to: dateOnlySchema, userIds: z.array(z.string().min(1)).min(1).max(200).optional(),
}).strict();

export const expectedAttendanceRevisionSchema = z.object({ id: z.string().min(1), revision: z.number().int().positive() }).strict();
export const attendanceTransitionSchema = z.object({ items: z.array(expectedAttendanceRevisionSchema).min(1).max(200) }).strict();

const proxyBase = { userId: z.string().min(1), reason: z.string().trim().min(1).max(500) };
export const proxyAttendanceRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("proxy_leave"), ...proxyBase, type: z.enum(["annual", "sick"]),
    startTime: z.string().datetime({ offset: true }), endTime: z.string().datetime({ offset: true }), isFullDay: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("proxy_punch_correction"), ...proxyBase, date: dateOnlySchema,
    direction: attendanceDirectionSchema, requestedTime: z.string().datetime({ offset: true }),
  }).strict(),
]);

export type PunchInput = z.infer<typeof punchInputSchema>;
export type PunchHistoryQuery = z.infer<typeof punchHistoryQuerySchema>;
export type DailyAttendanceQuery = z.infer<typeof dailyAttendanceQuerySchema>;
export type RecalculateAttendanceInput = z.infer<typeof recalculateAttendanceSchema>;
export type ProxyAttendanceRequest = z.infer<typeof proxyAttendanceRequestSchema>;
