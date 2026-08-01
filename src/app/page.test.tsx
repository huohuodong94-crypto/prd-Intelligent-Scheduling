import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import LoginPage from "./page";

const { apiMock, pushMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  api: apiMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("exposes stable programmatic labels and login name for browser automation", () => {
  render(<LoginPage />);

  expect(screen.getByLabelText("手机号")).toHaveValue("13800000001");
  expect(screen.getByLabelText("验证码")).toHaveValue("123456");
  expect(screen.getByRole("button", { name: "登录" })).toBeEnabled();
});

it("renders only the primary login method in a centered single-column card", () => {
  render(<LoginPage />);

  expect(screen.getByRole("form", { name: "登录账户" })).toBeInTheDocument();
  expect(screen.getByTestId("login-card")).toHaveClass("max-w-lg");
  expect(screen.queryByText(/租户/)).not.toBeInTheDocument();
  expect(screen.queryByText("或使用以下方式登录")).not.toBeInTheDocument();
  expect(screen.queryByText(/企业 SSO/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("手机号")).toHaveValue("13800000001");
  expect(screen.getByLabelText("验证码")).toHaveValue("123456");
});

it("routes an admin to system management after login", async () => {
  apiMock.mockResolvedValue({ role: "admin" });
  render(<LoginPage />);

  fireEvent.click(screen.getByRole("button", { name: /登\s*录/ }));

  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin/demand"));
});

it.each(["employee", "manager"] as const)(
  "routes a %s to the scoped dashboard after login",
  async (role) => {
    apiMock.mockResolvedValue({ role });
    render(<LoginPage />);

    fireEvent.click(screen.getByRole("button", { name: /登\s*录/ }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard"));
  }
);
