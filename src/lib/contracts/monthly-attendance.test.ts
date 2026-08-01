import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { monthlyConfirmSchema, validateMonthlyConfirmation } from "./monthly-attendance";

describe("monthly attendance contract", () => {
  it("rejects duplicate employees before service execution", () => {
    expect(monthlyConfirmSchema.safeParse({
      month: "2026-07",
      rows: [
        { userId: "e1", zeroAttendanceAction: "none", expectedRevision: 0, expectedSourceHash: "a".repeat(64) },
        { userId: "e1", zeroAttendanceAction: "none", expectedRevision: 0, expectedSourceHash: "a".repeat(64) },
      ],
    }).success).toBe(false);
  });

  it("keeps the confirmation blocker in the pure shared contract", () => {
    expect(validateMonthlyConfirmation([{
      userId: "e1", employeeName: "小王", month: "2026-07", scheduledHours: 8, workedHours: 0,
      leaveHours: 0, correctionHours: 0,
      exceptionCount: 0, unconfirmedExceptionCount: 0, zeroAttendance: true, zeroAttendanceAction: "none",
      status: "unconfirmed", confirmedByName: null, confirmedAt: null, revision: 0, sourceHash: "a".repeat(64),
      needsReconfirmation: false, lastInvalidationReason: null,
    }])).toMatchObject({ ok: false });
  });

  it("prevents attendance client components from importing server modules", () => {
    const source = readFileSync(resolve(process.cwd(), "src/features/attendance/components/MonthlyAttendancePage.tsx"), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*(?:\/server\/|\.\.\/server)[^"']*["']/);
  });
});
