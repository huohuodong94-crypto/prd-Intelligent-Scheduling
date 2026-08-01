import { requireSession } from "@/lib/auth";
import { fail, ok } from "@/lib/api";
import { listStoreOptions } from "@/features/store/server/store-service";

export async function GET() {
  const auth = await requireSession(["manager", "admin"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  return ok(await listStoreOptions(auth.user));
}
