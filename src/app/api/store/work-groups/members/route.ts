import { fail, ok, readJson } from "@/lib/api";
import { requireStoreAccess } from "@/lib/authorization";
import {
  deleteWorkGroupMemberSchema,
  workGroupMemberSchema,
} from "@/lib/contracts/workforce";
import {
  addWorkGroupMember,
  deleteWorkGroupMember,
  workforceErrorResponse,
} from "@/features/store/server/workforce-service";

export async function POST(req: Request) {
  const parsed = workGroupMemberSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  const auth = await requireStoreAccess(["manager"], parsed.data.storeId);
  if ("error" in auth) return fail(auth.error, auth.status);
  try {
    return ok(await addWorkGroupMember(auth.scope, parsed.data), 201);
  } catch (error) {
    const mapped = workforceErrorResponse(error);
    return fail(mapped.message, mapped.status);
  }
}

export async function DELETE(req: Request) {
  const parsed = deleteWorkGroupMemberSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  const auth = await requireStoreAccess(["manager"], parsed.data.storeId);
  if ("error" in auth) return fail(auth.error, auth.status);
  try {
    return ok(await deleteWorkGroupMember(auth.scope, parsed.data.id));
  } catch (error) {
    const mapped = workforceErrorResponse(error);
    return fail(mapped.message, mapped.status);
  }
}
