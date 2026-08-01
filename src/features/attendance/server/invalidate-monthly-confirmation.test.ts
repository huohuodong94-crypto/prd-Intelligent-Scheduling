import { beforeEach, describe, expect, it } from "vitest";

import { prisma, resetTestDb } from "../../../../tests/helpers/test-db";
import { invalidateMonthlyConfirmations } from "./invalidate-monthly-confirmation";

beforeEach(resetTestDb);

async function fixture() {
  const store = await prisma.store.create({ data: { id: "store-a", name: "A", code: "A" } });
  const manager = await prisma.user.create({ data: { id: "manager-a", phone: "m-a", name: "店长", role: "manager", storeId: store.id } });
  const e1 = await prisma.user.create({ data: { id: "employee-1", phone: "e-1", name: "小王", role: "employee", storeId: store.id } });
  const e2 = await prisma.user.create({ data: { id: "employee-2", phone: "e-2", name: "小李", role: "employee", storeId: store.id } });
  for (const userId of [e1.id, e2.id]) for (const month of ["2026-07", "2026-08"]) {
    await prisma.monthlyAttendanceConfirmation.create({ data: {
      storeId: store.id, userId, month, status: "confirmed", revision: 3,
      zeroAttendanceAction: "supplement_hours", sourceHash: `${userId}-${month}`,
      sourceSnapshotJson: JSON.stringify({ userId, month }), confirmedById: manager.id, confirmedAt: new Date(),
    } });
  }
  return { store, manager, e1, e2 };
}

describe("paired monthly invalidation", () => {
  it("invalidates only exact user-month pairs and preserves the old decision in append-only audit", async () => {
    const { store, manager, e1, e2 } = await fixture();
    const count = await prisma.$transaction((tx) => invalidateMonthlyConfirmations(tx, {
      storeId: store.id,
      changes: [
        { userId: e1.id, localDate: "2026-07-31", reason: "punch_created", actorId: e1.id, sourceRef: "punch:p1" },
        { userId: e2.id, localDate: "2026-08-01", reason: "daily_confirmation_changed", actorId: manager.id, sourceRef: "daily:c1" },
      ],
    }));

    expect(count).toBe(2);
    const rows = await prisma.monthlyAttendanceConfirmation.findMany({ orderBy: [{ userId: "asc" }, { month: "asc" }] });
    expect(rows.map(({ userId, month, status }) => ({ userId, month, status }))).toEqual([
      { userId: e1.id, month: "2026-07", status: "unconfirmed" },
      { userId: e1.id, month: "2026-08", status: "confirmed" },
      { userId: e2.id, month: "2026-07", status: "confirmed" },
      { userId: e2.id, month: "2026-08", status: "unconfirmed" },
    ]);
    expect(rows.filter((row) => row.status === "unconfirmed")).toEqual(expect.arrayContaining([
      expect.objectContaining({ revision: 4, zeroAttendanceAction: "none", sourceHash: null, sourceSnapshotJson: null, confirmedById: null, confirmedAt: null }),
    ]));
    expect(await prisma.monthlyAttendanceAuditEvent.findMany()).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: "invalidated", fromStatus: "confirmed", toStatus: "unconfirmed", revision: 4, zeroAttendanceAction: "supplement_hours", reason: "punch_created", sourceRef: "punch:p1" }),
    ]));
  });

  it("rolls source mutation back when invalidation fails", async () => {
    const { store, e1 } = await fixture();
    await expect(prisma.$transaction(async (tx) => {
      await tx.attendanceRecord.create({ data: { userId: e1.id, storeId: store.id, time: new Date(), direction: "in", viaCode: true, clockWindow: "rollback" } });
      await invalidateMonthlyConfirmations(tx, {
        storeId: store.id,
        changes: [{ userId: e1.id, localDate: "not-a-date", reason: "punch_created", actorId: e1.id, sourceRef: "punch:rollback" }],
      });
    })).rejects.toThrow();
    expect(await prisma.attendanceRecord.count()).toBe(0);
  });
});
