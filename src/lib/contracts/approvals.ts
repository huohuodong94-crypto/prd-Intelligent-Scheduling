import { z } from "zod";

export const approvalTypeSchema = z.enum(["leave", "punch_correction", "shift_swap"]);
export const approvalDecisionValueSchema = z.enum(["approved", "rejected"]);
export const approvalIdentitySchema = z.object({
  id: z.string().min(1),
  type: approvalTypeSchema,
});
export const approvalDecisionSchema = z
  .object({
    storeId: z.string().min(1).optional(),
    items: z.array(approvalIdentitySchema).min(1),
    decision: approvalDecisionValueSchema,
    reason: z.string().trim().max(500).nullable().default(null),
    aiLogIds: z.array(z.string().min(1)).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.decision === "rejected" && !value.reason?.trim()) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "驳回原因不能为空" });
    }
  });

export const approvalQuerySchema = z.object({
  status: z.enum(["pending", "history"]).default("pending"),
  type: approvalTypeSchema.optional(),
  storeId: z.string().min(1).optional(),
});

export const approvalAiCheckSchema = z.object({
  id: z.string().min(1),
  type: approvalTypeSchema,
  storeId: z.string().min(1).optional(),
});

export const createPunchCorrectionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  direction: z.enum(["in", "out"]),
  requestedTime: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(1).max(500),
});

export const createShiftSwapSchema = z.object({
  reqScheduleId: z.string().min(1),
  targetUserId: z.string().min(1),
  tgtScheduleId: z.string().min(1),
});

export const acceptTargetSwapSchema = z.object({
  action: z.literal("accept_target"),
  requestId: z.string().min(1),
});

export type ApprovalType = z.infer<typeof approvalTypeSchema>;
export type ApprovalDecision = z.infer<typeof approvalDecisionValueSchema>;
export type ApprovalIdentity = z.infer<typeof approvalIdentitySchema>;
export type ApprovalDecisionInput = z.input<typeof approvalDecisionSchema>;
export type NormalizedApprovalDecisionInput = z.output<typeof approvalDecisionSchema>;
export type ApprovalQuery = z.output<typeof approvalQuerySchema>;
export type CreatePunchCorrectionInput = z.infer<typeof createPunchCorrectionSchema>;
export type CreateShiftSwapInput = z.infer<typeof createShiftSwapSchema>;
export type AiAdvice = { suggestion: "compliant" | "suspicious"; reason: string };

export type ApprovalItem = {
  id: string;
  type: ApprovalType;
  storeId: string;
  userId: string;
  employeeName: string;
  submittedAt: string;
  status: "pending" | "approved" | "rejected";
  summary: string;
  aiSuggestion: "compliant" | "suspicious" | null;
  aiReason: string | null;
  decidedAt?: string | null;
  decisionReason?: string | null;
};
