import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import AppShell from "@/components/enterprise/AppShell";

// 所有需要登录的页面共享此布局：鉴权守卫 + 顶部导航 + 全局 AI 助手。
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSession();
  if (!user) redirect("/");
  const store = user.storeId
    ? await prisma.store.findUnique({ where: { id: user.storeId }, select: { name: true } })
    : null;
  return <AppShell user={{ ...user, storeName: store?.name ?? null }}>{children}</AppShell>;
}
