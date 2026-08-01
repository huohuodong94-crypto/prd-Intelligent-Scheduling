"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActionToolbar, Btn, Drawer, EnterpriseTable, PageHeader, QueryBar, StatusTag, type EnterpriseColumn } from "@/components/ui";
import { api } from "@/lib/client";
import type { DailyAttendanceQuery, ProxyAttendanceRequest, RecalculateAttendanceInput } from "@/lib/contracts/attendance";

export type AttendanceRole = "manager" | "admin";
export type StoreOption = { id: string; name: string };
export type EmployeeOption = { id: string; name: string };
export type DailyAttendanceRow = {
  id: string;
  revision: number;
  userId: string;
  employeeName: string;
  date: string;
  type: "late" | "early_leave" | "missing_in" | "missing_out" | "unscheduled";
  minutes: number | null;
  status: "unconfirmed" | "confirmed";
  confirmedAt: string | null;
};

type TransitionInput = { items: Array<{ id: string; revision: number }> };

export type DailyAttendancePageProps = {
  role: AttendanceRole;
  initialStoreId: string;
  stores: StoreOption[];
  employees: EmployeeOption[];
  today: string;
  loadRows: (query: DailyAttendanceQuery, signal: AbortSignal) => Promise<DailyAttendanceRow[]>;
  loadEmployees?: (storeId: string, signal: AbortSignal) => Promise<EmployeeOption[]>;
  recalculate: (input: RecalculateAttendanceInput) => Promise<unknown>;
  transition: (action: "confirm" | "unconfirm", input: TransitionInput) => Promise<unknown>;
  submitProxy: (input: ProxyAttendanceRequest) => Promise<unknown>;
};

const TYPE_LABELS: Record<DailyAttendanceRow["type"], string> = {
  late: "迟到",
  early_leave: "早退",
  missing_in: "缺上班卡",
  missing_out: "缺下班卡",
  unscheduled: "未排班出勤",
};

export default function DailyAttendancePage(props: DailyAttendancePageProps) {
  const { role, initialStoreId, stores, employees, today, loadRows, loadEmployees, recalculate, transition, submitProxy } = props;
  const [storeId, setStoreId] = useState(initialStoreId);
  const [rows, setRows] = useState<DailyAttendanceRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionWarning, setSelectionWarning] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rowResultStatus, setRowResultStatus] = useState<"loading" | "ready" | "error">(initialStoreId ? "loading" : "ready");
  const [rowLoadError, setRowLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [type, setType] = useState<DailyAttendanceQuery["type"]>();
  const [status, setStatus] = useState<DailyAttendanceQuery["status"]>();
  const [userId, setUserId] = useState("");
  const [employeeOptions, setEmployeeOptions] = useState(employees);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [proxyAction, setProxyAction] = useState<"proxy_leave" | "proxy_punch_correction">("proxy_leave");
  const [proxyUserId, setProxyUserId] = useState("");
  const [proxyReason, setProxyReason] = useState("");
  const [leaveType, setLeaveType] = useState<"annual" | "sick">("annual");
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [isFullDay, setIsFullDay] = useState(false);
  const [correctionDate, setCorrectionDate] = useState(today);
  const [correctionDirection, setCorrectionDirection] = useState<"in" | "out">("in");
  const [correctionTime, setCorrectionTime] = useState("");
  const [appliedQuery, setAppliedQuery] = useState<DailyAttendanceQuery | null>(() => initialStoreId ? { storeId: initialStoreId, from: today, to: today } : null);
  const [reloadToken, setReloadToken] = useState(0);
  const rowRequestSequence = useRef(0);
  const employeeRequestSequence = useRef(0);
  const actionInFlightRef = useRef(false);

  const currentQuery = useCallback((): DailyAttendanceQuery => ({
    ...(storeId ? { storeId } : {}),
    from,
    to,
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(userId ? { userId } : {}),
  }), [from, status, storeId, to, type, userId]);

  useEffect(() => {
    if (!appliedQuery?.storeId) {
      setRows([]);
      setLoading(false);
      setRowLoadError("");
      setRowResultStatus("ready");
      return;
    }
    const requestId = ++rowRequestSequence.current;
    const controller = new AbortController();
    setLoading(true);
    setRowLoadError("");
    setRowResultStatus("loading");
    void loadRows(appliedQuery, controller.signal).then((nextRows) => {
      if (!controller.signal.aborted && requestId === rowRequestSequence.current) {
        setRows(nextRows);
        setRowResultStatus("ready");
      }
    }).catch((cause) => {
      if (!controller.signal.aborted && requestId === rowRequestSequence.current) {
        setRowLoadError(cause instanceof Error ? cause.message : "日异常加载失败");
        setRowResultStatus("error");
      }
    }).finally(() => {
      if (!controller.signal.aborted && requestId === rowRequestSequence.current) setLoading(false);
    });
    return () => controller.abort();
  }, [appliedQuery, loadRows, reloadToken]);

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

  const selectedRows = useMemo(() => rows.filter((row) => selected.includes(row.id)), [rows, selected]);
  const batchCompatible = selectedRows.length > 0 && selectedRows.every((row) => row.type === selectedRows[0].type && row.status === selectedRows[0].status);

  function applyDraftQuery() {
    if (!storeId) return;
    setError("");
    setSelected([]);
    setSelectionWarning("");
    setAppliedQuery(currentQuery());
  }

  function reloadAppliedRows() {
    setReloadToken((current) => current + 1);
  }

  function changeStore(nextStoreId: string) {
    setStoreId(nextStoreId);
    setUserId("");
    setSelected([]);
    setSelectionWarning("");
    setRows([]);
    setAppliedQuery(nextStoreId ? {
      storeId: nextStoreId,
      from,
      to,
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
    } : null);
  }

  function toggleRow(row: DailyAttendanceRow) {
    if (selected.includes(row.id)) {
      setSelected((current) => current.filter((id) => id !== row.id));
      setSelectionWarning("");
      return;
    }
    const anchor = selectedRows[0];
    if (anchor && (anchor.type !== row.type || anchor.status !== row.status)) {
      setSelectionWarning("批量操作只能选择同一种异常类型和状态");
      return;
    }
    setSelectionWarning("");
    setSelected((current) => [...current, row.id]);
  }

  async function runTransition(action: "confirm" | "unconfirm") {
    if (!batchCompatible || actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await transition(action, { items: selectedRows.map(({ id, revision }) => ({ id, revision })) });
      setSelected([]);
      setMessage(action === "confirm" ? "已确认所选异常" : "已取消确认");
      reloadAppliedRows();
    } catch (cause) {
      if (typeof cause === "object" && cause !== null && "status" in cause && cause.status === 409) {
        setError("状态已变化，已刷新最新数据");
        setSelected([]);
        reloadAppliedRows();
      } else {
        setError(cause instanceof Error ? cause.message : "异常状态更新失败");
      }
    } finally {
      actionInFlightRef.current = false;
      setBusy(false);
    }
  }

  function shanghaiOffset(value: string): string {
    return `${value}:00+08:00`;
  }

  async function runProxy() {
    if (!proxyUserId || !proxyReason.trim() || actionInFlightRef.current) return;
    if (proxyAction === "proxy_leave" && (!leaveStart || !leaveEnd)) return;
    if (proxyAction === "proxy_punch_correction" && (!correctionDate || !correctionTime)) return;
    actionInFlightRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (proxyAction === "proxy_leave") {
        await submitProxy({
          action: "proxy_leave",
          userId: proxyUserId,
          type: leaveType,
          startTime: shanghaiOffset(leaveStart),
          endTime: shanghaiOffset(leaveEnd),
          isFullDay,
          reason: proxyReason.trim(),
        });
      } else {
        await submitProxy({
          action: "proxy_punch_correction",
          userId: proxyUserId,
          date: correctionDate,
          direction: correctionDirection,
          requestedTime: shanghaiOffset(correctionTime),
          reason: proxyReason.trim(),
        });
      }
      setProxyOpen(false);
      setMessage("代理申请已提交，等待审批后重算");
      setProxyReason("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "代理申请提交失败");
    } finally {
      actionInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function runRecalculate() {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setBusy(true);
    setError("");
    try {
      await recalculate({ from, to });
      reloadAppliedRows();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重新计算失败");
    } finally {
      actionInFlightRef.current = false;
      setBusy(false);
    }
  }

  const columns: EnterpriseColumn<DailyAttendanceRow>[] = [
    { key: "select", title: "选择", width: 64, render: (row) => <input type="checkbox" aria-label={`选择 ${row.employeeName} ${TYPE_LABELS[row.type]}`} checked={selected.includes(row.id)} disabled={role === "admin"} onChange={() => toggleRow(row)} /> },
    { key: "date", title: "日期" },
    { key: "employeeName", title: "员工" },
    { key: "type", title: "异常", render: (row) => TYPE_LABELS[row.type] },
    { key: "minutes", title: "分钟", render: (row) => row.minutes ?? "—" },
    { key: "status", title: "状态", render: (row) => <StatusTag tone={row.status === "confirmed" ? "success" : "warning"}>{row.status === "confirmed" ? "已确认" : "待确认"}</StatusTag> },
    { key: "revision", title: "版本", render: (row) => `rev.${row.revision}` },
  ];

  return (
    <div className="space-y-3">
      <PageHeader crumbs={["劳动力管理", "考勤管理", "日异常"]} title="日考勤异常" extra={role === "admin" ? <select aria-label="选择门店" className="enterprise-control border px-2" value={storeId} onChange={(event) => changeStore(event.target.value)}><option value="">请选择门店</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select> : undefined} />
      {role === "admin" && !storeId && <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">管理员须明确选择门店后查看日异常</p>}
      {error && <div role="alert" className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>}
      {message && <div role="status" className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">{message}</div>}
      <QueryBar>
        <label className="text-[12px]">开始日期<input aria-label="开始日期" type="date" className="enterprise-control ml-2 border px-2" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="text-[12px]">结束日期<input aria-label="结束日期" type="date" className="enterprise-control ml-2 border px-2" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label className="text-[12px]">异常类型<select aria-label="异常类型" className="enterprise-control ml-2 border px-2" value={type ?? ""} onChange={(event) => setType((event.target.value || undefined) as DailyAttendanceQuery["type"])}><option value="">全部</option>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-[12px]">确认状态<select aria-label="确认状态" className="enterprise-control ml-2 border px-2" value={status ?? ""} onChange={(event) => setStatus((event.target.value || undefined) as DailyAttendanceQuery["status"])}><option value="">全部</option><option value="unconfirmed">待确认</option><option value="confirmed">已确认</option></select></label>
        <label className="text-[12px]">员工<select aria-label="员工筛选" className="enterprise-control ml-2 border px-2" value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">全部员工</option>{employeeOptions.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
        <Btn disabled={!storeId} onClick={applyDraftQuery}>查询</Btn>
      </QueryBar>
      {role === "manager" && <ActionToolbar>
        <Btn variant="primary" disabled={busy} onClick={() => void runRecalculate()}>重新计算</Btn>
        <Btn variant="success" disabled={!batchCompatible || selectedRows[0]?.status !== "unconfirmed" || busy} onClick={() => void runTransition("confirm")}>批量确认</Btn>
        <Btn disabled={!batchCompatible || selectedRows[0]?.status !== "confirmed" || busy} onClick={() => void runTransition("unconfirm")}>批量取消确认</Btn>
        <Btn onClick={() => setProxyOpen(true)}>代提交申请</Btn>
        {selectionWarning && <span role="status" className="text-[12px] text-amber-700">{selectionWarning}</span>}
      </ActionToolbar>}
      <section
        data-testid="daily-attendance-results"
        data-result-state={rowResultStatus === "error" ? "error" : rowResultStatus === "loading" || loading ? "loading" : rows.length > 0 ? "rows" : "empty"}
        aria-label="日考勤结果"
        aria-busy={rowResultStatus === "loading" || loading}
        aria-live="polite"
      >
        {rowResultStatus === "error" ? <div role="alert" className="enterprise-state">{rowLoadError}</div> : rowResultStatus === "loading" || loading ? <div className="enterprise-state">加载中…</div> : <EnterpriseTable columns={columns} rows={rows} getRowKey={(row) => row.id} emptyText="当前筛选范围内暂无日异常" />}
      </section>
      <Drawer open={proxyOpen} title="代提交考勤申请" onClose={() => setProxyOpen(false)} footer={<><Btn onClick={() => setProxyOpen(false)}>取消</Btn><Btn variant="primary" disabled={busy || !proxyUserId || !proxyReason.trim()} onClick={() => void runProxy()}>提交代理申请</Btn></>}>
        <div className="space-y-4 text-[12px]">
          <label className="block">员工<select aria-label="员工" className="enterprise-control mt-1 w-full border px-2" value={proxyUserId} onChange={(event) => setProxyUserId(event.target.value)}><option value="">请选择同店员工</option>{employeeOptions.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
          <label className="block">代理类型<select aria-label="代理类型" className="enterprise-control mt-1 w-full border px-2" value={proxyAction} onChange={(event) => setProxyAction(event.target.value as typeof proxyAction)}><option value="proxy_leave">请假</option><option value="proxy_punch_correction">补卡</option></select></label>
          {proxyAction === "proxy_leave" ? <>
            <label className="block">请假类型<select aria-label="请假类型" className="enterprise-control mt-1 w-full border px-2" value={leaveType} onChange={(event) => setLeaveType(event.target.value as typeof leaveType)}><option value="annual">年假</option><option value="sick">病假</option></select></label>
            <label className="block">开始时间<input aria-label="开始时间" type="datetime-local" className="enterprise-control mt-1 w-full border px-2" value={leaveStart} onChange={(event) => setLeaveStart(event.target.value)} /></label>
            <label className="block">结束时间<input aria-label="结束时间" type="datetime-local" className="enterprise-control mt-1 w-full border px-2" value={leaveEnd} onChange={(event) => setLeaveEnd(event.target.value)} /></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={isFullDay} onChange={(event) => setIsFullDay(event.target.checked)} />全天</label>
          </> : <>
            <label className="block">补卡日期<input aria-label="补卡日期" type="date" className="enterprise-control mt-1 w-full border px-2" value={correctionDate} onChange={(event) => setCorrectionDate(event.target.value)} /></label>
            <label className="block">补卡方向<select aria-label="补卡方向" className="enterprise-control mt-1 w-full border px-2" value={correctionDirection} onChange={(event) => setCorrectionDirection(event.target.value as typeof correctionDirection)}><option value="in">上班</option><option value="out">下班</option></select></label>
            <label className="block">补卡时间<input aria-label="补卡时间" type="datetime-local" className="enterprise-control mt-1 w-full border px-2" value={correctionTime} onChange={(event) => setCorrectionTime(event.target.value)} /></label>
          </>}
          <label className="block">原因<textarea aria-label="原因" className="mt-1 min-h-24 w-full rounded border p-2" value={proxyReason} onChange={(event) => setProxyReason(event.target.value)} /></label>
          <p className="text-[var(--text-muted)]">提交后进入普通审批；只有审批通过后才会重新计算受影响日期。</p>
        </div>
      </Drawer>
    </div>
  );
}

type EmployeeApiRow = { id: string; name: string; role?: string };

export function todayInShanghai(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function queryString(query: DailyAttendanceQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  return params.toString();
}

export function DailyAttendanceRouteClient({ role, initialStoreId }: { role: AttendanceRole; initialStoreId: string }) {
  const [stores, setStores] = useState<StoreOption[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void api<StoreOption[]>("/api/store/options", { signal: controller.signal }).then(setStores).catch(() => undefined);
    return () => controller.abort();
  }, []);

  const loadRows = useCallback((query: DailyAttendanceQuery, signal: AbortSignal) => api<DailyAttendanceRow[]>(`/api/attendance/daily?${queryString(query)}`, { signal }), []);
  const loadEmployees = useCallback(async (storeId: string, signal: AbortSignal) => {
    const result = await api<EmployeeApiRow[]>(`/api/store/employees?storeId=${encodeURIComponent(storeId)}`, { signal });
    return result.filter((employee) => (employee.role ?? "employee") === "employee").map(({ id, name }) => ({ id, name }));
  }, []);
  const recalculate = useCallback((input: RecalculateAttendanceInput) => api("/api/attendance/daily/recalculate", { method: "POST", body: input }), []);
  const transition = useCallback((action: "confirm" | "unconfirm", input: TransitionInput) => api(`/api/attendance/daily/${action}`, { method: "POST", body: input }), []);
  const submitProxy = useCallback((input: ProxyAttendanceRequest) => api("/api/attendance/daily", { method: "POST", body: input }), []);

  return <DailyAttendancePage role={role} initialStoreId={initialStoreId} stores={stores} employees={[]} today={todayInShanghai()} loadRows={loadRows} loadEmployees={loadEmployees} recalculate={recalculate} transition={transition} submitProxy={submitProxy} />;
}
