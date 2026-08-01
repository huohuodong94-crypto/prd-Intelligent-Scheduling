"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Btn, EnterpriseTable, PageHeader, QueryBar, StatusTag, type EnterpriseColumn } from "@/components/ui";
import { api } from "@/lib/client";
import type { PunchHistoryQuery } from "@/lib/contracts/attendance";
import type { AttendanceRole, EmployeeOption, StoreOption } from "./DailyAttendancePage";
import { formatAttendanceTime, type EmployeePunchHistoryRow } from "./EmployeePunchPage";

export type PunchesPageProps = {
  role: AttendanceRole;
  initialStoreId: string;
  stores: StoreOption[];
  employees: EmployeeOption[];
  today: string;
  loadRows: (query: PunchHistoryQuery, signal: AbortSignal) => Promise<EmployeePunchHistoryRow[]>;
  loadEmployees?: (storeId: string, signal: AbortSignal) => Promise<EmployeeOption[]>;
};

const SOURCE_LABELS = {
  dynamic_code: "动态码",
  correction: "已批准补卡",
  legacy: "历史记录",
} as const;

function queryString(query: PunchHistoryQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  return params.toString();
}

export default function PunchesPage({ role, initialStoreId, stores, employees, today, loadRows, loadEmployees }: PunchesPageProps) {
  const [storeId, setStoreId] = useState(initialStoreId);
  const [rows, setRows] = useState<EmployeePunchHistoryRow[]>([]);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [userId, setUserId] = useState("");
  const [direction, setDirection] = useState<"" | "in" | "out">("");
  const [source, setSource] = useState<"" | "dynamic_code" | "correction" | "legacy">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [employeeOptions, setEmployeeOptions] = useState(employees);
  const [appliedQuery, setAppliedQuery] = useState<PunchHistoryQuery | null>(() => initialStoreId ? { storeId: initialStoreId, from: today, to: today } : null);
  const rowRequestSequence = useRef(0);
  const employeeRequestSequence = useRef(0);

  const currentQuery = useCallback((): PunchHistoryQuery => ({
    ...(storeId ? { storeId } : {}),
    from,
    to,
    ...(userId ? { userId } : {}),
    ...(direction ? { direction } : {}),
    ...(source ? { source } : {}),
  }), [direction, from, source, storeId, to, userId]);

  useEffect(() => {
    if (!appliedQuery?.storeId) {
      setRows([]);
      setLoading(false);
      return;
    }
    const requestId = ++rowRequestSequence.current;
    const controller = new AbortController();
    setLoading(true);
    void loadRows(appliedQuery, controller.signal).then((nextRows) => {
      if (!controller.signal.aborted && requestId === rowRequestSequence.current) setRows(nextRows);
    }).catch((cause) => {
      if (!controller.signal.aborted && requestId === rowRequestSequence.current) setError(cause instanceof Error ? cause.message : "打卡记录加载失败");
    }).finally(() => {
      if (!controller.signal.aborted && requestId === rowRequestSequence.current) setLoading(false);
    });
    return () => controller.abort();
  }, [appliedQuery, loadRows]);

  useEffect(() => {
    if (!storeId || !loadEmployees) {
      if (!storeId) setEmployeeOptions([]);
      return;
    }
    const requestId = ++employeeRequestSequence.current;
    const controller = new AbortController();
    void loadEmployees(storeId, controller.signal).then((nextEmployees) => {
      if (!controller.signal.aborted && requestId === employeeRequestSequence.current) setEmployeeOptions(nextEmployees);
    }).catch((cause) => {
      if (!controller.signal.aborted && requestId === employeeRequestSequence.current) setError(cause instanceof Error ? cause.message : "员工筛选加载失败");
    });
    return () => controller.abort();
  }, [loadEmployees, storeId]);

  function applyDraftQuery() {
    if (!storeId) return;
    setError("");
    setAppliedQuery(currentQuery());
  }

  function changeStore(nextStoreId: string) {
    setStoreId(nextStoreId);
    setUserId("");
    setRows([]);
    setAppliedQuery(nextStoreId ? {
      storeId: nextStoreId,
      from,
      to,
      ...(direction ? { direction } : {}),
      ...(source ? { source } : {}),
    } : null);
  }

  const columns: EnterpriseColumn<EmployeePunchHistoryRow>[] = [
    { key: "time", title: "打卡时间", render: (row) => formatAttendanceTime(row.time) },
    { key: "employeeName", title: "员工" },
    { key: "direction", title: "方向", render: (row) => row.direction === "in" ? "上班" : "下班" },
    { key: "source", title: "来源", render: (row) => SOURCE_LABELS[row.source] },
    { key: "valid", title: "状态", render: (row) => row.source === "correction" ? <StatusTag tone="success">已生效</StatusTag> : <StatusTag tone={row.valid ? "success" : "neutral"}>{row.valid ? "有效" : "仅供追溯"}</StatusTag> },
  ];

  return (
    <div className="space-y-3">
      <PageHeader crumbs={["劳动力管理", "考勤管理", "打卡记录"]} title="门店打卡记录" extra={role === "admin" ? <select aria-label="选择门店" className="enterprise-control border px-2" value={storeId} onChange={(event) => changeStore(event.target.value)}><option value="">请选择门店</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select> : undefined} />
      {role === "admin" && !storeId && <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">管理员须明确选择门店后查看打卡记录</p>}
      {error && <div role="alert" className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>}
      <QueryBar>
        <label className="text-[12px]">开始日期<input aria-label="打卡开始日期" type="date" className="enterprise-control ml-2 border px-2" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="text-[12px]">结束日期<input aria-label="打卡结束日期" type="date" className="enterprise-control ml-2 border px-2" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label className="text-[12px]">员工<select aria-label="员工筛选" className="enterprise-control ml-2 border px-2" value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">全部员工</option>{employeeOptions.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
        <label className="text-[12px]">方向<select aria-label="方向筛选" className="enterprise-control ml-2 border px-2" value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}><option value="">全部方向</option><option value="in">上班</option><option value="out">下班</option></select></label>
        <label className="text-[12px]">来源<select aria-label="来源筛选" className="enterprise-control ml-2 border px-2" value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="">全部来源</option><option value="dynamic_code">动态码</option><option value="correction">已批准补卡</option><option value="legacy">历史记录</option></select></label>
        <Btn disabled={!storeId} onClick={applyDraftQuery}>查询</Btn>
      </QueryBar>
      {loading ? <div className="enterprise-state">加载中…</div> : <EnterpriseTable columns={columns} rows={rows} getRowKey={(row) => row.id} emptyText="当前筛选范围内暂无打卡记录" />}
    </div>
  );
}

type EmployeeApiRow = { id: string; name: string; role?: string };

export function PunchesRouteClient({ role, initialStoreId }: { role: AttendanceRole; initialStoreId: string }) {
  const [stores, setStores] = useState<StoreOption[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void api<StoreOption[]>("/api/store/options", { signal: controller.signal }).then(setStores).catch(() => undefined);
    return () => controller.abort();
  }, []);
  const loadRows = useCallback((query: PunchHistoryQuery, signal: AbortSignal) => api<EmployeePunchHistoryRow[]>(`/api/attendance/punches?${queryString(query)}`, { signal }), []);
  const loadEmployees = useCallback(async (storeId: string, signal: AbortSignal) => {
    const result = await api<EmployeeApiRow[]>(`/api/store/employees?storeId=${encodeURIComponent(storeId)}`, { signal });
    return result.filter((employee) => (employee.role ?? "employee") === "employee").map(({ id, name }) => ({ id, name }));
  }, []);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  return <PunchesPage role={role} initialStoreId={initialStoreId} stores={stores} employees={[]} today={today} loadRows={loadRows} loadEmployees={loadEmployees} />;
}
