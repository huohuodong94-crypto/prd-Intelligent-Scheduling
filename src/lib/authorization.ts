import { requireSession, type SessionUser } from "./auth";

export type Role = SessionUser["role"];
export type StoreScope = { user: SessionUser; storeId: string };
export type AuthFailure = { error: string; status: number };
export type StoreAccessOptions = { adminRequiresExplicitStore?: boolean };

export function resolveStoreAccess(
  user: SessionUser,
  requestedStoreId?: string | null,
  options: StoreAccessOptions = {},
): StoreScope | AuthFailure {
  if (user.role === "admin" && options.adminRequiresExplicitStore && !requestedStoreId?.trim()) {
    return { error: "管理员必须显式指定门店", status: 400 };
  }
  const storeId = requestedStoreId || user.storeId;
  if (!storeId) return { error: "必须指定门店", status: 400 };
  if (user.role === "employee" && storeId !== user.storeId)
    return { error: "无权访问其他门店", status: 403 };
  if (user.role === "manager" && storeId !== user.storeId)
    return { error: "无权访问其他门店", status: 403 };
  return { user, storeId };
}

export async function requireStoreAccess(
  roles: Role[],
  requestedStoreId?: string | null,
  options: StoreAccessOptions = {},
): Promise<{ scope: StoreScope } | AuthFailure> {
  const auth = await requireSession(roles);
  if ("error" in auth) return auth;
  const resolved = resolveStoreAccess(auth.user, requestedStoreId, options);
  if ("error" in resolved) return resolved;
  const { prisma } = await import("./db");
  const store = await prisma.store.findUnique({
    where: { id: resolved.storeId },
    select: { id: true },
  });
  if (!store) return { error: "门店不存在", status: 404 };
  return { scope: resolved };
}
