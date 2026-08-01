import { afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import ApprovalsPage from "./ApprovalsPage";

afterEach(cleanup);

const pending = {
  id: "l1",
  type: "leave" as const,
  storeId: "s1",
  userId: "e1",
  employeeName: "小王",
  submittedAt: "2026-07-19T00:00:00.000Z",
  status: "pending" as const,
  summary: "年假 4 小时",
  aiSuggestion: null,
  aiReason: null,
};

it("shows persisted AI advice without applying a decision", async () => {
  const decide = vi.fn();
  const aiCheck = vi.fn().mockResolvedValue({
    suggestion: "compliant" as const,
    reason: "余额充足",
    aiLogId: "log1",
  });
  render(<ApprovalsPage initialItems={[pending]} onDecide={decide} onAiCheck={aiCheck} />);

  await userEvent.click(screen.getByRole("button", { name: "AI 合规建议" }));
  expect(await screen.findByText("余额充足")).toBeInTheDocument();
  expect(decide).not.toHaveBeenCalled();
});

it("keeps historical rows immutable and requires a rejection reason dialog", async () => {
  render(
    <ApprovalsPage
      initialItems={[pending, { ...pending, id: "l2", status: "approved" as const }]}
      onDecide={vi.fn()}
      onAiCheck={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByRole("tab", { name: "审批记录" }));
  expect(screen.getByRole("checkbox", { name: /l2/ })).toBeDisabled();
  await userEvent.click(screen.getByRole("tab", { name: "待审批" }));
  await userEvent.click(screen.getByRole("checkbox", { name: /l1/ }));
  await userEvent.click(screen.getByRole("button", { name: "批量驳回" }));
  expect(screen.getByRole("dialog", { name: "填写驳回原因" })).toBeInTheDocument();
});

it("filters rows and opens a detail drawer", async () => {
  render(<ApprovalsPage initialItems={[pending]} onDecide={vi.fn()} onAiCheck={vi.fn()} />);
  await userEvent.type(screen.getByRole("textbox", { name: "员工筛选" }), "小王");
  await userEvent.click(screen.getByRole("button", { name: "查看详情" }));
  expect(screen.getByRole("dialog", { name: "单据详情" })).toBeInTheDocument();
});

it("refreshes after a stale 409 response", async () => {
  const refresh = vi.fn();
  render(
    <ApprovalsPage
      initialItems={[pending]}
      onDecide={vi.fn().mockRejectedValue(Object.assign(new Error("stale"), { status: 409 }))}
      onAiCheck={vi.fn()}
      onRefresh={refresh}
    />,
  );
  await userEvent.click(screen.getByRole("checkbox", { name: /l1/ }));
  await userEvent.click(screen.getByRole("button", { name: "批量通过" }));
  expect(await screen.findByText("单据状态已变化，请核对后重试")).toBeInTheDocument();
  expect(refresh).toHaveBeenCalled();
});

it("renders approval types and statuses in Chinese in rows and details", async () => {
  render(
    <ApprovalsPage
      initialItems={[
        pending,
        { ...pending, id: "p1", type: "punch_correction", status: "approved", summary: "下班补卡" },
        { ...pending, id: "s1", type: "shift_swap", status: "rejected", summary: "与小李换班" },
      ]}
      onDecide={vi.fn()}
      onAiCheck={vi.fn()}
    />,
  );

  expect(screen.getByText(/请假 · 待审批/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "查看详情" }));
  expect(screen.getByText("类型：请假 · 状态：待审批")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "返回" }));

  await userEvent.click(screen.getByRole("tab", { name: "审批记录" }));
  expect(screen.getByText(/补卡 · 已通过/)).toBeInTheDocument();
  expect(screen.getByText(/换班 · 已驳回/)).toBeInTheDocument();
  expect(screen.queryByText(/leave|punch_correction|shift_swap|pending|approved|rejected/)).not.toBeInTheDocument();
});
