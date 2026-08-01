import { requireStoreAccess } from "@/lib/authorization";
import { fail, ok, readJson } from "@/lib/api";
import { storeBasicSchema } from "@/lib/contracts/store";
import { getStoreBasic, updateStoreBasic } from "@/features/store/server/store-service";

export async function GET(req: Request) {
  const storeId = new URL(req.url).searchParams.get("storeId");
  const auth = await requireStoreAccess(["manager", "admin"], storeId);
  if ("error" in auth) return fail(auth.error, auth.status);
  return ok(await getStoreBasic(auth.scope));
}

export async function PUT(req: Request) {
  const parsed = storeBasicSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  const auth = await requireStoreAccess(["manager"], parsed.data.storeId);
  if ("error" in auth) return fail(auth.error, auth.status);
  return ok(await updateStoreBasic(auth.scope, parsed.data));
}
