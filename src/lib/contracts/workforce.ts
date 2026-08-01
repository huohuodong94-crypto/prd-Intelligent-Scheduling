import { z } from "zod";

import { POSITIONS } from "@/lib/config";
import { dateOnlySchema } from "@/lib/contracts/store";

const storeId = z.string().min(1).optional();
const optionalId = z.string().min(1).optional();
const active = z.boolean().default(true);

export const workAreaSchema = z.object({
  id: optionalId,
  storeId,
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().min(1).max(32),
  active,
});

export const workGroupSchema = z.object({
  id: optionalId,
  storeId,
  name: z.string().trim().min(1).max(100),
  leaderId: z.string().min(1),
  volumeType: z.enum(["traffic", "delivery"]),
  active,
});

export const workGroupMemberSchema = z
  .object({
    storeId,
    workGroupId: z.string().min(1),
    userId: z.string().min(1),
    workAreaId: z.string().min(1),
    effectiveFrom: dateOnlySchema,
    effectiveTo: dateOnlySchema.nullable(),
  })
  .refine((value) => !value.effectiveTo || value.effectiveFrom <= value.effectiveTo, {
    path: ["effectiveTo"],
    message: "结束日期不得早于生效日期",
  });

export const deleteWorkAreaSchema = z.object({
  id: z.string().min(1),
  storeId,
});

export const deleteWorkGroupSchema = deleteWorkAreaSchema;

export const deleteWorkGroupMemberSchema = z.object({
  id: z.string().min(1),
  storeId,
});

export const workforceQuerySchema = z.object({ storeId });

const employeeFields = {
  phone: z.string().trim().min(1).max(32),
  employeeNo: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(100),
  position: z.enum(POSITIONS),
  employmentType: z.enum(["fulltime", "parttime"]),
  maxWeeklyHours: z.number().finite().positive().max(168),
  salesAbility: z.enum(["high", "mid", "low", "none"]),
  performanceBand: z.enum([
    "always",
    "almost_always",
    "frequently",
    "sometimes",
    "rarely",
  ]),
  hireDate: dateOnlySchema,
} as const;

export const employeeInputSchema = z.object({
  id: optionalId,
  storeId,
  ...employeeFields,
});

export const employeeOutputSchema = employeeInputSchema
  .omit({ storeId: true })
  .extend({
    id: z.string().min(1),
    employeeNo: z.string().nullable(),
  });

export type WorkAreaInput = z.infer<typeof workAreaSchema>;
export type WorkGroupInput = z.infer<typeof workGroupSchema>;
export type WorkGroupMemberInput = z.infer<typeof workGroupMemberSchema>;
export type EmployeeInput = z.infer<typeof employeeInputSchema>;
export type EmployeeOutput = z.infer<typeof employeeOutputSchema>;

export type EffectiveMembershipRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  workAreaName: string;
  workGroupName: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type WorkforcePageContext = {
  storeId: string;
  readOnly: boolean;
  onRefresh: () => Promise<void>;
};
