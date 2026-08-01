import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import ClockCodePage from "./ClockCodePage";
import DailyAttendancePage from "./DailyAttendancePage";
import EmployeePunchPage, { type EmployeePunchHistoryRow, type EmployeePunchReceipt } from "./EmployeePunchPage";
import PunchesPage from "./PunchesPage";

const pageAuth = vi.hoisted(() => ({ requireSession: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireSession: pageAuth.requireSession }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  pageAuth.requireSession.mockReset();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("attendance page server role guards", () => {
  it("redirects wrong-role sessions before any protected form can render", async () => {
    pageAuth.requireSession.mockResolvedValue({ error: "无权访问", status: 403 });
    const [clockPage, employeePage, dailyPage, punchesPage] = await Promise.all([
      import("@/app/(app)/clock-code/page"),
      import("@/app/(app)/attendance/page"),
      import("@/app/(app)/attendance/daily/page"),
      import("@/app/(app)/attendance/punches/page"),
    ]);

    expect(Object.keys(clockPage)).toEqual(["default"]);
    expect(Object.keys(employeePage)).toEqual(["default"]);
    expect(Object.keys(dailyPage)).toEqual(["default"]);
    expect(Object.keys(punchesPage)).toEqual(["default"]);
    await expect(clockPage.default()).rejects.toThrow("redirect:/dashboard");
    expect(pageAuth.requireSession).toHaveBeenLastCalledWith(["manager"]);
    await expect(employeePage.default()).rejects.toThrow("redirect:/dashboard");
    expect(pageAuth.requireSession).toHaveBeenLastCalledWith(["employee"]);
    await expect(dailyPage.default()).rejects.toThrow("redirect:/dashboard");
    expect(pageAuth.requireSession).toHaveBeenLastCalledWith(["manager", "admin"]);
    await expect(punchesPage.default()).rejects.toThrow("redirect:/dashboard");
    expect(pageAuth.requireSession).toHaveBeenLastCalledWith(["manager", "admin"]);
  });
});

describe("ClockCodePage", () => {
  it("shows current and previous codes and refreshes at the server boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T01:00:30.000Z"));
    const loadCode = vi
      .fn()
      .mockResolvedValueOnce({
        currentCode: "123456",
        previousCode: "654321",
        refreshAt: "2026-07-19T01:01:00.000Z",
        expiresAt: "2026-07-19T01:02:00.000Z",
      })
      .mockResolvedValueOnce({
        currentCode: "234567",
        previousCode: "123456",
        refreshAt: "2026-07-19T01:02:00.000Z",
        expiresAt: "2026-07-19T01:03:00.000Z",
      });

    render(<ClockCodePage loadCode={loadCode} />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("123456")).toBeInTheDocument();
    expect(screen.getByText("654321")).toBeInTheDocument();
    expect(screen.getByText(/最终失效/)).toHaveTextContent("09:02:00");
    expect(screen.getByText("距离刷新 30 秒")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByText("距离刷新 29 秒")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });

    expect(screen.getByText("234567")).toBeInTheDocument();
    expect(loadCode).toHaveBeenCalledTimes(2);
  });

  it("uses a minimum delay for an already-due refresh instead of spinning", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T01:00:30.000Z"));
    const loadCode = vi.fn().mockResolvedValue({
      currentCode: "123456",
      previousCode: "654321",
      refreshAt: "2026-07-19T01:00:00.000Z",
      expiresAt: "2026-07-19T01:01:00.000Z",
    });
    render(<ClockCodePage loadCode={loadCode} />);
    await act(async () => { await Promise.resolve(); });
    expect(loadCode).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(249); });
    expect(loadCode).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(loadCode).toHaveBeenCalledTimes(2);
  });

  it("clears unusable codes after an error and retries with a bounded delay", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T01:00:30.000Z"));
    const loadCode = vi
      .fn()
      .mockRejectedValueOnce(new Error("service unavailable"))
      .mockResolvedValueOnce({
        currentCode: "123456",
        previousCode: "654321",
        refreshAt: "2026-07-19T01:01:00.000Z",
        expiresAt: "2026-07-19T01:02:00.000Z",
      });
    render(<ClockCodePage loadCode={loadCode} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("alert")).toHaveTextContent("动态码加载失败");
    expect(screen.queryByLabelText("当前动态码")).not.toBeInTheDocument();
    expect(screen.queryByText("动态码加载中…")).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    expect(loadCode).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(loadCode).toHaveBeenCalledTimes(2);
    expect(screen.getByText("123456")).toBeInTheDocument();
  });

  it("aborts in-flight work and clears refresh timers on unmount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T01:00:30.000Z"));
    const loadCode = vi.fn().mockResolvedValue({
      currentCode: "123456",
      previousCode: "654321",
      refreshAt: "2026-07-19T01:01:00.000Z",
      expiresAt: "2026-07-19T01:02:00.000Z",
    });
    const view = render(<ClockCodePage loadCode={loadCode} />);
    await act(async () => { await Promise.resolve(); });
    const signal = loadCode.mock.calls[0]?.[0] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(loadCode).toHaveBeenCalledTimes(1);
  });
});

describe("EmployeePunchPage", () => {
  it("submits a session-bound punch and refreshes the employee history", async () => {
    const loadHistory = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "p1",
          userId: "employee-a",
          employeeName: "小王",
          storeId: "store-a",
          time: "2026-07-19T01:05:00.000Z",
          direction: "in" as const,
          source: "dynamic_code" as const,
          valid: true,
        },
      ]);
    const submitPunch = vi.fn().mockResolvedValue({
      id: "p1",
      userId: "employee-a",
      storeId: "store-a",
      time: "2026-07-19T01:05:00.000Z",
      direction: "in" as const,
      viaCode: true as const,
    });

    render(<EmployeePunchPage loadHistory={loadHistory} submitPunch={submitPunch} />);
    await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(1));
    expect(screen.getByText("暂无本人打卡记录")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: "6 位动态码" }), "123456");
    await userEvent.click(screen.getByRole("button", { name: "确认上班打卡" }));

    expect(submitPunch).toHaveBeenCalledWith({ direction: "in", code: "123456" });
    await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("动态码")).toBeInTheDocument();
    expect(screen.getAllByText("上班")).toHaveLength(2);
  });

  it("drops a same-frame double click while a punch request is in flight", async () => {
    let finish!: (value: EmployeePunchReceipt) => void;
    const submitPunch = vi.fn(() => new Promise<EmployeePunchReceipt>((resolve) => { finish = resolve; }));
    render(<EmployeePunchPage loadHistory={vi.fn().mockResolvedValue([])} submitPunch={submitPunch} />);
    await waitFor(() => expect(screen.getByText("暂无本人打卡记录")).toBeInTheDocument());
    await userEvent.type(screen.getByRole("textbox", { name: "6 位动态码" }), "123456");
    const button = screen.getByRole("button", { name: "确认上班打卡" });
    act(() => {
      button.click();
      button.click();
    });
    expect(submitPunch).toHaveBeenCalledTimes(1);
    finish({ id: "p1", userId: "e1", storeId: "s1", time: "2026-07-19T01:05:00.000Z", direction: "in", viaCode: true });
    await act(async () => { await Promise.resolve(); });
  });

  it("shows approved corrections as effective and formats time in Asia/Shanghai", async () => {
    render(<EmployeePunchPage loadHistory={vi.fn().mockResolvedValue([{
      id: "correction-1",
      userId: "employee-a",
      employeeName: "小王",
      storeId: "store-a",
      time: "2026-07-19T01:05:00.000Z",
      direction: "in",
      source: "correction",
      valid: true,
    }])} submitPunch={vi.fn()} />);

    expect(await screen.findByText("已批准补卡")).toBeInTheDocument();
    expect(screen.getByText("已生效")).toBeInTheDocument();
    expect(screen.queryByText("仅供追溯")).not.toBeInTheDocument();
    expect(screen.getByText("2026/7/19 09:05:00")).toBeInTheDocument();
  });
});

const dailyRow = {
  id: "exception-1",
  revision: 4,
  userId: "employee-a",
  employeeName: "小王",
  date: "2026-07-19",
  type: "late" as const,
  minutes: 10,
  status: "unconfirmed" as const,
  confirmedAt: null,
};

describe("DailyAttendancePage revision transitions", () => {
  it("keeps delayed rows in a loading result state until business content is rendered", async () => {
    const rows = deferred<typeof dailyRow[]>();
    render(
      <DailyAttendancePage
        role="manager"
        initialStoreId="store-a"
        stores={[]}
        employees={[]}
        today="2026-07-19"
        loadRows={vi.fn(() => rows.promise)}
        recalculate={vi.fn()}
        transition={vi.fn()}
        submitProxy={vi.fn()}
      />,
    );

    const results = screen.getByTestId("daily-attendance-results");
    expect(results).toHaveAttribute("data-result-state", "loading");
    expect(screen.queryByText("当前筛选范围内暂无日异常")).not.toBeInTheDocument();

    await act(async () => rows.resolve([dailyRow]));
    expect(await screen.findByRole("cell", { name: "小王" })).toBeInTheDocument();
    expect(results).toHaveAttribute("data-result-state", "rows");
  });

  it("exposes a rejected row request as an error result instead of a valid empty result", async () => {
    const rows = deferred<typeof dailyRow[]>();
    render(
      <DailyAttendancePage
        role="manager"
        initialStoreId="store-a"
        stores={[]}
        employees={[]}
        today="2026-07-19"
        loadRows={vi.fn(() => rows.promise)}
        recalculate={vi.fn()}
        transition={vi.fn()}
        submitProxy={vi.fn()}
      />,
    );

    const results = screen.getByTestId("daily-attendance-results");
    expect(results).toHaveAttribute("data-result-state", "loading");
    await act(async () => rows.reject(new Error("日考勤结果加载失败")));

    expect(results).toHaveAttribute("data-result-state", "error");
    expect(within(results).getByRole("alert")).toHaveTextContent("日考勤结果加载失败");
    expect(screen.queryByText("当前筛选范围内暂无日异常")).not.toBeInTheDocument();
  });

  it("sends the latest id and revision for a batch confirmation", async () => {
    const loadRows = vi.fn().mockResolvedValue([dailyRow]);
    const transition = vi.fn().mockResolvedValue(undefined);

    render(
      <DailyAttendancePage
        role="manager"
        initialStoreId="store-a"
        stores={[]}
        employees={[]}
        today="2026-07-19"
        loadRows={loadRows}
        recalculate={vi.fn()}
        transition={transition}
        submitProxy={vi.fn()}
      />,
    );

    expect(await screen.findByRole("cell", { name: "小王" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "选择 小王 迟到" }));
    await userEvent.click(screen.getByRole("button", { name: "批量确认" }));

    expect(transition).toHaveBeenCalledWith("confirm", {
      items: [{ id: "exception-1", revision: 4 }],
    });
  });

  it("forces a refresh after a stale 409 and replaces the stale revision", async () => {
    const loadRows = vi
      .fn()
      .mockResolvedValueOnce([dailyRow])
      .mockResolvedValueOnce([{ ...dailyRow, revision: 5 }]);
    const transition = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("stale"), { status: 409 }));

    render(
      <DailyAttendancePage
        role="manager"
        initialStoreId="store-a"
        stores={[]}
        employees={[]}
        today="2026-07-19"
        loadRows={loadRows}
        recalculate={vi.fn()}
        transition={transition}
        submitProxy={vi.fn()}
      />,
    );

    expect(await screen.findByText("小王")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "选择 小王 迟到" }));
    await userEvent.click(screen.getByRole("button", { name: "批量确认" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("状态已变化，已刷新最新数据");
    await waitFor(() => expect(loadRows).toHaveBeenCalledTimes(2));
    expect(screen.getByText("rev.5")).toBeInTheDocument();
  });
});

describe("scoped manager and admin attendance views", () => {
  it("requires an admin to choose a store before loading read-only punch history", async () => {
    const loadRows = vi.fn().mockResolvedValue([]);
    const loadEmployees = vi.fn().mockResolvedValue([{ id: "employee-a", name: "小王" }]);
    render(
      <PunchesPage
        role="admin"
        initialStoreId=""
        stores={[{ id: "store-a", name: "华东旗舰店" }]}
        employees={[]}
        today="2026-07-19"
        loadRows={loadRows}
        loadEmployees={loadEmployees}
      />,
    );

    expect(screen.getByText("管理员须明确选择门店后查看打卡记录")).toBeInTheDocument();
    expect(loadRows).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "选择门店" }), "store-a");
    await waitFor(() => expect(loadRows).toHaveBeenCalledWith(expect.objectContaining({ storeId: "store-a" }), expect.any(AbortSignal)));
    expect(await screen.findByRole("option", { name: "小王" })).toBeInTheDocument();
    expect(loadEmployees).toHaveBeenCalledWith("store-a", expect.any(AbortSignal));
    expect(screen.getByText("当前筛选范围内暂无打卡记录")).toBeInTheDocument();
  });

  it("keeps admin daily attendance read-only after an explicit store selection", async () => {
    const loadRows = vi.fn().mockResolvedValue([dailyRow]);
    const loadEmployees = vi.fn().mockResolvedValue([{ id: "employee-a", name: "小王" }]);
    render(
      <DailyAttendancePage
        role="admin"
        initialStoreId=""
        stores={[{ id: "store-a", name: "华东旗舰店" }]}
        employees={[]}
        today="2026-07-19"
        loadRows={loadRows}
        loadEmployees={loadEmployees}
        recalculate={vi.fn()}
        transition={vi.fn()}
        submitProxy={vi.fn()}
      />,
    );

    expect(screen.getByText("管理员须明确选择门店后查看日异常")).toBeInTheDocument();
    expect(loadRows).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "选择门店" }), "store-a");
    expect(await screen.findByRole("cell", { name: "小王" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "小王" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "员工筛选" }), "employee-a");
    await userEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(loadRows).toHaveBeenLastCalledWith(expect.objectContaining({ storeId: "store-a", userId: "employee-a" }), expect.any(AbortSignal));
    expect(screen.queryByRole("button", { name: "重新计算" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批量确认" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "代提交申请" })).not.toBeInTheDocument();
  });

  it("keeps only the latest applied daily query when responses resolve out of order", async () => {
    const first = deferred<typeof dailyRow[]>();
    const second = deferred<typeof dailyRow[]>();
    const loadRows = vi
      .fn()
      .mockImplementationOnce((_query, _signal: AbortSignal) => first.promise)
      .mockImplementationOnce((_query, _signal: AbortSignal) => second.promise);
    render(<DailyAttendancePage role="manager" initialStoreId="store-a" stores={[]} employees={[]} today="2026-07-19" loadRows={loadRows} recalculate={vi.fn()} transition={vi.fn()} submitProxy={vi.fn()} />);
    await waitFor(() => expect(loadRows).toHaveBeenCalledTimes(1));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "异常类型" }), "late");
    expect(loadRows).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() => expect(loadRows).toHaveBeenCalledTimes(2));
    expect((loadRows.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(true);
    second.resolve([{ ...dailyRow, id: "latest", employeeName: "最新查询" }]);
    expect(await screen.findByRole("cell", { name: "最新查询" })).toBeInTheDocument();
    first.resolve([{ ...dailyRow, id: "stale", employeeName: "旧查询" }]);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("cell", { name: "旧查询" })).not.toBeInTheDocument();
  });

  it("keeps only the latest applied punch query and renders corrections as effective", async () => {
    const first = deferred<EmployeePunchHistoryRow[]>();
    const second = deferred<EmployeePunchHistoryRow[]>();
    const loadRows = vi
      .fn()
      .mockImplementationOnce((_query, _signal: AbortSignal) => first.promise)
      .mockImplementationOnce((_query, _signal: AbortSignal) => second.promise);
    render(<PunchesPage role="manager" initialStoreId="store-a" stores={[]} employees={[]} today="2026-07-19" loadRows={loadRows} />);
    await waitFor(() => expect(loadRows).toHaveBeenCalledTimes(1));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "来源筛选" }), "correction");
    expect(loadRows).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() => expect(loadRows).toHaveBeenCalledTimes(2));
    expect((loadRows.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(true);
    second.resolve([{ id: "latest", userId: "employee-a", employeeName: "最新补卡", storeId: "store-a", time: "2026-07-19T01:05:00.000Z", direction: "in", source: "correction", valid: true }]);
    expect(await screen.findByRole("cell", { name: "最新补卡" })).toBeInTheDocument();
    expect(screen.getByText("已生效")).toBeInTheDocument();
    expect(screen.getByText("2026/7/19 09:05:00")).toBeInTheDocument();
    first.resolve([{ id: "stale", userId: "employee-a", employeeName: "旧查询", storeId: "store-a", time: "2026-07-19T01:05:00.000Z", direction: "in", source: "dynamic_code", valid: true }]);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("cell", { name: "旧查询" })).not.toBeInTheDocument();
  });

  it("blocks a mixed-type batch before any transition request", async () => {
    const transition = vi.fn();
    render(
      <DailyAttendancePage
        role="manager"
        initialStoreId="store-a"
        stores={[]}
        employees={[]}
        today="2026-07-19"
        loadRows={vi.fn().mockResolvedValue([
          dailyRow,
          { ...dailyRow, id: "exception-2", revision: 2, type: "missing_in" as const },
        ])}
        recalculate={vi.fn()}
        transition={transition}
        submitProxy={vi.fn()}
      />,
    );

    expect(await screen.findAllByRole("cell", { name: "小王" })).toHaveLength(2);
    const checkboxes = screen.getAllByRole("checkbox", { name: /选择 小王/ });
    await userEvent.click(checkboxes[0]);
    await userEvent.click(checkboxes[1]);
    expect(screen.getByText("批量操作只能选择同一种异常类型和状态")).toBeInTheDocument();
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
    expect(screen.getByRole("button", { name: "批量确认" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "批量确认" }));
    expect(transition).toHaveBeenCalledWith("confirm", { items: [{ id: "exception-1", revision: 4 }] });
  });

  it("allows unconfirm only for confirmed rows and sends their latest revision", async () => {
    const transition = vi.fn().mockResolvedValue(undefined);
    render(<DailyAttendancePage role="manager" initialStoreId="store-a" stores={[]} employees={[]} today="2026-07-19" loadRows={vi.fn().mockResolvedValue([{ ...dailyRow, status: "confirmed" as const, revision: 7 }])} recalculate={vi.fn()} transition={transition} submitProxy={vi.fn()} />);
    expect(await screen.findByRole("cell", { name: "小王" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "选择 小王 迟到" }));
    expect(screen.getByRole("button", { name: "批量确认" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "批量取消确认" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "批量取消确认" }));
    expect(transition).toHaveBeenCalledWith("unconfirm", { items: [{ id: "exception-1", revision: 7 }] });
  });

  it("drops same-frame double clicks for recalculation and transitions", async () => {
    const never = new Promise<never>(() => undefined);
    const recalculate = vi.fn(() => never);
    const transition = vi.fn(() => never);
    render(<DailyAttendancePage role="manager" initialStoreId="store-a" stores={[]} employees={[]} today="2026-07-19" loadRows={vi.fn().mockResolvedValue([dailyRow])} recalculate={recalculate} transition={transition} submitProxy={vi.fn()} />);
    expect(await screen.findByRole("cell", { name: "小王" })).toBeInTheDocument();
    const recalculateButton = screen.getByRole("button", { name: "重新计算" });
    act(() => { recalculateButton.click(); recalculateButton.click(); });
    expect(recalculate).toHaveBeenCalledTimes(1);

    cleanup();
    render(<DailyAttendancePage role="manager" initialStoreId="store-a" stores={[]} employees={[]} today="2026-07-19" loadRows={vi.fn().mockResolvedValue([dailyRow])} recalculate={vi.fn()} transition={transition} submitProxy={vi.fn()} />);
    expect(await screen.findByRole("cell", { name: "小王" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "选择 小王 迟到" }));
    const transitionButton = screen.getByRole("button", { name: "批量确认" });
    act(() => { transitionButton.click(); transitionButton.click(); });
    expect(transition).toHaveBeenCalledTimes(1);
  });
});

describe("manager proxy attendance requests", () => {
  it("submits a same-store employee leave as pending without claiming recalculation", async () => {
    const submitProxy = vi.fn().mockResolvedValue({ id: "leave-1", status: "pending" });
    render(
      <DailyAttendancePage
        role="manager"
        initialStoreId="store-a"
        stores={[]}
        employees={[{ id: "employee-a", name: "小王" }]}
        today="2026-07-19"
        loadRows={vi.fn().mockResolvedValue([dailyRow])}
        recalculate={vi.fn()}
        transition={vi.fn()}
        submitProxy={submitProxy}
      />,
    );

    expect(await screen.findByText("小王")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "代提交申请" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "员工" }), "employee-a");
    await userEvent.type(screen.getByLabelText("开始时间"), "2026-07-19T09:00");
    await userEvent.type(screen.getByLabelText("结束时间"), "2026-07-19T13:00");
    await userEvent.type(screen.getByRole("textbox", { name: "原因" }), "门店代提年假");
    const submitButton = screen.getByRole("button", { name: "提交代理申请" });
    act(() => { submitButton.click(); submitButton.click(); });

    expect(submitProxy).toHaveBeenCalledTimes(1);
    expect(submitProxy).toHaveBeenCalledWith({
      action: "proxy_leave",
      userId: "employee-a",
      type: "annual",
      startTime: "2026-07-19T09:00:00+08:00",
      endTime: "2026-07-19T13:00:00+08:00",
      isFullDay: false,
      reason: "门店代提年假",
    });
    expect(await screen.findByText("代理申请已提交，等待审批后重算")).toBeInTheDocument();
  });

  it("submits a same-store employee punch correction", async () => {
    const submitProxy = vi.fn().mockResolvedValue({ id: "correction-1", status: "pending" });
    render(
      <DailyAttendancePage
        role="manager"
        initialStoreId="store-a"
        stores={[]}
        employees={[{ id: "employee-a", name: "小王" }]}
        today="2026-07-19"
        loadRows={vi.fn().mockResolvedValue([dailyRow])}
        recalculate={vi.fn()}
        transition={vi.fn()}
        submitProxy={submitProxy}
      />,
    );

    expect(await screen.findByText("小王")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "代提交申请" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "员工" }), "employee-a");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "代理类型" }), "proxy_punch_correction");
    await userEvent.type(screen.getByLabelText("补卡时间"), "2026-07-19T09:00");
    await userEvent.type(screen.getByRole("textbox", { name: "原因" }), "漏打上班卡");
    expect(screen.getByRole("combobox", { name: "代理类型" })).toHaveValue("proxy_punch_correction");
    expect(screen.getByLabelText("补卡日期")).toHaveValue("2026-07-19");
    expect(screen.getByLabelText("补卡时间")).toHaveValue("2026-07-19T09:00");
    expect(screen.getByRole("textbox", { name: "原因" })).toHaveValue("漏打上班卡");
    await userEvent.click(screen.getByRole("button", { name: "提交代理申请" }));

    expect(submitProxy).toHaveBeenCalledWith({
      action: "proxy_punch_correction",
      userId: "employee-a",
      date: "2026-07-19",
      direction: "in",
      requestedTime: "2026-07-19T09:00:00+08:00",
      reason: "漏打上班卡",
    });
  });
});
