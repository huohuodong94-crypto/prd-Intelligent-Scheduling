"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/auth";
import { api } from "@/lib/client";
import AssistantWidget from "../AssistantWidget";
import DesktopWidthGuard from "./DesktopWidthGuard";

export type AppShellUser = SessionUser & { storeName: string | null };
export type AppShellProps = { user: AppShellUser; children: React.ReactNode };

type Role = SessionUser["role"];

const ROLE_LABELS: Record<Role, string> = {
  employee: "店铺员工",
  manager: "店铺经理",
  admin: "系统管理员",
};

export const NAVIGATION = [
  { module: "个人中心", roles: ["employee", "manager"], items: [
    { href: "/dashboard", label: "首页", roles: ["employee", "manager"] },
    { href: "/my-schedule", label: "我的班表", roles: ["employee"] },
    { href: "/attendance", label: "Web 打卡", roles: ["employee"] },
    { href: "/leave", label: "我的申请", roles: ["employee"] },
  ] },
  { module: "劳动力管理", roles: ["manager", "admin"], items: [
    { href: "/clock-code", label: "动态码", roles: ["manager"] },
    { href: "/store/basic", label: "门店基础", roles: ["manager", "admin"] },
    { href: "/store/v2s", label: "V2S", roles: ["manager", "admin"] },
    { href: "/store/work-areas", label: "工作区域", roles: ["manager", "admin"] },
    { href: "/store/work-groups", label: "工作组", roles: ["manager", "admin"] },
    { href: "/store/employees", label: "员工", roles: ["manager", "admin"] },
    { href: "/store/events", label: "活动日历", roles: ["manager", "admin"] },
    { href: "/store/staffing", label: "最低人力", roles: ["manager", "admin"] },
    { href: "/schedule/plans", label: "排班计划", roles: ["manager", "admin"] },
    { href: "/approvals", label: "审批中心", roles: ["manager", "admin"] },
    { href: "/attendance/punches", label: "打卡记录", roles: ["manager", "admin"] },
    { href: "/attendance/daily", label: "日异常", roles: ["manager", "admin"] },
    { href: "/attendance/monthly", label: "月汇总", roles: ["manager", "admin"] },
  ] },
  { module: "报表中心", roles: ["manager", "admin"], items: [
    { href: "/reports/monthly", label: "工时报表", roles: ["manager", "admin"] },
    { href: "/reports/scheduling", label: "排班报表", roles: ["manager", "admin"] },
  ] },
  { module: "系统管理", roles: ["admin"], items: [
    { href: "/admin/demand", label: "全局参数", roles: ["admin"] },
  ] },
] as const;

function includesRole(roles: readonly Role[], role: Role): boolean {
  return roles.includes(role);
}

function matchesPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

export default function AppShell({ user, children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const modules = NAVIGATION.filter((entry) => includesRole(entry.roles, user.role));
  const activeModule =
    modules.find((entry) =>
      entry.items.some(
        (item) => includesRole(item.roles, user.role) && matchesPath(pathname, item.href)
      )
    ) ?? modules[0];
  const items = activeModule.items.filter((item) => includesRole(item.roles, user.role));

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  return (
    <DesktopWidthGuard>
      <div className="flex min-h-screen flex-col" style={{ color: "var(--text)" }}>
        <header
          className="flex shrink-0 items-center px-4 text-white"
          style={{ height: 48, background: "var(--nav-bg)" }}
        >
          <div className="mr-6 flex items-center gap-2 font-semibold">
            <span
              className="inline-flex h-6 w-6 items-center justify-center text-[11px]"
              style={{ background: "var(--primary)", borderRadius: 4 }}
            >
              W
            </span>
            <span className="text-[14px]">WFM 智能排班</span>
          </div>
          <nav className="flex h-full items-center" aria-label="一级模块">
            {modules.map((entry) => {
              const visibleItems = entry.items.filter((item) => includesRole(item.roles, user.role));
              const active = entry.module === activeModule.module;
              return (
                <button
                  key={entry.module}
                  type="button"
                  className="h-full px-4 text-[13px]"
                  style={{
                    background: active ? "var(--nav-bg-active)" : "transparent",
                    color: active ? "#FFFFFF" : "rgba(255,255,255,.72)",
                  }}
                  onClick={() => router.push(visibleItems[0].href)}
                >
                  {entry.module}
                </button>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-[12px] text-white/80">
            <span>{user.storeName ?? "未绑定门店"}</span>
            <span>{user.name}</span>
            <span>{ROLE_LABELS[user.role]}</span>
            <button type="button" className="text-white/80 hover:text-white" aria-label="消息">
              消息
            </button>
            <button type="button" className="text-white/80 hover:text-white" onClick={logout}>
              退出
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside
            className="thin-scroll shrink-0 overflow-y-auto border-r"
            style={{ width: 208, background: "var(--side-bg)", borderColor: "var(--border)" }}
          >
            <div
              className="border-b px-4 py-2 text-[12px] font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            >
              {activeModule.module}
            </div>
            <nav className="py-1" aria-label="功能菜单">
              {items.map((item) => {
                const active = matchesPath(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block border-l-2 px-4 py-2 text-[13px]"
                    style={{
                      borderLeftColor: active ? "var(--primary)" : "transparent",
                      background: active ? "var(--side-active)" : "transparent",
                      color: active ? "var(--primary)" : "var(--text)",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </aside>

          <main
            className="thin-scroll min-w-0 flex-1 overflow-auto"
            style={{ background: "var(--page-bg)" }}
          >
            <div style={{ padding: 16 }}>{children}</div>
          </main>
        </div>
      </div>
      <AssistantWidget />
    </DesktopWidthGuard>
  );
}
