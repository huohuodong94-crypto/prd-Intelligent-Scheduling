"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActionToolbar, EnterpriseTable, QueryBar, StatusTag, type EnterpriseColumn } from "@/components/ui";
import { Btn, PageHeader } from "@/components/ui";
import { api } from "@/lib/client";
import { formatHours } from "@/lib/format";
import {
  validateMonthlyConfirmation,
  type MonthlyAttendanceRow,
  type MonthlyConfirmInput,
  type MonthlyUnconfirmInput,
  type ZeroAttendanceAction,
} from "@/lib/contracts/monthly-attendance";

export type MonthlyAttendancePageProps = {
  initialMonth: string;
  initialRows: MonthlyAttendanceRow[];
  onConfirm: (input: Omit<MonthlyConfirmInput, "storeId">) => Promise<void>;
  onUnconfirm: (input: Omit<MonthlyUnconfirmInput, "storeId">) => Promise<void>;
  loadRows?: (month: string) => Promise<MonthlyAttendanceRow[]>;
  readOnly?: boolean;
};

export default function MonthlyAttendancePage({ initialMonth, initialRows, onConfirm, onUnconfirm, loadRows, readOnly = false }: MonthlyAttendancePageProps) {
  const [month, setMonth] = useState(initialMonth);
  const [rows, setRows] = useState(initialRows);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rowResultStatus, setRowResultStatus] = useState<"loading" | "ready" | "error">(loadRows && initialRows.length === 0 ? "loading" : "ready");
  const [rowLoadError, setRowLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const actionInFlight = useRef(false);
  const loadRequestSequence = useRef(0);
  const skipInitialLoad = useRef(initialRows.length > 0);

  const requestRows = useCallback(async (targetMonth: string) => {
    if (!loadRows) {
      setRowLoadError("");
      setRowResultStatus("ready");
      return true;
    }
    const requestId = ++loadRequestSequence.current;
    setLoading(true);
    setRowLoadError("");
    setRowResultStatus("loading");
    try {
      const nextRows = await loadRows(targetMonth);
      if (requestId !== loadRequestSequence.current) return false;
      setRows(nextRows);
      setRowResultStatus("ready");
      return true;
    } catch (cause) {
      if (requestId !== loadRequestSequence.current) return false;
      setRowLoadError(cause instanceof Error ? cause.message : "月度考勤加载失败");
      setRowResultStatus("error");
      return false;
    } finally {
      if (requestId === loadRequestSequence.current) setLoading(false);
    }
  }, [loadRows]);

  useEffect(() => {
    if (!loadRows) return;
    if (skipInitialLoad.current) {
      skipInitialLoad.current = false;
      return;
    }
    setSelected([]);
    setMessage("");
    void requestRows(month);
  }, [loadRows, month, requestRows]);

  const selectedRows = useMemo(() => rows.filter((row) => selected.includes(row.userId)), [rows, selected]);
  const selectedValidation = useMemo(() => validateMonthlyConfirmation(selectedRows), [selectedRows]);
  const allBlockers = useMemo(() => validateMonthlyConfirmation(rows), [rows]);
  const canConfirm = selectedRows.length > 0
    && selectedRows.every((row) => row.status === "unconfirmed")
    && selectedValidation.ok
    && allBlockers.ok
    && !readOnly
    && !busy
    && !loading;
  const canUnconfirm = selectedRows.length > 0 && selectedRows.every((row) => row.status === "confirmed") && !readOnly && !busy && !loading;

  function toggle(userId: string) {
    setSelected((current) => current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]);
  }

  function setAction(userId: string, zeroAttendanceAction: ZeroAttendanceAction) {
    setRows((current) => current.map((row) => row.userId === userId ? { ...row, zeroAttendanceAction } : row));
  }

  async function run(action: "confirm" | "unconfirm") {
    if (actionInFlight.current || (action === "confirm" ? !canConfirm : !canUnconfirm)) return;
    actionInFlight.current = true;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      if (action === "confirm") {
        await onConfirm({
          month,
          rows: selectedRows.map((row) => ({
            userId: row.userId,
            zeroAttendanceAction: row.zeroAttendanceAction,
            expectedRevision: row.revision,
            expectedSourceHash: row.sourceHash,
          })),
        });
      } else {
        await onUnconfirm({
          month,
          rows: selectedRows.map((row) => ({ userId: row.userId, expectedRevision: row.revision })),
        });
      }
      setSelected([]);
      const refreshed = await requestRows(month);
      if (refreshed) setMessage(action === "confirm" ? "已确认所选月度考勤" : "已取消所选月度考勤确认");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "月度考勤操作失败");
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  const columns: EnterpriseColumn<MonthlyAttendanceRow>[] = [
    {
      key: "select",
      title: "选择",
      width: 56,
      render: (row) => <input type="checkbox" aria-label={`选择${row.employeeName}`} checked={selected.includes(row.userId)} onChange={() => toggle(row.userId)} disabled={busy || loading || readOnly} />,
    },
    { key: "employeeName", title: "员工" },
    { key: "hours", title: "工时", render: (row) => <span>{`计划 ${formatHours(row.scheduledHours)} / 实际 ${formatHours(row.workedHours)}`}</span> },
    { key: "exceptions", title: "异常", render: (row) => <span>{row.exceptionCount} 条（未确认 {row.unconfirmedExceptionCount}）</span> },
    {
      key: "zeroAttendanceAction",
      title: "0 考勤处理",
      render: (row) => row.zeroAttendance ? (
        <select
          aria-label={`${row.employeeName} 0 考勤处理`}
          value={row.zeroAttendanceAction}
          onChange={(event) => setAction(row.userId, event.target.value as ZeroAttendanceAction)}
          disabled={busy || loading || readOnly || row.status === "confirmed"}
          className="rounded border px-2 py-1 text-[12px]"
        >
          <option value="none">请选择</option>
          <option value="normal_attendance">按正常出勤确认</option>
          <option value="supplement_hours">待补录工时</option>
        </select>
      ) : <span className="text-[var(--text-muted)]">不适用</span>,
    },
    {
      key: "status",
      title: "确认状态",
      render: (row) => <StatusTag tone={row.status === "confirmed" ? "success" : "warning"}>{row.status === "confirmed" ? "已确认" : "未确认"}</StatusTag>,
    },
  ];

  return (
    <div>
      <PageHeader crumbs={["考勤管理", "月度考勤"]} title="月度考勤汇总" />
      <QueryBar actions={<span className="text-[12px] text-gray-500">仅当前门店员工</span>}>
        <label className="text-[12px] text-gray-600">
          月份
          <input aria-label="月份" type="month" value={month} onChange={(event) => {
            const next = event.target.value;
            setMonth(next);
            setSelected([]);
            setMessage("");
          }} disabled={busy || loading} className="ml-2 rounded border px-2 py-1" />
        </label>
      </QueryBar>

      {!allBlockers.ok && (
        <div role="alert" className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          {allBlockers.blocked.flatMap((blocked) => blocked.reasons.map((reason) => {
            const employee = rows.find((row) => row.userId === blocked.userId)?.employeeName ?? blocked.userId;
            return <div key={`${blocked.userId}:${reason}`}><strong>{employee}：</strong><span>{reason}</span></div>;
          }))}
        </div>
      )}

      {rows.some((row) => row.needsReconfirmation) && (
        <div className="mb-3 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-[12px] text-sky-800">源数据已变化，需重新计算并确认</div>
      )}
      {message && <div role="status" className="mb-3 text-[12px] text-emerald-700">{message}</div>}
      {error && <div role="alert" className="mb-3 text-[12px] text-rose-700">{error}</div>}

      <ActionToolbar end={<span className="text-[12px] text-gray-500">已选 {selected.length} 人</span>}>
        <Btn variant="primary" disabled={!canConfirm} onClick={() => void run("confirm")}>确认考勤</Btn>
        <Btn disabled={!canUnconfirm} onClick={() => void run("unconfirm")}>取消确认</Btn>
      </ActionToolbar>
      <section
        data-testid="monthly-attendance-results"
        data-result-state={rowResultStatus === "error" ? "error" : rowResultStatus === "loading" || loading ? "loading" : rows.length > 0 ? "rows" : "empty"}
        aria-label="月度考勤结果"
        aria-busy={rowResultStatus === "loading" || loading}
        aria-live="polite"
      >
        {rowResultStatus === "error" ? <div role="alert" className="enterprise-state">{rowLoadError}</div> : rowResultStatus === "loading" || loading ? <div className="enterprise-state">加载月度考勤…</div> : <EnterpriseTable columns={columns} rows={rows} getRowKey={(row) => row.userId} emptyText="当前月份暂无员工考勤" />}
      </section>
    </div>
  );
}

type MonthlyAttendanceRole = "manager" | "admin";
type StoreOption = { id: string; name: string };

export function currentShanghaiMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

export function MonthlyAttendanceRouteClient({ role, initialStoreId }: { role: MonthlyAttendanceRole; initialStoreId: string }) {
  const [storeId, setStoreId] = useState(initialStoreId);
  const [stores, setStores] = useState<StoreOption[]>([]);

  useEffect(() => {
    if (role !== "admin") return;
    const controller = new AbortController();
    void api<StoreOption[]>("/api/store/options", { signal: controller.signal }).then(setStores).catch(() => undefined);
    return () => controller.abort();
  }, [role]);

  const loadRows = useCallback(async (nextMonth: string) => {
    if (!storeId) return [];
    const params = new URLSearchParams({ month: nextMonth });
    if (role === "admin") params.set("storeId", storeId);
    return api<MonthlyAttendanceRow[]>(`/api/attendance/monthly?${params}`);
  }, [role, storeId]);

  const confirm = useCallback(async (input: Omit<MonthlyConfirmInput, "storeId">) => {
    await api("/api/attendance/monthly/confirm", { method: "POST", body: input });
  }, []);
  const unconfirm = useCallback(async (input: Omit<MonthlyUnconfirmInput, "storeId">) => {
    await api("/api/attendance/monthly/unconfirm", { method: "POST", body: input });
  }, []);

  return <div className="space-y-3">
    {role === "admin" && <label className="text-[12px]">门店<select aria-label="选择门店" className="enterprise-control ml-2 border px-2" value={storeId} onChange={(event) => setStoreId(event.target.value)}><option value="">请选择门店</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>}
    {role === "admin" && !storeId && <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">管理员须明确选择门店后查看月度考勤</p>}
    <MonthlyAttendancePage initialMonth={currentShanghaiMonth()} initialRows={[]} onConfirm={confirm} onUnconfirm={unconfirm} loadRows={loadRows} readOnly={role === "admin"} />
  </div>;
}
