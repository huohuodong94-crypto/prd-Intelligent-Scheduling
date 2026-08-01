"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FilterBar, inputCls, PageHeader, Panel } from "@/components/ui";
import { api } from "@/lib/client";
import type { MonthlyReport } from "@/lib/contracts/reports";
import { shanghaiMonthForInstant } from "@/lib/dates";
import { formatHours } from "@/lib/format";

type MonthlyReportPageProps = {
  initialData?: MonthlyReport | null;
  role?: "manager" | "admin";
  initialStoreId?: string;
};

type MonthlyReportQuery = { month: string; storeId: string };
type ReportResultStatus = "loading" | "error" | "rows" | "empty";

export default function MonthlyReportPage({
  initialData = null,
  role = "manager",
  initialStoreId = "",
}: MonthlyReportPageProps) {
  const [month, setMonth] = useState(initialData?.month ?? shanghaiMonthForInstant(new Date()));
  const [storeId, setStoreId] = useState(initialStoreId);
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [data, setData] = useState<MonthlyReport | null>(initialData);
  const [appliedQuery, setAppliedQuery] = useState<MonthlyReportQuery | null>(() => initialData ? {
    month: initialData.month,
    storeId: initialStoreId.trim(),
  } : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultStatus, setResultStatus] = useState<ReportResultStatus>(() => initialData ? (initialData.rows.length > 0 ? "rows" : "empty") : "loading");
  const requestSequence = useRef(0);

  function invalidateRequestForQueryEdit() {
    requestSequence.current += 1;
    setData(null);
    setAppliedQuery(null);
    setError(null);
    setLoading(false);
    setResultStatus("loading");
  }

  function changeMonth(nextMonth: string) {
    invalidateRequestForQueryEdit();
    setMonth(nextMonth);
  }

  function changeStore(nextStoreId: string) {
    invalidateRequestForQueryEdit();
    setStoreId(nextStoreId);
  }

  const load = useCallback(async () => {
    const querySnapshot = { month, storeId: storeId.trim() };
    if (role === "admin" && !querySnapshot.storeId) {
      requestSequence.current += 1;
      setData(null);
      setAppliedQuery(null);
      setLoading(false);
      setError("管理员必须显式指定门店");
      setResultStatus("error");
      return;
    }
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setData(null);
    setAppliedQuery(null);
    setResultStatus("loading");
    try {
      const query = new URLSearchParams({ month: querySnapshot.month });
      if (querySnapshot.storeId) query.set("storeId", querySnapshot.storeId);
      const nextData = await api<MonthlyReport>(`/api/reports/monthly?${query}`);
      if (requestId !== requestSequence.current) return;
      setData(nextData);
      setAppliedQuery(querySnapshot);
      setResultStatus(nextData.rows.length > 0 ? "rows" : "empty");
    } catch (requestError) {
      if (requestId !== requestSequence.current) return;
      setData(null);
      setAppliedQuery(null);
      setError(requestError instanceof Error ? requestError.message : "月度报表加载失败");
      setResultStatus("error");
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [month, role, storeId]);

  useEffect(() => {
    if (!initialData && role === "manager") void load();
  }, [initialData, load, role]);

  const visibleData = appliedQuery?.month === month && appliedQuery.storeId === storeId.trim() ? data : null;

  const rows = useMemo(() => {
    const keyword = employeeFilter.trim().toLowerCase();
    return keyword
      ? (visibleData?.rows ?? []).filter((row) => row.employeeName.toLowerCase().includes(keyword) || row.userId.toLowerCase().includes(keyword))
      : visibleData?.rows ?? [];
  }, [employeeFilter, visibleData]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void load();
  }

  return (
    <section className="space-y-3">
      <PageHeader crumbs={["报表中心", "月度工时报表"]} title="月度工时报表" />
      <form onSubmit={submit}>
        <FilterBar>
          <label className="text-[12px]">月份
            <input aria-label="月份" className={`${inputCls} ml-2`} type="month" value={month} onChange={(event) => changeMonth(event.target.value)} />
          </label>
          {role === "admin" && (
            <label className="text-[12px]">门店 ID
              <input aria-label="门店 ID" className={`${inputCls} ml-2`} value={storeId} onChange={(event) => changeStore(event.target.value)} required />
            </label>
          )}
          <label className="text-[12px]">员工筛选
            <input aria-label="员工筛选" className={`${inputCls} ml-2`} value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)} placeholder="姓名或员工 ID" />
          </label>
          <button className="btn-primary" type="submit" disabled={loading}>{loading ? "查询中…" : "查询"}</button>
        </FilterBar>
      </form>
      <section
        data-testid="monthly-report-results"
        data-result-state={resultStatus === "rows" && rows.length === 0 ? "empty" : resultStatus}
        aria-label="月度报表结果"
        aria-busy={resultStatus === "loading"}
        aria-live="polite"
        className="space-y-3"
      >
      {resultStatus === "loading" ? <div className="enterprise-state">正在加载月度报表…</div> : resultStatus === "error" ? <div className="enterprise-state text-rose-600" role="alert">{error}</div> : visibleData && <>
        <div className="grid grid-cols-5 gap-3" aria-label="月度汇总">
          {([
            ["计划工时", visibleData.totals.scheduledHours],
            ["实际工时", visibleData.totals.workedHours],
            ["请假工时", visibleData.totals.leaveHours],
            ["修正工时", visibleData.totals.correctionHours],
            ["异常数", visibleData.totals.exceptionCount],
          ] as const).map(([label, value]) => <div className="border bg-white p-3" key={label}><div className="text-[12px] text-gray-500">{label}</div><div className="text-[20px] font-semibold">{label === "异常数" ? value : formatHours(value)}</div></div>)}
        </div>
      <Panel title="员工月度工时明细">
        <div className="thin-scroll overflow-x-auto" data-testid="monthly-report-table-scroll">
        <table className="ent-table" aria-label="月度工时报表">
          <thead><tr><th>员工</th><th>计划</th><th>实际</th><th>请假</th><th>修正</th><th>异常</th><th>确认状态</th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={7} className="py-6 text-center text-gray-400">暂无已授权报表数据</td></tr> : rows.map((row) => (
              <tr key={row.userId}>
                <td>{row.employeeName}</td><td>{formatHours(row.scheduledHours)}</td><td>{formatHours(row.workedHours)}</td><td>{formatHours(row.leaveHours)}</td><td>{formatHours(row.correctionHours)}</td><td>{row.exceptionCount}</td>
                <td>{row.confirmationStatus === "confirmed" ? "已确认" : "未确认"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Panel>
      </>}
      </section>
    </section>
  );
}
