import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/api";

export async function GET() {
  const session = await getSession();
  if (!session) return fail("未登录", 401);
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    include: { store: true },
  });
  if (!user) return fail("用户不存在", 404);
  return ok({
    id: user.id,
    name: user.name,
    role: user.role,
    storeId: user.storeId,
    storeName: user.store?.name ?? null,
    phone: user.phone,
    annualLeaveBalance: user.annualLeaveBalance,
    sickLeaveBalance: user.sickLeaveBalance,
  });
}
