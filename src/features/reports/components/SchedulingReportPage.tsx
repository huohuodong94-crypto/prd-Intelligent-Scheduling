"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FilterBar, inputCls, PageHeader, Panel } from "@/components/ui";
import { POSITION_LABELS, SHIFT_LABELS } from "@/lib/config";
import { api } from "@/lib/client";
import type { SchedulingReport } from "@/lib/contracts/reports";
import { currentMonday } from "@/lib/dates";

type SchedulingReportPageProps = {
  initialData?: SchedulingReport | null;
  role?: "manager" | "admin";
  initialStoreId?: string;
};

type SchedulingReportQuery = { weekOf: string; storeId: string };
type ReportResultStatus = "loading" | "error" | "rows" | "empty";

const percentage = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const ABILITY_LABELS: Record<string, string> = { high: "高", mid: "中", low: "低", none: "无" };
const PERFORMANCE_LABELS: Record<string, string> = {
  always: "总是达标",
  almost_always: "几乎总是",
  frequently: "经常",
  sometimes: "有时",
  rarely: "很少",
};

function hasSchedulingRows(report: SchedulingReport) {
  return report.employeeRows.length > 0 || report.gaps.length > 0 || report.v2s.length > 0 || report.abilityBalance.length > 0;
}

export default function SchedulingReportPage({
  initialData = null,
  role = "manager",
  initialStoreId = "",
}: SchedulingReportPageProps) {
  const [weekOf, setWeekOf] = useState(initialData?.weekOf ?? currentMonday());
  const [storeId, setStoreId] = useState(initialStoreId);
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [data, setData] = useState<SchedulingReport | null>(initialData);
  const [appliedQuery, setAppliedQuery] = useState<SchedulingReportQuery | null>(() => initialData ? {
    weekOf: initialData.weekOf,
    storeId: initialStoreId.trim(),
  } : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultStatus, setResultStatus] = useState<ReportResultStatus>(() => initialData ? (hasSchedulingRows(initialData) ? "rows" : "empty") : "loading");
  const requestSequence = useRef(0);

  function invalidateRequestForQueryEdit() {
    requestSequence.current += 1;
    setData(null);
    setAppliedQuery(null);
    setError(null);
    setLoading(false);
    setResultStatus("loading");
  }

  function changeWeek(nextWeekOf: string) {
    invalidateRequestForQueryEdit();
    setWeekOf(nextWeekOf);
  }

  function changeStore(nextStoreId: string) {
    invalidateRequestForQueryEdit();
    setStoreId(nextStoreId);
  }

  const load = useCallback(async () => {
    const querySnapshot = { weekOf, storeId: storeId.trim() };
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
      const query = new URLSearchParams({ weekOf: querySnapshot.weekOf });
      if (querySnapshot.storeId) query.set("storeId", querySnapshot.storeId);
      const nextData = await api<SchedulingReport>(`/api/reports/scheduling?${query}`);
      if (requestId !== requestSequence.current) return;
      setData(nextData);
      setAppliedQuery(querySnapshot);
      setResultStatus(hasSchedulingRows(nextData) ? "rows" : "empty");
    } catch (requestError) {
      if (requestId !== requestSequence.current) return;
      setData(null);
      setAppliedQuery(null);
      setError(requestError instanceof Error ? requestError.message : "排班报表加载失败");
      setResultStatus("error");
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [role, storeId, weekOf]);

  useEffect(() => {
    if (!initialData && role === "manager") void load();
  }, [initialData, load, role]);

  const visibleData = appliedQuery?.weekOf === weekOf && appliedQuery.storeId === storeId.trim() ? data : null;

  const employeeRows = useMemo(() => {
    const keyword = employeeFilter.trim().toLowerCase();
    return keyword
      ? (visibleData?.employeeRows ?? []).filter((row) => row.employeeName.toLowerCase().includes(keyword) || row.userId.toLowerCase().includes(keyword))
      : visibleData?.employeeRows ?? [];
  }, [employeeFilter, visibleData]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void load();
  }

  return (
    <section className="space-y-3">
      <PageHeader crumbs={["报表中心", "排班分析报表"]} title="排班分析报表" />
      <form onSubmit={submit}><FilterBar>
        <label className="text-[12px]">周一
          <input aria-label="周一" className={`${inputCls} ml-2`} type="date" value={weekOf} onChange={(event) => changeWeek(event.target.value)} />
        </label>
        {role === "admin" && <label className="text-[12px]">门店 ID
          <input aria-label="门店 ID" className={`${inputCls} ml-2`} value={storeId} onChange={(event) => changeStore(event.target.value)} required />
        </label>}
        <label className="text-[12px]">员工筛选
          <input aria-label="员工筛选" className={`${inputCls} ml-2`} value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)} placeholder="仅过滤已授权响应" />
        </label>
        <button className="btn-primary" type="submit" disabled={loading}>{loading ? "查询中…" : "查询"}</button>
      </FilterBar></form>
      <section
        data-testid="scheduling-report-results"
        data-result-state={resultStatus}
        aria-label="排班报表结果"
        aria-busy={resultStatus === "loading"}
        aria-live="polite"
        className="space-y-3"
      >
      {resultStatus === "loading" ? <div className="enterprise-state">正在加载排班报表…</div> : resultStatus === "error" ? <div className="enterprise-state text-rose-600" role="alert">{error}</div> : visibleData && <>
      <div className="grid grid-cols-5 gap-3" aria-label="AI 指标">
        <div className="border bg-white p-3">生成计划 <b>{visibleData.ai.generatedPlans}</b></div>
        <div className="border bg-white p-3">采纳计划 <b>{visibleData.ai.acceptedPlans}</b></div>
        <div className="border bg-white p-3">编辑计划 <b>{visibleData.ai.editedPlans}</b></div>
        <div className="border bg-white p-3">采纳率 <b>{percentage(visibleData.ai.acceptanceRate)}</b></div>
        <div className="border bg-white p-3">平均编辑比 <b>{visibleData.ai.averageEditRatio === null ? "—" : visibleData.ai.averageEditRatio.toFixed(3)}</b></div>
      </div>
      <Panel title="员工班次与工时">
        <div className="thin-scroll overflow-x-auto" data-testid="scheduling-employee-table-scroll">
        <table className="ent-table" aria-label="员工排班报表"><thead><tr><th>员工</th><th>班次</th><th>工时</th><th>能力</th><th>绩效</th></tr></thead><tbody>
          {employeeRows.length === 0 ? <tr><td colSpan={5} className="py-6 text-center text-gray-400">暂无已授权排班数据</td></tr> : employeeRows.map((row) => <tr key={row.userId}><td>{row.employeeName}</td><td>{row.shifts}</td><td>{row.hours}</td><td>{ABILITY_LABELS[row.ability] ?? "未知"}</td><td>{PERFORMANCE_LABELS[row.performance] ?? "未标注"}</td></tr>)}
        </tbody></table></div>
      </Panel>
      <div className="grid grid-cols-2 gap-3">
        <Panel title="岗位人力缺口"><div className="thin-scroll overflow-x-auto" data-testid="scheduling-gaps-table-scroll"><table className="ent-table" aria-label="岗位人力缺口"><thead><tr><th>日期/班次</th><th>岗位</th><th>需求</th><th>已排</th><th>缺口</th></tr></thead><tbody>
          {(visibleData?.gaps ?? []).length === 0 ? <tr><td colSpan={5} className="py-6 text-center text-gray-400">当前周暂无岗位人力缺口</td></tr> : (visibleData?.gaps ?? []).map((row) => <tr key={`${row.date}-${row.shift}-${row.position}`}><td>{row.date} {SHIFT_LABELS[row.shift]}</td><td>{POSITION_LABELS[row.position]}</td><td>{row.required}</td><td>{row.assigned}</td><td>{row.shortfall}</td></tr>)}
        </tbody></table></div></Panel>
        <Panel title="V2S"><div className="thin-scroll overflow-x-auto" data-testid="scheduling-v2s-table-scroll"><table className="ent-table" aria-label="V2S"><thead><tr><th>日期/班次</th><th>客流</th><th>人数</th><th>实际 V2S</th><th>边界</th></tr></thead><tbody>
          {(visibleData?.v2s ?? []).length === 0 ? <tr><td colSpan={5} className="py-6 text-center text-gray-400">当前周暂无 V2S 数据</td></tr> : (visibleData?.v2s ?? []).map((row) => <tr key={`${row.date}-${row.shift}`}><td>{row.date} {SHIFT_LABELS[row.shift]}</td><td>{row.visitors}</td><td>{row.staff}</td><td>{row.actualV2S === null ? "—" : row.actualV2S.toFixed(2)}</td><td>{row.lower}–{row.upper}</td></tr>)}
        </tbody></table></div></Panel>
      </div>
      <Panel title="能力搭配"><div className="thin-scroll overflow-x-auto" data-testid="scheduling-ability-table-scroll"><table className="ent-table" aria-label="能力搭配"><thead><tr><th>日期/班次</th><th>高</th><th>中</th><th>低</th></tr></thead><tbody>
        {(visibleData?.abilityBalance ?? []).length === 0 ? <tr><td colSpan={4} className="py-6 text-center text-gray-400">当前周暂无能力搭配数据</td></tr> : (visibleData?.abilityBalance ?? []).map((row) => <tr key={`${row.date}-${row.shift}`}><td>{row.date} {SHIFT_LABELS[row.shift]}</td><td>{row.high}</td><td>{row.mid}</td><td>{row.low}</td></tr>)}
      </tbody></table></div></Panel>
      </>}
      </section>
    </section>
  );
}
