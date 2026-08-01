import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { api } from "@/lib/client";
import DashboardPage from "./DashboardPage";

vi.mock("@/lib/client", () => ({
  api: vi.fn(),
}));

it("renders real dashboard counts and explicit pending calculation states", async () => {
  vi.mocked(api).mockResolvedValue({
    store: { id: "store-a", name: "望京旗舰店" },
    pendingApprovals: 3,
    draftPlans: 2,
    scheduleGapCount: null,
    attendanceExceptionCount: null,
  });

  render(<DashboardPage />);

  expect(await screen.findByText("望京旗舰店")).toBeInTheDocument();
  expect(screen.getByTestId("pending-approvals")).toHaveTextContent("3");
  expect(screen.getByTestId("draft-plans")).toHaveTextContent("2");
  expect(screen.getAllByText("待该模块完成计算")).toHaveLength(2);
  expect(screen.getByRole("link", { name: "月度工时报表" })).toHaveAttribute("href", "/reports/monthly");
  expect(screen.getByRole("link", { name: "排班分析报表" })).toHaveAttribute("href", "/reports/scheduling");
});
