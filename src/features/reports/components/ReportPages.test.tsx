import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { api } from "@/lib/client";
import type { MonthlyReport, SchedulingReport } from "@/lib/contracts/reports";
import MonthlyReportPage from "./MonthlyReportPage";
import SchedulingReportPage from "./SchedulingReportPage";

vi.mock("@/lib/client", () => ({
  api: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.mocked(api).mockReset();
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

function monthlyReport(month: string, employeeName: string): MonthlyReport {
  return {
    month,
    rows: [{ userId: employeeName, employeeName, scheduledHours: 40, workedHours: 36, leaveHours: 4, correctionHours: 0, exceptionCount: 1, confirmationStatus: "confirmed" }],
    totals: { scheduledHours: 40, workedHours: 36, leaveHours: 4, correctionHours: 0, exceptionCount: 1 },
  };
}

function schedulingReport(weekOf: string, employeeName: string): SchedulingReport {
  return {
    weekOf,
    employeeRows: [{ userId: employeeName, employeeName, shifts: 1, hours: 4, ability: "high", performance: "always" }],
    gaps: [],
    v2s: [],
    abilityBalance: [],
    ai: { generatedPlans: 1, acceptedPlans: 0, editedPlans: 1, acceptanceRate: 0, averageEditRatio: 0 },
  };
}

it("shows monthly canonical hours and confirmation state in a dense employee table", () => {
  render(<MonthlyReportPage initialData={{
    month: "2026-07",
    rows: [{ userId: "e1", employeeName: "小王", scheduledHours: 40, workedHours: 36, leaveHours: 4, correctionHours: 0, exceptionCount: 1, confirmationStatus: "confirmed" }],
    totals: { scheduledHours: 40, workedHours: 36, leaveHours: 4, correctionHours: 0, exceptionCount: 1 },
  }} />);

  const table = screen.getByRole("table", { name: "月度工时报表" });
  expect(screen.getByTestId("monthly-report-results")).toHaveAttribute("data-result-state", "rows");
  expect(table).toBeInTheDocument();
  expect(within(table).getByText("小王")).toBeInTheDocument();
  expect(within(table).getByText("已确认")).toBeInTheDocument();
  expect(within(table).getByText("36 h")).toBeInTheDocument();
});

it("shows employee schedules, staffing gaps, V2S boundary and canonical AI metrics", () => {
  render(<SchedulingReportPage initialData={{
    weekOf: "2026-07-20",
    employeeRows: [{ userId: "e1", employeeName: "小王", shifts: 1, hours: 4, ability: "high", performance: "always" }],
    gaps: [{ date: "2026-07-20", shift: "morning", position: "sales", required: 2, assigned: 1, shortfall: 1 }],
    v2s: [{ date: "2026-07-20", shift: "morning", visitors: 24, staff: 1, actualV2S: 24, lower: 5, upper: 10 }],
    abilityBalance: [{ date: "2026-07-20", shift: "morning", high: 1, mid: 0, low: 0 }],
    ai: { generatedPlans: 1, acceptedPlans: 0, editedPlans: 1, acceptanceRate: 0, averageEditRatio: 0 },
  }} />);

  const table = screen.getByRole("table", { name: "员工排班报表" });
  expect(screen.getByTestId("scheduling-report-results")).toHaveAttribute("data-result-state", "rows");
  expect(table).toBeInTheDocument();
  expect(within(table).getByText("小王")).toBeInTheDocument();
  expect(screen.getByText("销售")).toBeInTheDocument();
  expect(screen.getByText("24.00")).toBeInTheDocument();
  expect(screen.getByText("0.0%")).toBeInTheDocument();
});

it("formats all monthly report hours consistently", () => {
  render(<MonthlyReportPage initialData={{
    month: "2026-07",
    rows: [{ userId: "e1", employeeName: "小王", scheduledHours: 4, workedHours: 3.6666666666666665, leaveHours: 0, correctionHours: 0, exceptionCount: 2, confirmationStatus: "unconfirmed" }],
    totals: { scheduledHours: 4, workedHours: 3.6666666666666665, leaveHours: 0, correctionHours: 0, exceptionCount: 2 },
  }} />);

  expect(screen.getAllByText("4 h")).toHaveLength(2);
  expect(screen.getAllByText("3.67 h")).toHaveLength(2);
  expect(screen.getAllByText("0 h")).toHaveLength(4);
  expect(screen.queryByText(/3\.6666666666666665/)).not.toBeInTheDocument();
});

it("renders scheduling enums in Chinese and gives every empty result table a deterministic state", () => {
  render(<SchedulingReportPage initialData={{
    ...schedulingReport("2026-07-20", "小王"),
    employeeRows: [
      { userId: "e1", employeeName: "小王", shifts: 1, hours: 4, ability: "none", performance: "frequently" },
      { userId: "e2", employeeName: "小李", shifts: 1, hours: 4, ability: "high", performance: "always" },
    ],
  }} />);

  expect(screen.getByText("无")).toBeInTheDocument();
  expect(screen.getByText("经常")).toBeInTheDocument();
  expect(within(screen.getByRole("table", { name: "员工排班报表" })).getByText("高")).toBeInTheDocument();
  expect(screen.getByText("总是达标")).toBeInTheDocument();
  expect(screen.queryByText(/none|frequently|always/)).not.toBeInTheDocument();
  expect(screen.getByText("当前周暂无岗位人力缺口")).toBeInTheDocument();
  expect(screen.getByText("当前周暂无 V2S 数据")).toBeInTheDocument();
  expect(screen.getByText("当前周暂无能力搭配数据")).toBeInTheDocument();
});

it("uses deterministic Chinese labels instead of exposing unknown scheduling enum values", () => {
  render(<SchedulingReportPage initialData={{
    ...schedulingReport("2026-07-20", "历史员工"),
    employeeRows: [
      { userId: "legacy", employeeName: "历史员工", shifts: 1, hours: 4, ability: "legacy_unknown", performance: "legacy_bad" },
    ],
  }} />);

  const table = screen.getByRole("table", { name: "员工排班报表" });
  expect(within(table).getByText("未知")).toBeInTheDocument();
  expect(within(table).getByText("未标注")).toBeInTheDocument();
  expect(within(table).queryByText("legacy_unknown")).not.toBeInTheDocument();
  expect(within(table).queryByText("legacy_bad")).not.toBeInTheDocument();
});

it("exposes monthly loading, error and empty states without treating errors as business emptiness", async () => {
  const failed = deferred<MonthlyReport>();
  vi.mocked(api).mockImplementationOnce(() => failed.promise);
  const view = render(<MonthlyReportPage role="manager" initialStoreId="store-a" />);

  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId("monthly-report-results")).toHaveAttribute("data-result-state", "loading");
  expect(screen.queryByText("暂无已授权报表数据")).not.toBeInTheDocument();

  await act(async () => {
    failed.reject(new Error("月报网络失败"));
    await failed.promise.catch(() => undefined);
  });
  expect(screen.getByTestId("monthly-report-results")).toHaveAttribute("data-result-state", "error");
  expect(screen.getByRole("alert")).toHaveTextContent("月报网络失败");
  expect(screen.queryByText("暂无已授权报表数据")).not.toBeInTheDocument();

  view.unmount();
  render(<MonthlyReportPage initialData={{
    month: "2026-07",
    rows: [],
    totals: { scheduledHours: 0, workedHours: 0, leaveHours: 0, correctionHours: 0, exceptionCount: 0 },
  }} />);
  expect(screen.getByTestId("monthly-report-results")).toHaveAttribute("data-result-state", "empty");
  expect(screen.getByText("暂无已授权报表数据")).toBeInTheDocument();
});

it("exposes scheduling loading, error and empty states without treating errors as business emptiness", async () => {
  const failed = deferred<SchedulingReport>();
  vi.mocked(api).mockImplementationOnce(() => failed.promise);
  const view = render(<SchedulingReportPage role="manager" initialStoreId="store-a" />);

  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId("scheduling-report-results")).toHaveAttribute("data-result-state", "loading");
  expect(screen.queryByText("暂无已授权排班数据")).not.toBeInTheDocument();

  await act(async () => {
    failed.reject(new Error("排班报表网络失败"));
    await failed.promise.catch(() => undefined);
  });
  expect(screen.getByTestId("scheduling-report-results")).toHaveAttribute("data-result-state", "error");
  expect(screen.getByRole("alert")).toHaveTextContent("排班报表网络失败");
  expect(screen.queryByText("暂无已授权排班数据")).not.toBeInTheDocument();

  view.unmount();
  render(<SchedulingReportPage initialData={{
    weekOf: "2026-07-20",
    employeeRows: [], gaps: [], v2s: [], abilityBalance: [],
    ai: { generatedPlans: 0, acceptedPlans: 0, editedPlans: 0, acceptanceRate: null, averageEditRatio: null },
  }} />);
  expect(screen.getByTestId("scheduling-report-results")).toHaveAttribute("data-result-state", "empty");
  expect(screen.getByText("暂无已授权排班数据")).toBeInTheDocument();
});

it("keeps every report table inside a local horizontal scroll container", () => {
  const view = render(<MonthlyReportPage initialData={monthlyReport("2026-07", "小王")} />);
  expect(screen.getByTestId("monthly-report-table-scroll")).toHaveClass("overflow-x-auto");
  view.unmount();

  render(<SchedulingReportPage initialData={schedulingReport("2026-07-20", "小王")} />);
  for (const id of ["scheduling-employee-table-scroll", "scheduling-gaps-table-scroll", "scheduling-v2s-table-scroll", "scheduling-ability-table-scroll"]) {
    expect(screen.getByTestId(id)).toHaveClass("overflow-x-auto");
  }
});

it("does not show monthly data beside a changed month when the latest request fails", async () => {
  const failed = deferred<MonthlyReport>();
  vi.mocked(api).mockImplementationOnce(() => failed.promise);

  render(<MonthlyReportPage
    initialData={monthlyReport("2026-07", "旧月员工")}
    role="admin"
    initialStoreId="store-a"
  />);
  fireEvent.change(screen.getByLabelText("月份"), { target: { value: "2026-08" } });
  fireEvent.change(screen.getByLabelText("门店 ID"), { target: { value: "store-b" } });
  fireEvent.submit(screen.getByRole("button", { name: "查询" }).closest("form")!);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(api).toHaveBeenLastCalledWith(expect.stringContaining("month=2026-08&storeId=store-b"));
  expect(screen.queryByText("旧月员工")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查询中…" })).toBeDisabled();

  await act(async () => {
    failed.reject(new Error("新月份加载失败"));
    await failed.promise.catch(() => undefined);
  });
  expect(screen.getByRole("alert")).toHaveTextContent("新月份加载失败");
  expect(screen.queryByText("旧月员工")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查询" })).not.toBeDisabled();
});

it("keeps the latest monthly data when requests resolve out of order", async () => {
  const stale = deferred<MonthlyReport>();
  const latest = deferred<MonthlyReport>();
  vi.mocked(api)
    .mockImplementationOnce(() => stale.promise)
    .mockImplementationOnce(() => latest.promise);

  render(<MonthlyReportPage role="manager" initialStoreId="store-a" />);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  const monthInput = screen.getByLabelText("月份") as HTMLInputElement;
  const staleMonth = monthInput.value;
  const latestMonth = staleMonth === "2026-10" ? "2026-11" : "2026-10";
  fireEvent.change(monthInput, { target: { value: latestMonth } });
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));

  await act(async () => {
    latest.resolve(monthlyReport(latestMonth, "最新月员工"));
    await latest.promise;
  });
  expect(screen.getByText("最新月员工")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查询" })).not.toBeDisabled();

  await act(async () => {
    stale.resolve(monthlyReport(staleMonth, "过期月员工"));
    await stale.promise;
  });
  expect(screen.getByText("最新月员工")).toBeInTheDocument();
  expect(screen.queryByText("过期月员工")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查询" })).not.toBeDisabled();
});

it("invalidates an in-flight monthly request when an admin edits filters without submitting", async () => {
  const stale = deferred<MonthlyReport>();
  vi.mocked(api).mockImplementationOnce(() => stale.promise);

  render(<MonthlyReportPage
    initialData={monthlyReport("2026-07", "原月员工")}
    role="admin"
    initialStoreId="store-a"
  />);
  fireEvent.submit(screen.getByRole("button", { name: "查询" }).closest("form")!);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("月份"), { target: { value: "2026-08" } });
  fireEvent.change(screen.getByLabelText("门店 ID"), { target: { value: "store-b" } });
  const loadingClearedOnEdit = screen.queryByRole("button", { name: "查询" }) !== null;

  await act(async () => {
    stale.reject(new Error("过期月请求失败"));
    await stale.promise.catch(() => undefined);
  });
  expect({
    loadingClearedOnEdit,
    staleError: screen.queryByRole("alert")?.textContent ?? null,
    staleDataVisible: screen.queryByText("原月员工") !== null,
  }).toEqual({ loadingClearedOnEdit: true, staleError: null, staleDataVisible: false });
});

it("does not show scheduling data beside changed week and store when the latest request fails", async () => {
  const failed = deferred<SchedulingReport>();
  vi.mocked(api).mockImplementationOnce(() => failed.promise);

  render(<SchedulingReportPage
    initialData={schedulingReport("2026-07-20", "旧周员工")}
    role="admin"
    initialStoreId="store-a"
  />);
  fireEvent.change(screen.getByLabelText("周一"), { target: { value: "2026-07-27" } });
  fireEvent.change(screen.getByLabelText("门店 ID"), { target: { value: "store-b" } });
  fireEvent.submit(screen.getByRole("button", { name: "查询" }).closest("form")!);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(api).toHaveBeenLastCalledWith(expect.stringContaining("weekOf=2026-07-27&storeId=store-b"));
  expect(screen.queryByText("旧周员工")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查询中…" })).toBeDisabled();

  await act(async () => {
    failed.reject(new Error("新排班范围加载失败"));
    await failed.promise.catch(() => undefined);
  });
  expect(screen.getByRole("alert")).toHaveTextContent("新排班范围加载失败");
  expect(screen.queryByText("旧周员工")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查询" })).not.toBeDisabled();
});

it("keeps the latest scheduling data when requests resolve out of order", async () => {
  const stale = deferred<SchedulingReport>();
  const latest = deferred<SchedulingReport>();
  vi.mocked(api)
    .mockImplementationOnce(() => stale.promise)
    .mockImplementationOnce(() => latest.promise);

  render(<SchedulingReportPage role="manager" initialStoreId="store-a" />);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  const weekInput = screen.getByLabelText("周一") as HTMLInputElement;
  const staleWeek = weekInput.value;
  const latestWeek = staleWeek === "2026-08-03" ? "2026-08-10" : "2026-08-03";
  fireEvent.change(weekInput, { target: { value: latestWeek } });
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));

  await act(async () => {
    latest.resolve(schedulingReport(latestWeek, "最新周员工"));
    await latest.promise;
  });
  expect(screen.getByText("最新周员工")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查询" })).not.toBeDisabled();

  await act(async () => {
    stale.resolve(schedulingReport(staleWeek, "过期周员工"));
    await stale.promise;
  });
  expect(screen.getByText("最新周员工")).toBeInTheDocument();
  expect(screen.queryByText("过期周员工")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查询" })).not.toBeDisabled();
});

it("invalidates an in-flight scheduling request when an admin edits filters without submitting", async () => {
  const stale = deferred<SchedulingReport>();
  vi.mocked(api).mockImplementationOnce(() => stale.promise);

  render(<SchedulingReportPage
    initialData={schedulingReport("2026-07-20", "原周员工")}
    role="admin"
    initialStoreId="store-a"
  />);
  fireEvent.submit(screen.getByRole("button", { name: "查询" }).closest("form")!);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("周一"), { target: { value: "2026-07-27" } });
  fireEvent.change(screen.getByLabelText("门店 ID"), { target: { value: "store-b" } });
  const loadingClearedOnEdit = screen.queryByRole("button", { name: "查询" }) !== null;

  await act(async () => {
    stale.reject(new Error("过期排班请求失败"));
    await stale.promise.catch(() => undefined);
  });
  expect({
    loadingClearedOnEdit,
    staleError: screen.queryByRole("alert")?.textContent ?? null,
    staleDataVisible: screen.queryByText("原周员工") !== null,
  }).toEqual({ loadingClearedOnEdit: true, staleError: null, staleDataVisible: false });
});
