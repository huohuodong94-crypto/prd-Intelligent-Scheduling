import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { validateMonthlyConfirmation, type MonthlyAttendanceRow, type MonthlySourceSnapshot } from "@/lib/contracts/monthly-attendance";
import {
  assertMonthNotFuture,
  hashMonthlySnapshot,
  shanghaiMonthBounds,
  unconfirmMonthlyAttendance,
} from "./monthly-attendance-service";

const dbState = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: dbState.transaction } }));

afterEach(() => vi.clearAllMocks());

function row(overrides: Partial<MonthlyAttendanceRow> = {}): MonthlyAttendanceRow {
  return {
    userId: "employee-a",
    employeeName: "小王",
    month: "2026-07",
    scheduledHours: 40,
    workedHours: 32,
    leaveHours: 8,
    correctionHours: 0,
    exceptionCount: 0,
    unconfirmedExceptionCount: 0,
    zeroAttendance: false,
    zeroAttendanceAction: "none",
    status: "unconfirmed",
    confirmedByName: null,
    confirmedAt: null,
    revision: 0,
    sourceHash: "hash-a",
    needsReconfirmation: false,
    lastInvalidationReason: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<MonthlySourceSnapshot> = {}): MonthlySourceSnapshot {
  return {
    storeId: "store-a",
    userId: "employee-a",
    month: "2026-07",
    schedules: [
      { id: "s2", localDate: "2026-07-02", shiftType: "morning" },
      { id: "s1", localDate: "2026-07-01", shiftType: "evening" },
    ],
    punches: [
      { id: "p2", time: "2026-07-01T09:00:00.000Z", direction: "out" },
      { id: "p1", time: "2026-07-01T01:00:00.000Z", direction: "in" },
    ],
    leaves: [],
    corrections: [],
    days: [
      { localDate: "2026-07-02", scheduledHours: 8, workedHours: 0, exceptions: [{ type: "missing_in", minutes: null }] },
      { localDate: "2026-07-01", scheduledHours: 8, workedHours: 8, exceptions: [] },
    ],
    confirmations: [{ id: "c1", localDate: "2026-07-02", type: "missing_in", status: "unconfirmed", revision: 1 }],
    ...overrides,
  };
}

describe("monthly attendance confirmation rules", () => {
  it("blocks the whole batch with precise employee reasons", () => {
    expect(validateMonthlyConfirmation([
      row({ userId: "e1", unconfirmedExceptionCount: 1 }),
      row({ userId: "e2", scheduledHours: 8, workedHours: 0, zeroAttendance: true }),
    ])).toEqual({
      ok: false,
      blocked: [
        { userId: "e1", reasons: ["仍有 1 条未确认日异常"] },
        { userId: "e2", reasons: ["0 考勤必须选择处理方式"] },
      ],
    });
  });

  it("does not classify approved full-day leave as zero attendance and rejects labels on non-zero rows", () => {
    expect(validateMonthlyConfirmation([row({ scheduledHours: 0, workedHours: 0 })])).toEqual({ ok: true, blocked: [] });
    expect(validateMonthlyConfirmation([row({ zeroAttendanceAction: "normal_attendance" })])).toEqual({
      ok: false,
      blocked: [{ userId: "employee-a", reasons: ["非 0 考勤不能选择处理方式"] }],
    });
  });
});

describe("canonical source hash", () => {
  it("is stable across source ordering but changes for a current fact", () => {
    const original = snapshot();
    const reordered = snapshot({
      schedules: [...original.schedules].reverse(),
      punches: [...original.punches].reverse(),
      days: [...original.days].reverse(),
    });
    expect(hashMonthlySnapshot(reordered)).toBe(hashMonthlySnapshot(original));
    expect(hashMonthlySnapshot(snapshot({ punches: [...original.punches, { id: "p3", time: "2026-07-02T01:00:00.000Z", direction: "in" }] })))
      .not.toBe(hashMonthlySnapshot(original));
  });
});

describe("Shanghai month boundaries", () => {
  it("keeps month-end instants in their Shanghai business month", () => {
    expect(shanghaiMonthBounds("2026-07")).toEqual({
      start: new Date("2026-06-30T16:00:00.000Z"),
      end: new Date("2026-07-31T16:00:00.000Z"),
    });
    expect(() => assertMonthNotFuture("2026-08", new Date("2026-07-31T15:59:59.000Z"))).toThrow(/future/i);
    expect(() => assertMonthNotFuture("2026-08", new Date("2026-07-31T16:00:00.000Z"))).not.toThrow();
  });
});

describe("monthly attendance transaction conflicts", () => {
  it("maps a PostgreSQL unconfirm write conflict to stale 409", async () => {
    dbState.transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
      "Transaction failed due to a write conflict or a deadlock",
      { code: "P2034", clientVersion: "5.22.0" },
    ));

    await expect(unconfirmMonthlyAttendance({
      user: { id: "manager-a", phone: "13800000000", name: "店长", role: "manager", storeId: "store-a" },
      storeId: "store-a",
    }, {
      month: "2026-07",
      rows: [{ userId: "employee-a", expectedRevision: 1 }],
    })).rejects.toMatchObject({ status: 409, code: "stale" });
  });
});
