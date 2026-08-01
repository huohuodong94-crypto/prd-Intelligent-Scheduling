import { createClockCode } from "@/features/attendance/server/clock-code";
import { fail, ok } from "@/lib/api";
import { requireStoreAccess } from "@/lib/authorization";
import { ClockCodeConfigurationError, getAttendanceNow, getClockCodeSecret } from "@/lib/config";

export async function GET() {
  const access = await requireStoreAccess(["manager"]);
  if ("error" in access) return fail(access.error, access.status);
  try {
    const now = getAttendanceNow();
    const secret = getClockCodeSecret();
    const current = createClockCode(access.scope.storeId, now, secret);
    const previous = createClockCode(access.scope.storeId, new Date(now.getTime() - 60_000), secret);
    return ok({
      code: current.code,
      currentCode: current.code,
      previousCode: previous.code,
      refreshAt: current.refreshAt,
      expiresAt: current.expiresAt,
    });
  } catch (error) {
    if (error instanceof ClockCodeConfigurationError) return fail(error.message, 500);
    throw error;
  }
}
