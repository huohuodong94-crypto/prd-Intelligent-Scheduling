import { SHIFT_TIMES, type Shift } from "@/lib/config";

export type AttendanceExceptionType = "late" | "early_leave" | "missing_in" | "missing_out" | "unscheduled";
export type ScheduleAssignment = { userId: string; date: string; shiftType: Shift };
export type DailyAttendanceInput = {
  date: string;
  assignments: ScheduleAssignment[];
  punches: Array<{ time: Date; direction: "in" | "out" }>;
  approvedLeaves: Array<{ startTime: Date; endTime: Date }>;
  approvedCorrections: Array<{ requestedTime: Date; direction: "in" | "out" }>;
};
export type DailyAttendanceResult = {
  scheduledHours: number;
  workedHours: number;
  leaveHours: number;
  correctionHours: number;
  firstIn: string | null;
  lastOut: string | null;
  exceptions: Array<{ type: AttendanceExceptionType; minutes: number | null }>;
};

type Interval = { start: number; end: number };

function localTime(date: string, hour: number): number {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+08:00`).getTime();
}

function subtract(intervals: Interval[], leaves: Interval[]): Interval[] {
  let result = intervals.map((row) => ({ ...row }));
  for (const leave of leaves) {
    result = result.flatMap((row) => {
      if (leave.end <= row.start || leave.start >= row.end) return [row];
      const parts: Interval[] = [];
      if (leave.start > row.start) parts.push({ start: row.start, end: Math.min(leave.start, row.end) });
      if (leave.end < row.end) parts.push({ start: Math.max(leave.end, row.start), end: row.end });
      return parts.filter((part) => part.end > part.start);
    });
  }
  return result;
}

export function calculateDailyAttendance(input: DailyAttendanceInput): DailyAttendanceResult {
  const scheduled = input.assignments.map((assignment) => {
    const shift = SHIFT_TIMES[assignment.shiftType];
    return { start: localTime(input.date, shift.start), end: localTime(input.date, shift.end) };
  });
  const leaves = input.approvedLeaves.map((leave) => ({ start: leave.startTime.getTime(), end: leave.endTime.getTime() }));
  const expected = subtract(scheduled, leaves).sort((a, b) => a.start - b.start);
  const events = [
    ...input.punches.map((row) => ({ time: row.time.getTime(), direction: row.direction, source: "punch" as const })),
    ...input.approvedCorrections.map((row) => ({ time: row.requestedTime.getTime(), direction: row.direction, source: "correction" as const })),
  ].sort((a, b) => a.time - b.time);
  const ins = events.filter((row) => row.direction === "in");
  const outs = events.filter((row) => row.direction === "out");
  let open: (typeof events)[number] | null = null;
  let workedMs = 0;
  let correctionMs = 0;
  for (const event of events) {
    if (event.direction === "in") {
      if (open === null) open = event;
    } else if (open !== null && event.time >= open.time) {
      const pairedMs = event.time - open.time;
      workedMs += pairedMs;
      if (open.source === "correction" || event.source === "correction") correctionMs += pairedMs;
      open = null;
    }
  }
  const exceptions: DailyAttendanceResult["exceptions"] = [];
  if (!scheduled.length && !leaves.length && events.length) {
    exceptions.push({ type: "unscheduled", minutes: null });
  } else if (expected.length) {
    if (!ins.length) exceptions.push({ type: "missing_in", minutes: null });
    if (!outs.length) exceptions.push({ type: "missing_out", minutes: null });
    if (ins.length) {
      const minutes = Math.max(0, Math.round((ins[0].time - expected[0].start) / 60_000));
      if (minutes) exceptions.push({ type: "late", minutes });
    }
    if (outs.length) {
      const minutes = Math.max(0, Math.round((expected.at(-1)!.end - outs.at(-1)!.time) / 60_000));
      if (minutes) exceptions.push({ type: "early_leave", minutes });
    }
  }
  return {
    scheduledHours: expected.reduce((sum, row) => sum + row.end - row.start, 0) / 3_600_000,
    workedHours: workedMs / 3_600_000,
    leaveHours: (scheduled.reduce((sum, row) => sum + row.end - row.start, 0)
      - expected.reduce((sum, row) => sum + row.end - row.start, 0)) / 3_600_000,
    correctionHours: correctionMs / 3_600_000,
    firstIn: ins.length ? new Date(ins[0].time).toISOString() : null,
    lastOut: outs.length ? new Date(outs.at(-1)!.time).toISOString() : null,
    exceptions,
  };
}
