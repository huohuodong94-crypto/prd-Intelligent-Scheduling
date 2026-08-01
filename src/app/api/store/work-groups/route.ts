import { fail, ok, readJson } from "@/lib/api";
import { requireStoreAccess } from "@/lib/authorization";
import {
  deleteWorkGroupSchema,
  workforceQuerySchema,
  workGroupSchema,
} from "@/lib/contracts/workforce";
import {
  createWorkGroup,
  deleteWorkGroup,
  listWorkGroups,
  updateWorkGroup,
  workforceErrorResponse,
} from "@/features/store/server/workforce-service";

export async function GET(req: Request) {
  const parsed = workforceQuerySchema.safeParse({
    storeId: new URL(req.url).searchParams.get("storeId") || undefined,
  });
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  const auth = await requireStoreAccess(["manager", "admin"], parsed.data.storeId);
  if ("error" in auth) return fail(auth.error, auth.status);
  return ok(await listWorkGroups(auth.scope));
}

export async function POST(req: Request) {
  const parsed = workGroupSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  const auth = await requireStoreAccess(["manager"], parsed.data.storeId);
  if ("error" in auth) return fail(auth.error, auth.status);
  try {
    return ok(await createWorkGroup(auth.scope, parsed.data), 201);
  } catch (error) {
    const mapped = workforceErrorResponse(error);
    return fail(mapped.message, mapped.status);
  }
}

export async function PUT(req: Request) {
  const parsed = workGroupSchema.safeParse(await readJson(req));
  if (!parsed.success || !parsed.data.id) return fail("参数错误", 400, parsed.success ? undefined : parsed.error.flatten());
  const auth = await requireStoreAccess(["manager"], parsed.data.storeId);
  if ("error" in auth) return fail(auth.error, auth.status);
  try {
    return ok(await updateWorkGroup(auth.scope, { ...parsed.data, id: parsed.data.id }));
  } catch (error) {
    const mapped = workforceErrorResponse(error);
    return fail(mapped.message, mapped.status);
  }
}

export async function DELETE(req: Request) {
  const parsed = deleteWorkGroupSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  const auth = await requireStoreAccess(["manager"], parsed.data.storeId);
  if ("error" in auth) return fail(auth.error, auth.status);
  try {
    return ok(await deleteWorkGroup(auth.scope, parsed.data.id));
  } catch (error) {
    const mapped = workforceErrorResponse(error);
    return fail(mapped.message, mapped.status);
  }
}
