import { fail, ok, readJson } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { requireStoreAccess } from "@/lib/authorization";
import { createPlanSchema } from "@/lib/contracts/scheduling";
import {
  PlanDomainError,
  createPlan,
  listPlans,
} from "@/features/scheduling/server/plan-service";

function domainFailure(error: unknown) {
  if (error instanceof PlanDomainError) return fail(error.message, error.status);
  throw error;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const access = await requireStoreAccess(
    ["manager", "admin"],
    url.searchParams.get("storeId"),
  );
  if ("error" in access) return fail(access.error, access.status);
  return ok(await listPlans(access.scope));
}

export async function POST(req: Request) {
  const auth = await requireSession(["manager"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  const parsed = createPlanSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  const access = await requireStoreAccess(["manager"], parsed.data.storeId);
  if ("error" in access) return fail(access.error, access.status);
  try {
    return ok(await createPlan(access.scope, parsed.data), 201);
  } catch (error) {
    return domainFailure(error);
  }
}
