import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import MonthlyAttendancePage, { MonthlyAttendanceRouteClient } from "./MonthlyAttendancePage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const baseRow = {
  userId: "employee-a",
  employeeName: "小王",
  month: "2026-07",
  scheduledHours: 40,
  workedHours: 32,
  leaveHours: 8,
  correctionHours: 0,
  exceptionCount: 1,
  unconfirmedExceptionCount: 0,
  zeroAttendance: false,
  zeroAttendanceAction: "none" as const,
  status: "unconfirmed" as const,
  confirmedByName: null,
  confirmedAt: null,
  revision: 2,
  sourceHash: "source-a",
  needsReconfirmation: false,
  lastInvalidationReason: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function apiResponse<T>(data: T) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

it("shows blockers and prevents confirmation", () => {
  render(<MonthlyAttendancePage
    initialMonth="2026-07"
    initialRows={[{ ...baseRow, unconfirmedExceptionCount: 1 }]}
    onConfirm={vi.fn()}
    onUnconfirm={vi.fn()}
  />);
  expect(screen.getByText("小王")).toBeInTheDocument();
  expect(screen.getByText("计划 40 h / 实际 32 h")).toBeInTheDocument();
  expect(screen.getByText("仍有 1 条未确认日异常")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "确认考勤" })).toBeDisabled();
});

it("formats monthly attendance hours without floating point tails", () => {
  render(<MonthlyAttendancePage
    initialMonth="2026-07"
    initialRows={[{ ...baseRow, scheduledHours: 4, workedHours: 3.6666666666666665 }]}
    onConfirm={vi.fn()}
    onUnconfirm={vi.fn()}
  />);

  expect(screen.getByText("计划 4 h / 实际 3.67 h")).toBeInTheDocument();
  expect(screen.queryByText(/3\.6666666666666665/)).not.toBeInTheDocument();
});

it("submits selected CAS data and resets labels after invalidation", async () => {
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  render(<MonthlyAttendancePage
    initialMonth="2026-07"
    initialRows={[
      { ...baseRow },
      {
        ...baseRow,
        userId: "employee-b",
        employeeName: "小李",
        scheduledHours: 8,
        workedHours: 0,
        zeroAttendance: true,
        revision: 4,
        sourceHash: "source-b",
        needsReconfirmation: true,
        lastInvalidationReason: "punch_created",
      },
    ]}
    onConfirm={onConfirm}
    onUnconfirm={vi.fn()}
  />);

  expect(screen.getByText("源数据已变化，需重新计算并确认")).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "小李 0 考勤处理" }), "supplement_hours");
  await userEvent.click(screen.getByRole("checkbox", { name: "选择小王" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "选择小李" }));
  await userEvent.click(screen.getByRole("button", { name: "确认考勤" }));

  expect(onConfirm).toHaveBeenCalledWith({
    month: "2026-07",
    rows: [
      { userId: "employee-a", zeroAttendanceAction: "none", expectedRevision: 2, expectedSourceHash: "source-a" },
      { userId: "employee-b", zeroAttendanceAction: "supplement_hours", expectedRevision: 4, expectedSourceHash: "source-b" },
    ],
  });
});

it("renders admin monthly attendance as explicitly read-only", () => {
  render(<MonthlyAttendancePage
    initialMonth="2026-07"
    initialRows={[{ ...baseRow, scheduledHours: 8, workedHours: 0, zeroAttendance: true }]}
    onConfirm={vi.fn()}
    onUnconfirm={vi.fn()}
    readOnly
  />);
  expect(screen.getByRole("checkbox", { name: "选择小王" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "小王 0 考勤处理" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "确认考勤" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "取消确认" })).toBeDisabled();
});

it("reloads and replaces rows when the month changes", async () => {
  const august = { ...baseRow, userId: "employee-aug", employeeName: "小陈", month: "2026-08", sourceHash: "august" };
  const loadRows = vi.fn().mockResolvedValue([august]);
  render(<MonthlyAttendancePage
    initialMonth="2026-07"
    initialRows={[baseRow]}
    onConfirm={vi.fn()}
    onUnconfirm={vi.fn()}
    loadRows={loadRows}
  />);
  fireEvent.change(screen.getByLabelText("月份"), { target: { value: "2026-08" } });
  await waitFor(() => expect(loadRows).toHaveBeenCalledWith("2026-08"));
  expect(await screen.findByText("小陈")).toBeInTheDocument();
  expect(screen.queryByText("小王")).not.toBeInTheDocument();
});

it("keeps delayed monthly rows in a loading result state until business content is rendered", async () => {
  const rows = deferred<typeof baseRow[]>();
  render(<MonthlyAttendancePage
    initialMonth="2026-07"
    initialRows={[]}
    onConfirm={vi.fn()}
    onUnconfirm={vi.fn()}
    loadRows={vi.fn(() => rows.promise)}
  />);

  const results = screen.getByTestId("monthly-attendance-results");
  expect(results).toHaveAttribute("data-result-state", "loading");
  expect(screen.queryByText("当前月份暂无员工考勤")).not.toBeInTheDocument();

  await act(async () => rows.resolve([baseRow]));
  expect(await screen.findByText("小王")).toBeInTheDocument();
  expect(results).toHaveAttribute("data-result-state", "rows");
});

it("exposes a rejected monthly request as an error result instead of a valid empty result", async () => {
  const rows = deferred<typeof baseRow[]>();
  render(<MonthlyAttendancePage
    initialMonth="2026-07"
    initialRows={[]}
    onConfirm={vi.fn()}
    onUnconfirm={vi.fn()}
    loadRows={vi.fn(() => rows.promise)}
  />);

  const results = screen.getByTestId("monthly-attendance-results");
  expect(results).toHaveAttribute("data-result-state", "loading");
  await act(async () => rows.reject(new Error("月度考勤结果加载失败")));

  expect(results).toHaveAttribute("data-result-state", "error");
  expect(within(results).getByRole("alert")).toHaveTextContent("月度考勤结果加载失败");
  expect(screen.queryByText("当前月份暂无员工考勤")).not.toBeInTheDocument();
});

it("keeps the newest month when responses resolve out of order", async () => {
  const august = deferred<typeof baseRow[]>();
  const september = deferred<typeof baseRow[]>();
  const loadRows = vi.fn((month: string) => month === "2026-08" ? august.promise : september.promise);
  render(<MonthlyAttendancePage
    initialMonth="2026-07"
    initialRows={[baseRow]}
    onConfirm={vi.fn()}
    onUnconfirm={vi.fn()}
    loadRows={loadRows}
  />);

  fireEvent.change(screen.getByLabelText("月份"), { target: { value: "2026-08" } });
  fireEvent.change(screen.getByLabelText("月份"), { target: { value: "2026-09" } });
  september.resolve([{ ...baseRow, userId: "sep", employeeName: "九月员工", month: "2026-09" }]);
  expect(await screen.findByText("九月员工")).toBeInTheDocument();
  august.resolve([{ ...baseRow, userId: "aug", employeeName: "八月员工", month: "2026-08" }]);

  await waitFor(() => expect(screen.getByLabelText("月份")).toHaveValue("2026-09"));
  await waitFor(() => expect(screen.getByText("九月员工")).toBeInTheDocument());
  expect(screen.queryByText("八月员工")).not.toBeInTheDocument();
});

it("keeps the newest admin store when the previous scope rejects late", async () => {
  const storeA = deferred<Response>();
  const storeB = deferred<Response>();
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url === "/api/store/options") {
      return Promise.resolve(apiResponse([
        { id: "store-a", name: "A 店" },
        { id: "store-b", name: "B 店" },
      ]));
    }
    if (url.includes("storeId=store-a")) return storeA.promise;
    if (url.includes("storeId=store-b")) return storeB.promise;
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<MonthlyAttendanceRouteClient role="admin" initialStoreId="" />);
  const storeSelect = await screen.findByRole("combobox", { name: "选择门店" });
  await screen.findByRole("option", { name: "A 店" });
  await userEvent.selectOptions(storeSelect, "store-a");
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("storeId=store-a"), expect.anything()));
  await userEvent.selectOptions(storeSelect, "store-b");
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("storeId=store-b"), expect.anything()));

  storeB.resolve(apiResponse([{ ...baseRow, userId: "employee-b", employeeName: "B 店员工" }]));
  expect(await screen.findByText("B 店员工")).toBeInTheDocument();
  storeA.reject(new Error("旧门店加载失败"));
  await act(async () => { await Promise.resolve(); });

  expect(screen.getByText("B 店员工")).toBeInTheDocument();
  expect(screen.queryByText("旧门店加载失败")).not.toBeInTheDocument();
});

it("does not let an old action refresh overwrite a newer scope", async () => {
  const oldActionRefresh = deferred<typeof baseRow[]>();
  const loadOldScope = vi.fn(() => oldActionRefresh.promise);
  const newerScopeRow = { ...baseRow, userId: "employee-new", employeeName: "新 scope 员工", revision: 9, sourceHash: "new-scope" };
  const loadNewScope = vi.fn().mockResolvedValue([newerScopeRow]);
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  const { rerender } = render(<MonthlyAttendancePage
    initialMonth="2026-07"
    initialRows={[baseRow]}
    onConfirm={onConfirm}
    onUnconfirm={vi.fn()}
    loadRows={loadOldScope}
  />);

  await userEvent.click(screen.getByRole("checkbox", { name: "选择小王" }));
  await userEvent.click(screen.getByRole("button", { name: "确认考勤" }));
  await waitFor(() => expect(loadOldScope).toHaveBeenCalledWith("2026-07"));
  rerender(<MonthlyAttendancePage
    initialMonth="2026-07"
    initialRows={[newerScopeRow]}
    onConfirm={onConfirm}
    onUnconfirm={vi.fn()}
    loadRows={loadNewScope}
  />);
  expect(await screen.findByText("新 scope 员工")).toBeInTheDocument();

  oldActionRefresh.resolve([{ ...baseRow, userId: "employee-old", employeeName: "过期操作刷新" }]);
  await act(async () => { await Promise.resolve(); });

  expect(screen.getByText("新 scope 员工")).toBeInTheDocument();
  expect(screen.queryByText("过期操作刷新")).not.toBeInTheDocument();
  expect(screen.queryByText("已确认所选月度考勤")).not.toBeInTheDocument();
});

it("reloads status, revision, and hash after confirmation", async () => {
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  const loadRows = vi.fn().mockResolvedValue([{ ...baseRow, status: "confirmed", revision: 3, sourceHash: "source-new", confirmedByName: "店长", confirmedAt: "2026-07-25T00:00:00.000Z" }]);
  render(<MonthlyAttendancePage
    initialMonth="2026-07"
    initialRows={[baseRow]}
    onConfirm={onConfirm}
    onUnconfirm={vi.fn()}
    loadRows={loadRows}
  />);
  await userEvent.click(screen.getByRole("checkbox", { name: "选择小王" }));
  await userEvent.click(screen.getByRole("button", { name: "确认考勤" }));
  await waitFor(() => expect(loadRows).toHaveBeenCalledWith("2026-07"));
  expect(await screen.findByText("已确认")).toBeInTheDocument();
});
