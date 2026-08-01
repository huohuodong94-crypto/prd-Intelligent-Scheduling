import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { api } from "@/lib/client";
import type { SchedulePlanSummary } from "@/lib/contracts/scheduling";
import SchedulePlansPage from "./SchedulePlansPage";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("@/lib/client", () => ({ api: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  vi.mocked(api).mockReset();
  push.mockReset();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const plan: SchedulePlanSummary = {
  id: "plan-a",
  storeId: "store-a",
  weekOf: "2026-07-20",
  mode: "work5rest2",
  status: "draft",
  version: 1,
  publishedAt: null,
};

const planB: SchedulePlanSummary = {
  ...plan,
  id: "plan-b",
  storeId: "store-b",
  weekOf: "2026-07-27",
};

it("moves from loading to rows and never shows the empty state while loading", async () => {
  const request = deferred<SchedulePlanSummary[]>();
  vi.mocked(api).mockImplementationOnce(() => request.promise);
  render(<SchedulePlansPage initialStoreId="store-a" readOnly={false} />);

  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId("schedule-plans-results")).toHaveAttribute("data-result-state", "loading");
  expect(screen.queryByText("暂无排班计划")).not.toBeInTheDocument();

  await act(async () => {
    request.resolve([plan]);
    await request.promise;
  });
  expect(screen.getByTestId("schedule-plans-results")).toHaveAttribute("data-result-state", "rows");
  expect(screen.getByRole("link", { name: "进入向导" })).toHaveAttribute("href", "/schedule/plans/plan-a");
});

it("renders errors without also rendering the business empty state", async () => {
  const request = deferred<SchedulePlanSummary[]>();
  vi.mocked(api).mockImplementationOnce(() => request.promise);
  render(<SchedulePlansPage initialStoreId="store-a" readOnly={false} />);

  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  await act(async () => {
    request.reject(new Error("计划加载失败"));
    await request.promise.catch(() => undefined);
  });
  expect(screen.getByTestId("schedule-plans-results")).toHaveAttribute("data-result-state", "error");
  expect(screen.getByRole("alert")).toHaveTextContent("计划加载失败");
  expect(screen.getAllByText("计划加载失败")).toHaveLength(1);
  expect(screen.queryByText("暂无排班计划")).not.toBeInTheDocument();
});

it("renders a deterministic empty state after a successful empty response", async () => {
  vi.mocked(api).mockResolvedValueOnce([]);
  render(<SchedulePlansPage initialStoreId="store-a" readOnly={false} />);

  await waitFor(() => expect(screen.getByTestId("schedule-plans-results")).toHaveAttribute("data-result-state", "empty"));
  expect(screen.getByText("暂无排班计划")).toBeInTheDocument();
});

it("treats an admin store-option failure as an error instead of an empty plan result", async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error("门店选项加载失败"));
  render(<SchedulePlansPage initialStoreId={null} readOnly />);

  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByText("门店选项加载失败")).toBeInTheDocument());
  expect(screen.getByTestId("schedule-plans-results")).toHaveAttribute("data-result-state", "error");
  expect(screen.queryByText("暂无排班计划")).not.toBeInTheDocument();
});

it("keeps the selected store B result when the older store A request resolves last", async () => {
  const storeA = deferred<SchedulePlanSummary[]>();
  const storeB = deferred<SchedulePlanSummary[]>();
  vi.mocked(api).mockImplementation((path) => {
    if (path === "/api/store/options") {
      return Promise.resolve([
        { id: "store-a", name: "门店 A", code: "A" },
        { id: "store-b", name: "门店 B", code: "B" },
      ]) as never;
    }
    if (String(path).includes("store-a")) return storeA.promise as never;
    if (String(path).includes("store-b")) return storeB.promise as never;
    throw new Error(`unexpected request: ${String(path)}`);
  });

  render(<SchedulePlansPage initialStoreId="store-a" readOnly />);
  await waitFor(() => expect(api).toHaveBeenCalledWith("/api/schedule/plans?storeId=store-a"));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "store-b" } });
  await waitFor(() => expect(api).toHaveBeenCalledWith("/api/schedule/plans?storeId=store-b"));

  await act(async () => {
    storeB.resolve([planB]);
    await storeB.promise;
  });
  expect(screen.getByRole("link", { name: "查看" })).toHaveAttribute("href", "/schedule/plans/plan-b");

  await act(async () => {
    storeA.resolve([plan]);
    await storeA.promise;
  });
  expect(screen.getByTestId("schedule-plans-results")).toHaveAttribute("data-result-state", "rows");
  expect(screen.getByRole("link", { name: "查看" })).toHaveAttribute("href", "/schedule/plans/plan-b");
  expect(screen.queryByText("2026-07-20 ~ 2026-07-26")).not.toBeInTheDocument();
  expect(vi.mocked(api).mock.calls.filter(([path]) => path === "/api/store/options")).toHaveLength(1);
});

it("navigates after a successful create without waiting for a list refresh", async () => {
  vi.mocked(api)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(plan)
    .mockRejectedValueOnce(new Error("列表刷新失败"));
  render(<SchedulePlansPage initialStoreId="store-a" readOnly={false} />);
  await waitFor(() => expect(screen.getByTestId("schedule-plans-results")).toHaveAttribute("data-result-state", "empty"));

  await userEvent.click(screen.getByRole("button", { name: "＋ 新建排班计划" }));
  await userEvent.click(screen.getByRole("button", { name: "创建并进入" }));

  await waitFor(() => expect(push).toHaveBeenCalledWith("/schedule/plans/plan-a"));
  expect(api).toHaveBeenCalledTimes(2);
  expect(screen.queryByText("列表刷新失败")).not.toBeInTheDocument();
  expect(screen.queryByText("创建失败")).not.toBeInTheDocument();
});
