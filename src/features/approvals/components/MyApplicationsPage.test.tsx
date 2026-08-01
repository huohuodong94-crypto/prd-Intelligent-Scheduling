import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";

import MyApplicationsPage from "./MyApplicationsPage";

afterEach(cleanup);

it("offers leave, punch correction and shift swap without DOM", () => {
  render(<MyApplicationsPage leaveRows={[]} correctionRows={[]} swapRows={[]} />);
  expect(screen.getByRole("tab", { name: "请假" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "补卡" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "换班" })).toBeInTheDocument();
  expect(screen.queryByText(/DOM/i)).not.toBeInTheDocument();
});

it("shows target acceptance only for swaps targeting the employee", async () => {
  render(
    <MyApplicationsPage
      leaveRows={[]}
      correctionRows={[]}
      swapRows={[{
        id: "swap1",
        status: "pending_target",
        requesterName: "小王",
        targetUserId: "me",
        currentUserId: "me",
        summary: "早班换晚班",
      }]}
    />,
  );
  await userEvent.click(screen.getByRole("tab", { name: "换班" }));
  expect(screen.getByRole("button", { name: "接受换班" })).toBeInTheDocument();
});
