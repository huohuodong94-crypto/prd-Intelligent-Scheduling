import { fail, ok, readJson } from "@/lib/api";
import { requireStoreAccess } from "@/lib/authorization";
import { employeeInputSchema, workforceQuerySchema } from "@/lib/contracts/workforce";
import {
  createEmployee,
  listEmployees,
  updateEmployee,
  workforceErrorResponse,
} from "@/features/store/server/workforce-service";

export async function GET(req: Request) {
  const parsed = workforceQuerySchema.safeParse({
    storeId: new URL(req.url).searchParams.get("storeId") || undefined,
  });
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  const auth = await requireStoreAccess(["manager", "admin"], parsed.data.storeId);
  if ("error" in auth) return fail(auth.error, auth.status);
  return ok(await listEmployees(auth.scope));
}

export async function PUT(req: Request) {
  const parsed = employeeInputSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  const auth = await requireStoreAccess(["manager"], parsed.data.storeId);
  if ("error" in auth) return fail(auth.error, auth.status);
  try {
    return ok(parsed.data.id
      ? await updateEmployee(auth.scope, { ...parsed.data, id: parsed.data.id })
      : await createEmployee(auth.scope, parsed.data), parsed.data.id ? 200 : 201);
  } catch (error) {
    const mapped = workforceErrorResponse(error);
    return fail(mapped.message, mapped.status);
  }
}
