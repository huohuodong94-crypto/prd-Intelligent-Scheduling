import { beforeEach, describe, expect, it, vi } from "vitest";

const attendanceState = vi.hoisted(() => ({ getMonthlyAttendance: vi.fn() }));
vi.mock("@/features/attendance/server/monthly-attendance-service", () => ({
  getMonthlyAttendance: attendanceState.getMonthlyAttendance,
}));

import type { StoreScope } from "@/lib/authorization";
import { calculateAiMetrics, getMonthlyReport, ReportServiceError } from "./report-service";

const managerScope: StoreScope = {
  user: { id: "manager-a", phone: "13800000000", name: "店长", role: "manager", storeId: "store-a" },
  storeId: "store-a",
};

beforeEach(() => vi.clearAllMocks());

describe("monthly report projection", () => {
  it("projects the canonical monthly rows and derives every total from those same rows", async () => {
    attendanceState.getMonthlyAttendance.mockResolvedValue([
      {
        userId: "employee-a", employeeName: "小王", month: "2026-07",
        scheduledHours: 32, workedHours: 28, leaveHours: 4, correctionHours: 4,
        exceptionCount: 1, unconfirmedExceptionCount: 0, zeroAttendance: false,
        zeroAttendanceAction: "none", status: "confirmed", confirmedByName: "店长",
        confirmedAt: "2026-07-31T00:00:00.000Z", revision: 1, sourceHash: "hash-a",
        needsReconfirmation: false, lastInvalidationReason: null,
      },
      {
        userId: "employee-b", employeeName: "小李", month: "2026-07",
        scheduledHours: 16, workedHours: 8, leaveHours: 0, correctionHours: 0,
        exceptionCount: 2, unconfirmedExceptionCount: 1, zeroAttendance: false,
        zeroAttendanceAction: "none", status: "unconfirmed", confirmedByName: null,
        confirmedAt: null, revision: 2, sourceHash: "hash-b",
        needsReconfirmation: true, lastInvalidationReason: "punch_created",
      },
    ]);

    await expect(getMonthlyReport(managerScope, "2026-07")).resolves.toEqual({
      month: "2026-07",
      rows: [
        { userId: "employee-a", employeeName: "小王", scheduledHours: 32, workedHours: 28, leaveHours: 4, correctionHours: 4, exceptionCount: 1, confirmationStatus: "confirmed" },
        { userId: "employee-b", employeeName: "小李", scheduledHours: 16, workedHours: 8, leaveHours: 0, correctionHours: 0, exceptionCount: 2, confirmationStatus: "unconfirmed" },
      ],
      totals: { scheduledHours: 48, workedHours: 36, leaveHours: 4, correctionHours: 4, exceptionCount: 3 },
    });
    expect(attendanceState.getMonthlyAttendance).toHaveBeenCalledOnce();
    expect(attendanceState.getMonthlyAttendance).toHaveBeenCalledWith(managerScope, "2026-07");
  });

  it("rejects employees and forged cross-store manager scopes inside the service", async () => {
    await expect(getMonthlyReport({ ...managerScope, user: { ...managerScope.user, role: "employee" } }, "2026-07"))
      .rejects.toBeInstanceOf(ReportServiceError);
    await expect(getMonthlyReport({ ...managerScope, storeId: "store-b" }, "2026-07"))
      .rejects.toMatchObject({ status: 403 });
    expect(attendanceState.getMonthlyAttendance).not.toHaveBeenCalled();
  });
});

describe("AI metrics", () => {
  it("returns null rates without canonical generations and includes a zero edit ratio in the average", () => {
    expect(calculateAiMetrics([])).toEqual({
      generatedPlans: 0,
      acceptedPlans: 0,
      editedPlans: 0,
      acceptanceRate: null,
      averageEditRatio: null,
    });
    expect(calculateAiMetrics([
      { wasAccepted: true, wasEdited: false, editRatio: 0 },
      { wasAccepted: false, wasEdited: true, editRatio: 0.25 },
    ])).toEqual({
      generatedPlans: 2,
      acceptedPlans: 1,
      editedPlans: 1,
      acceptanceRate: 0.5,
      averageEditRatio: 0.125,
    });
  });
});
