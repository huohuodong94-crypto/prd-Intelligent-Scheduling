import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("@/lib/client", () => ({ api: client.api }));

import ApprovalsRoutePage from "./page";

afterEach(() => {
  cleanup();
  client.api.mockReset();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

it("keeps delayed approvals in a loading result state until business content is rendered", async () => {
  const pending = deferred<Array<Record<string, unknown>>>();
  const history = deferred<Array<Record<string, unknown>>>();
  client.api.mockImplementation((url: string) => {
    if (url === "/api/auth/me") return Promise.resolve({ role: "manager", storeId: "store-a" });
    if (url === "/api/store/options") return Promise.resolve([]);
    if (url.includes("status=pending")) return pending.promise;
    if (url.includes("status=history")) return history.promise;
    throw new Error(`unexpected API call: ${url}`);
  });

  render(<ApprovalsRoutePage />);
  const results = screen.getByTestId("approvals-results");
  expect(results).toHaveAttribute("data-result-state", "loading");
  expect(screen.queryByTestId("approval-empty-state")).not.toBeInTheDocument();
  await waitFor(() => expect(client.api).toHaveBeenCalledWith(expect.stringContaining("status=pending")));

  await act(async () => {
    pending.resolve([{
      id: "leave-delayed",
      type: "leave",
      storeId: "store-a",
      userId: "employee-a",
      employeeName: "延迟员工",
      submittedAt: "2026-07-19T00:00:00.000Z",
      status: "pending",
      summary: "延迟年假",
      aiSuggestion: null,
      aiReason: null,
    }]);
    history.resolve([]);
  });

  expect(await screen.findByText("延迟员工 · 延迟年假")).toBeInTheDocument();
  expect(results).toHaveAttribute("data-result-state", "rows");
});
