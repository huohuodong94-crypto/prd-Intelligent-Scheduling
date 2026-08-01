import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AppShell from "./AppShell";

const { navigationState } = vi.hoisted(() => ({
  navigationState: { pathname: "/schedule/plans" },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  navigationState.pathname = "/schedule/plans";
  vi.unstubAllGlobals();
});

it("renders only the desktop blocker below 1280px", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: true,
    media: "(max-width: 1279px)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));

  render(
    <AppShell
      user={{ id: "m1", name: "李经理", role: "manager", storeId: "s1", storeName: "望京旗舰店", phone: "13800000001" }}
    >
      <div>private application content</div>
    </AppShell>,
  );

  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("请使用宽屏浏览器访问（最低 1280px）"));
  expect(screen.queryByText("private application content")).not.toBeInTheDocument();
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});

it("shows the manager desktop navigation and never exposes DOM approval", () => {
  render(
    <AppShell
      user={{ id: "m1", name: "李经理", role: "manager", storeId: "s1", storeName: "望京旗舰店", phone: "13800000001" }}
    >
      <div>content</div>
    </AppShell>
  );
  expect(screen.getByText("排班计划")).toBeInTheDocument();
  expect(screen.getByText("日异常")).toBeInTheDocument();
  expect(screen.queryByText(/DOM/)).not.toBeInTheDocument();
  expect(screen.getByTestId("desktop-shell")).toHaveStyle({ minWidth: "1280px" });
});

it("keeps admin out of the unscoped dashboard navigation", () => {
  navigationState.pathname = "/admin/demand";
  render(
    <AppShell
      user={{ id: "a1", name: "系统管理员", role: "admin", storeId: null, storeName: null, phone: "13900000000" }}
    >
      <div>content</div>
    </AppShell>
  );

  expect(screen.queryByRole("button", { name: "个人中心" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "首页" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "系统管理" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "全局参数" })).toBeInTheDocument();
});
