import { fail, ok } from "@/lib/api";
import { requireStoreAccess } from "@/lib/authorization";
import { getDashboardSummary } from "@/features/dashboard/server/dashboard-service";

export async function GET(request: Request) {
  const requestedStoreId = new URL(request.url).searchParams.get("storeId");
  const auth = await requireStoreAccess(
    ["employee", "manager", "admin"],
    requestedStoreId
  );
  if ("error" in auth) return fail(auth.error, auth.status);

  return ok(await getDashboardSummary(auth.scope.storeId));
}
