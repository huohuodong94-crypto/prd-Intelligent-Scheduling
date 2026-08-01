import { z } from "zod";
import { POSITIONS, SHIFTS } from "@/lib/config";

const storeId = z.string().min(1).optional();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "时间格式必须为 HH:mm");

// 单店配置的显式业务安全上限，同时远低于数据库 Int/Float 存储极限。
export const STORE_NUMERIC_LIMITS = {
  v2s: 10_000,
  minHeadcount: 100,
  eventFactor: 10,
} as const;

function isRealDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD")
  .refine(isRealDateOnly, "日期无效");

export const monthOnlySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "月份格式必须为 YYYY-MM");

export function dateOnlyToDate(value: string): Date {
  const parsed = dateOnlySchema.parse(value);
  const [year, month, day] = parsed.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function dateToDateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const storeBasicSchema = z.object({
  storeId,
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().min(1).max(32),
  address: z.string().trim().max(200).nullable(),
  active: z.boolean(),
});

export const storeBasicRecordSchema = storeBasicSchema.omit({ storeId: true }).extend({
  id: z.string().min(1),
});

export const storeOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  code: z.string(),
  active: z.boolean(),
});

export const storeOptionsResponseSchema = z.array(storeOptionSchema);

export const operatingDaySchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    isOpen: z.boolean(),
    openTime: hhmm,
    closeTime: hhmm,
  })
  .superRefine((value, ctx) => {
    if (value.isOpen && value.openTime >= value.closeTime) {
      ctx.addIssue({
        code: "custom",
        path: ["closeTime"],
        message: "结束时间必须晚于开始时间",
      });
    }
  });

export const updateOperatingDaysSchema = z
  .object({
    storeId,
    days: z.array(operatingDaySchema).length(7),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.days.map((day) => day.dayOfWeek)).size !== 7) {
      ctx.addIssue({
        code: "custom",
        path: ["days"],
        message: "星期必须覆盖 0 到 6 且不得重复",
      });
    }
  });

export const operatingDaysResponseSchema = z.array(operatingDaySchema);

export const v2sRowSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    v2sLower: z.number().finite().positive().max(STORE_NUMERIC_LIMITS.v2s),
    v2sUpper: z.number().finite().positive().max(STORE_NUMERIC_LIMITS.v2s),
  })
  .refine((row) => row.v2sLower <= row.v2sUpper, {
    path: ["v2sUpper"],
    message: "V2S 下限不得大于上限",
  });

export const updateV2SSchema = z
  .object({
    storeId,
    rows: z.array(v2sRowSchema).length(7),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.rows.map((row) => row.dayOfWeek)).size !== 7) {
      ctx.addIssue({
        code: "custom",
        path: ["rows"],
        message: "V2S 必须覆盖 0 到 6 且不得重复",
      });
    }
  });

export const v2sResponseSchema = z.array(v2sRowSchema);

export const staffingRowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  timeSlot: z.enum(SHIFTS),
  position: z.enum(POSITIONS),
  minHeadcount: z.number().finite().int().min(0).max(STORE_NUMERIC_LIMITS.minHeadcount),
});

export const updateStaffingSchema = z
  .object({
    storeId,
    rows: z.array(staffingRowSchema).length(42),
  })
  .superRefine((value, ctx) => {
    const keys = value.rows.map(
      (row) => `${row.dayOfWeek}:${row.timeSlot}:${row.position}`
    );
    if (new Set(keys).size !== 42) {
      ctx.addIssue({
        code: "custom",
        path: ["rows"],
        message: "最低人力必须包含 42 个唯一星期、班次和岗位组合",
      });
    }
  });

export const legacyStaffingRowSchema = staffingRowSchema.extend({
  storeId: z.string().min(1),
});

export const staffingResponseSchema = z.array(staffingRowSchema);

export const eventLabelSchema = z.enum(["promo", "new_arrival", "holiday"]);

export const storeEventSchema = z.object({
  date: dateOnlySchema,
  label: eventLabelSchema,
  factor: z.number().finite().positive().max(STORE_NUMERIC_LIMITS.eventFactor),
});

export const createStoreEventSchema = storeEventSchema.extend({ storeId });

export const deleteStoreEventSchema = z.object({
  storeId,
  date: dateOnlySchema,
  label: eventLabelSchema,
});

export const storeEventsQuerySchema = z
  .object({
    storeId,
    month: monthOnlySchema.optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.month && value.year !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["month"],
        message: "月份与年份只能选择一个",
      });
    }
  });

export const storeEventsResponseSchema = z.array(storeEventSchema);

export const legacyDemandResponseSchema = z.object({
  storeId: z.string().min(1),
  stores: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      code: z.string(),
      address: z.string().nullable(),
      active: z.boolean(),
      createdAt: z.union([z.date(), z.string().datetime()]),
    })
  ),
  configs: z.array(
    staffingRowSchema.extend({
      id: z.string().min(1),
      storeId: z.string().min(1),
    })
  ),
});

export type StoreBasicInput = z.infer<typeof storeBasicSchema>;
export type StoreBasicRecord = z.infer<typeof storeBasicRecordSchema>;
export type StoreOption = z.infer<typeof storeOptionSchema>;
export type OperatingDayInput = z.infer<typeof operatingDaySchema>;
export type V2SRow = z.infer<typeof v2sRowSchema>;
export type StaffingRow = z.infer<typeof staffingRowSchema>;
export type StoreEventInput = z.infer<typeof storeEventSchema>;
export type StoreEventKey = z.infer<typeof deleteStoreEventSchema>;
