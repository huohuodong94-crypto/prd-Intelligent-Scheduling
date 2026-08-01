import type { Prisma } from "@prisma/client";

import type { MonthlyInvalidationChange } from "@/lib/contracts/monthly-attendance";
import { shanghaiDateValue } from "@/lib/dates";

type Group = {
  userId: string;
  month: string;
  reasons: Set<string>;
  actors: Set<string>;
  sourceRefs: Set<string>;
};

export async function invalidateMonthlyConfirmations(
  tx: Prisma.TransactionClient,
  input: { storeId: string; changes: MonthlyInvalidationChange[] },
): Promise<number> {
  const groups = new Map<string, Group>();
  for (const change of input.changes) {
    shanghaiDateValue(change.localDate);
    if (!change.userId || !change.actorId || !change.sourceRef) throw new Error("invalid monthly invalidation change");
    const month = change.localDate.slice(0, 7);
    const key = `${change.userId}:${month}`;
    const group = groups.get(key) ?? {
      userId: change.userId,
      month,
      reasons: new Set<string>(),
      actors: new Set<string>(),
      sourceRefs: new Set<string>(),
    };
    group.reasons.add(change.reason);
    group.actors.add(change.actorId);
    group.sourceRefs.add(change.sourceRef);
    groups.set(key, group);
  }
  if (!groups.size) return 0;
  const pairs = [...groups.values()].map(({ userId, month }) => ({ userId, month }));
  const rows = await tx.monthlyAttendanceConfirmation.findMany({
    where: { storeId: input.storeId, status: "confirmed", OR: pairs },
  });
  let count = 0;
  for (const row of rows) {
    const group = groups.get(`${row.userId}:${row.month}`);
    if (!group) continue;
    const changed = await tx.monthlyAttendanceConfirmation.updateMany({
      where: { id: row.id, storeId: input.storeId, userId: row.userId, month: row.month, status: "confirmed", revision: row.revision },
      data: {
        status: "unconfirmed",
        revision: { increment: 1 },
        zeroAttendanceAction: "none",
        confirmedById: null,
        confirmedAt: null,
        sourceHash: null,
        sourceSnapshotJson: null,
      },
    });
    if (changed.count !== 1) throw new Error("monthly confirmation stale during invalidation");
    await tx.monthlyAttendanceAuditEvent.create({ data: {
      confirmationId: row.id,
      storeId: input.storeId,
      userId: row.userId,
      month: row.month,
      eventType: "invalidated",
      fromStatus: "confirmed",
      toStatus: "unconfirmed",
      revision: row.revision + 1,
      zeroAttendanceAction: row.zeroAttendanceAction,
      actorId: [...group.actors].sort()[0],
      reason: [...group.reasons].sort().join(","),
      sourceRef: [...group.sourceRefs].sort().join(","),
      sourceHash: row.sourceHash,
      sourceSnapshotJson: row.sourceSnapshotJson,
    } });
    count += 1;
  }
  return count;
}
