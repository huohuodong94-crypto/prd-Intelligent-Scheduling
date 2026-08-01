import { requireStoreAccess } from "@/lib/authorization";
import { fail, ok, readJson } from "@/lib/api";
import {
  createStoreEventSchema,
  deleteStoreEventSchema,
  storeEventsQuerySchema,
} from "@/lib/contracts/store";
import {
  createStoreEvent,
  deleteStoreEvent,
  getStoreEvents,
} from "@/features/store/server/store-service";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = storeEventsQuerySchema.safeParse({
    storeId: url.searchParams.get("storeId") || undefined,
    month: url.searchParams.get("month") || undefined,
    year: url.searchParams.get("year") || undefined,
  });
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  const auth = await requireStoreAccess(["manager", "admin"], parsed.data.storeId);
  if ("error" in auth) return fail(auth.error, auth.status);
  return ok(
    await getStoreEvents(auth.scope, {
      month: parsed.data.month,
      year: parsed.data.year,
    })
  );
}

export async function POST(req: Request) {
  const parsed = createStoreEventSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  const auth = await requireStoreAccess(["manager"], parsed.data.storeId);
  if ("error" in auth) return fail(auth.error, auth.status);
  return ok(await createStoreEvent(auth.scope, parsed.data));
}

export async function DELETE(req: Request) {
  const parsed = deleteStoreEventSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  const auth = await requireStoreAccess(["manager"], parsed.data.storeId);
  if ("error" in auth) return fail(auth.error, auth.status);
  return ok(await deleteStoreEvent(auth.scope, parsed.data));
}
