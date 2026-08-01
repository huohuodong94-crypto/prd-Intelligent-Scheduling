import { requireStoreAccess } from "@/lib/authorization";
import { fail, ok, readJson } from "@/lib/api";
import { updateOperatingDaysSchema } from "@/lib/contracts/store";
import {
  getOperatingDays,
  replaceOperatingDays,
} from "@/features/store/server/store-service";

export async function GET(req: Request) {
  const storeId = new URL(req.url).searchParams.get("storeId");
  const auth = await requireStoreAccess(["manager", "admin"], storeId);
  if ("error" in auth) return fail(auth.error, auth.status);
  return ok(await getOperatingDays(auth.scope));
}

export async function PUT(req: Request) {
  const parsed = updateOperatingDaysSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  const auth = await requireStoreAccess(["manager"], parsed.data.storeId);
  if ("error" in auth) return fail(auth.error, auth.status);
  return ok(await replaceOperatingDays(auth.scope, parsed.data.days));
}
