import { describe, expect, it } from "vitest";
import { calculateDailyAttendance, type DailyAttendanceInput } from "./calculate-daily-attendance";

const input = (partial: Partial<DailyAttendanceInput> = {}): DailyAttendanceInput => ({
  date: "2026-07-20",
  assignments: [{ userId: "e1", date: "2026-07-20", shiftType: "morning" }],
  punches: [], approvedLeaves: [], approvedCorrections: [], ...partial,
});

describe("daily attendance calculator", () => {
  it("counts only the union of approved leave that overlaps scheduled intervals", () => {
    const result = calculateDailyAttendance(input({
      approvedLeaves: [
        { startTime: new Date("2026-07-20T08:00:00+08:00"), endTime: new Date("2026-07-20T10:00:00+08:00") },
        { startTime: new Date("2026-07-20T09:30:00+08:00"), endTime: new Date("2026-07-20T11:00:00+08:00") },
        { startTime: new Date("2026-07-20T14:00:00+08:00"), endTime: new Date("2026-07-20T15:00:00+08:00") },
      ],
    }));

    expect(result.leaveHours).toBe(2);
    expect(result.scheduledHours).toBe(2);
  });

  it("returns four leave hours and zero scheduled hours for a full approved shift leave", () => {
    expect(calculateDailyAttendance(input({
      approvedLeaves: [
        { startTime: new Date("2026-07-20T09:00:00+08:00"), endTime: new Date("2026-07-20T13:00:00+08:00") },
      ],
    }))).toMatchObject({ leaveHours: 4, scheduledHours: 0 });
  });

  it("does not count raw punch pairs as correction hours", () => {
    expect(calculateDailyAttendance(input({
      punches: [
        { time: new Date("2026-07-20T09:00:00+08:00"), direction: "in" },
        { time: new Date("2026-07-20T13:00:00+08:00"), direction: "out" },
      ],
    }))).toMatchObject({ workedHours: 4, correctionHours: 0 });
  });

  it("counts a corrected pair once using its complete paired duration", () => {
    expect(calculateDailyAttendance(input({
      approvedCorrections: [
        { requestedTime: new Date("2026-07-20T09:00:00+08:00"), direction: "in" },
        { requestedTime: new Date("2026-07-20T13:00:00+08:00"), direction: "out" },
      ],
    }))).toMatchObject({ workedHours: 4, correctionHours: 4 });
  });

  it("counts a mixed raw and corrected pair using its complete paired duration without mutating input", () => {
    const value = input({
      punches: [
        { time: new Date("2026-07-20T09:00:00+08:00"), direction: "in" },
      ],
      approvedCorrections: [
        { requestedTime: new Date("2026-07-20T13:00:00+08:00"), direction: "out" },
      ],
    });
    const before = JSON.stringify(value);

    expect(calculateDailyAttendance(value)).toMatchObject({ workedHours: 4, correctionHours: 4 });
    expect(JSON.stringify(value)).toBe(before);
  });

  it("calculates split-shift late, early leave and real paired hours", () => {
    const result = calculateDailyAttendance(input({
      assignments: [
        { userId: "e1", date: "2026-07-20", shiftType: "morning" },
        { userId: "e1", date: "2026-07-20", shiftType: "evening" },
      ],
      punches: [
        { time: new Date("2026-07-20T09:10:00+08:00"), direction: "in" },
        { time: new Date("2026-07-20T20:50:00+08:00"), direction: "out" },
      ],
    }));
    expect(result.exceptions).toEqual([{ type: "late", minutes: 10 }, { type: "early_leave", minutes: 10 }]);
    expect(result.scheduledHours).toBe(8);
    expect(result.workedHours).toBeCloseTo(11 + 40 / 60);
  });

  it("handles missing directions, leave, corrections, unscheduled work and stable inputs", () => {
    expect(calculateDailyAttendance(input()).exceptions.map((row) => row.type)).toEqual(["missing_in", "missing_out"]);
    expect(calculateDailyAttendance(input({ assignments: [], punches: [{ time: new Date("2026-07-20T09:00:00+08:00"), direction: "in" }] })).exceptions).toEqual([{ type: "unscheduled", minutes: null }]);
    expect(calculateDailyAttendance(input({ approvedLeaves: [{ startTime: new Date("2026-07-20T09:00:00+08:00"), endTime: new Date("2026-07-20T13:00:00+08:00") }] }))).toMatchObject({ scheduledHours: 0, exceptions: [] });
    const value = input({ approvedCorrections: [
      { requestedTime: new Date("2026-07-20T09:00:00+08:00"), direction: "in" },
      { requestedTime: new Date("2026-07-20T13:00:00+08:00"), direction: "out" },
    ] });
    const before = JSON.stringify(value);
    expect(calculateDailyAttendance(value)).toMatchObject({ workedHours: 4, exceptions: [] });
    expect(JSON.stringify(value)).toBe(before);
  });
});
