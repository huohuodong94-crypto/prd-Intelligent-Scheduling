import { describe, expect, it } from "vitest";

import {
  attendanceTransitionSchema,
  clockCodeResponseSchema,
  dailyAttendanceQuerySchema,
  punchHistoryQuerySchema,
  punchHistoryRowSchema,
  punchInputSchema,
  proxyAttendanceRequestSchema,
  recalculateAttendanceSchema,
} from "./attendance";
import { getClockCodeSecret } from "@/lib/config";

describe("attendance contracts", () => {
  it("returns both accepted clock-code windows without exposing configuration", () => {
    const response = {
      code: "123456",
      currentCode: "123456",
      previousCode: "654321",
      refreshAt: "2026-07-19T01:01:00.000Z",
      expiresAt: "2026-07-19T01:02:00.000Z",
    };
    expect(clockCodeResponseSchema.parse(response)).toEqual(response);
  });

  it("accepts only a six-digit self-punch payload", () => {
    expect(punchInputSchema.parse({ direction: "in", code: "012345" })).toEqual({ direction: "in", code: "012345" });
    expect(punchInputSchema.safeParse({ direction: "in", code: "12345" }).success).toBe(false);
    expect(punchInputSchema.safeParse({ direction: "in", code: "123456", storeId: "forged" }).success).toBe(false);
    expect(punchInputSchema.safeParse({ direction: "out", code: "123456", userId: "forged" }).success).toBe(false);
  });

  it("validates scoped history and daily filters", () => {
    expect(punchHistoryQuerySchema.parse({ storeId: "s1", from: "2026-07-01", to: "2026-07-20", direction: "out", source: "correction" })).toMatchObject({ source: "correction" });
    expect(punchHistoryQuerySchema.parse({ source: "legacy" })).toEqual({ source: "legacy" });
    expect(punchHistoryQuerySchema.safeParse({ from: "07/01/2026", source: "raw" }).success).toBe(false);
    expect(punchHistoryRowSchema.parse({
      id: "p1", userId: "e1", employeeName: "员工", storeId: "s1", time: "2026-07-20T01:00:00.000Z",
      direction: "in", source: "legacy", valid: false,
    })).toMatchObject({ source: "legacy", valid: false });
    expect(dailyAttendanceQuerySchema.parse({ storeId: "s1", from: "2026-07-20", to: "2026-07-20", type: "late", status: "unconfirmed" })).toMatchObject({ type: "late" });
    expect(dailyAttendanceQuerySchema.safeParse({ type: "overtime" }).success).toBe(false);
  });

  it("requires revision-aware transitions and bounded recalculation", () => {
    expect(attendanceTransitionSchema.parse({ items: [{ id: "x", revision: 2 }] })).toEqual({ items: [{ id: "x", revision: 2 }] });
    expect(attendanceTransitionSchema.safeParse({ items: [{ id: "x" }] }).success).toBe(false);
    expect(recalculateAttendanceSchema.parse({ from: "2026-07-20", to: "2026-07-21", userIds: ["e1"] })).toMatchObject({ userIds: ["e1"] });
  });

  it("validates manager proxy leave and correction payloads", () => {
    expect(proxyAttendanceRequestSchema.parse({ action: "proxy_leave", userId: "e1", type: "annual", startTime: "2026-07-20T09:00:00+08:00", endTime: "2026-07-20T13:00:00+08:00", isFullDay: false, reason: "门店代提" })).toMatchObject({ action: "proxy_leave" });
    expect(proxyAttendanceRequestSchema.parse({ action: "proxy_punch_correction", userId: "e1", date: "2026-07-20", direction: "in", requestedTime: "2026-07-20T09:00:00+08:00", reason: "漏打卡" })).toMatchObject({ action: "proxy_punch_correction" });
    expect(proxyAttendanceRequestSchema.safeParse({ action: "proxy_leave", userId: "e1" }).success).toBe(false);
  });
});

describe("clock-code secret configuration", () => {
  it("rejects missing or development-default secrets in production", () => {
    expect(() => getClockCodeSecret({ nodeEnv: "production", secret: "" })).toThrow("动态码服务配置错误");
    expect(() => getClockCodeSecret({ nodeEnv: "production", secret: "replace-with-a-long-random-secret" })).toThrow("动态码服务配置错误");
    expect(getClockCodeSecret({ nodeEnv: "production", secret: "a-real-production-secret" })).toBe("a-real-production-secret");
  });
});
