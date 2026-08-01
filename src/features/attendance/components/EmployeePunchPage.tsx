"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Btn, EnterpriseTable, PageHeader, Panel, StatusTag, type EnterpriseColumn } from "@/components/ui";
import { api } from "@/lib/client";
import type { PunchInput } from "@/lib/contracts/attendance";

export type EmployeePunchHistoryRow = {
  id: string;
  userId: string;
  employeeName: string;
  storeId: string;
  time: string;
  direction: "in" | "out";
  source: "dynamic_code" | "correction" | "legacy";
  valid: boolean;
};

export type EmployeePunchReceipt = {
  id: string;
  userId: string;
  storeId: string;
  time: string;
  direction: "in" | "out";
  viaCode: true;
};

export type EmployeePunchPageProps = {
  loadHistory: () => Promise<EmployeePunchHistoryRow[]>;
  submitPunch: (input: PunchInput) => Promise<EmployeePunchReceipt>;
};

const SOURCE_LABELS = {
  dynamic_code: "动态码",
  correction: "已批准补卡",
  legacy: "历史记录",
} as const;

export function formatAttendanceTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export default function EmployeePunchPage({ loadHistory, submitPunch }: EmployeePunchPageProps) {
  const [rows, setRows] = useState<EmployeePunchHistoryRow[]>([]);
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const punchInFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setError("");
      setRows(await loadHistory());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "本人打卡记录加载失败");
    } finally {
      setLoaded(true);
    }
  }, [loadHistory]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function punch() {
    if (!/^\d{6}$/.test(code) || punchInFlightRef.current) return;
    punchInFlightRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const receipt = await submitPunch({ direction, code });
      setMessage(`${direction === "in" ? "上班" : "下班"}打卡成功 · ${formatAttendanceTime(receipt.time)}`);
      setCode("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "打卡失败");
    } finally {
      punchInFlightRef.current = false;
      setBusy(false);
    }
  }

  const columns: EnterpriseColumn<EmployeePunchHistoryRow>[] = [
    { key: "time", title: "打卡时间", render: (row) => formatAttendanceTime(row.time) },
    { key: "direction", title: "方向", render: (row) => row.direction === "in" ? "上班" : "下班" },
    { key: "source", title: "来源", render: (row) => SOURCE_LABELS[row.source] },
    { key: "valid", title: "状态", render: (row) => row.source === "correction" ? <StatusTag tone="success">已生效</StatusTag> : <StatusTag tone={row.valid ? "success" : "neutral"}>{row.valid ? "有效" : "仅供追溯"}</StatusTag> },
  ];

  return (
    <div className="space-y-3">
      <PageHeader crumbs={["个人中心", "考勤管理", "Web 打卡"]} title="Web 打卡" />
      {error && <div role="alert" className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>}
      {message && <div role="status" className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">{message}</div>}
      <Panel title="本人打卡">
        <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-8 p-6">
          <div>
            <p className="text-[12px] text-[var(--text-muted)]">方向</p>
            <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label="打卡方向">
              {(["in", "out"] as const).map((value) => (
                <button key={value} type="button" aria-pressed={direction === value} onClick={() => setDirection(value)} className={`rounded border px-4 py-3 text-[13px] ${direction === value ? "border-[var(--primary)] bg-[var(--primary-weak)] text-[var(--primary)]" : "bg-white"}`}>
                  {value === "in" ? "上班" : "下班"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[12px] text-[var(--text-muted)]">6 位动态码
              <input aria-label="6 位动态码" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="enterprise-control mt-2 block w-[260px] border px-3 font-mono text-[22px] tracking-[0.3em]" placeholder="000000" />
            </label>
            <div className="mt-3"><Btn variant="primary" disabled={!/^\d{6}$/.test(code) || busy} onClick={() => void punch()}>{busy ? "提交中…" : `确认${direction === "in" ? "上班" : "下班"}打卡`}</Btn></div>
          </div>
        </div>
      </Panel>
      <Panel title="本人打卡历史">
        {!loaded ? <div className="enterprise-state border-0">加载中…</div> : <EnterpriseTable columns={columns} rows={rows} getRowKey={(row) => row.id} emptyText="暂无本人打卡记录" />}
      </Panel>
    </div>
  );
}

export function EmployeeAttendanceRouteClient() {
  const loadHistory = useCallback(() => api<EmployeePunchHistoryRow[]>("/api/attendance"), []);
  const submitPunch = useCallback((input: PunchInput) => api<EmployeePunchReceipt>("/api/attendance/punch", { method: "POST", body: input }), []);
  return <EmployeePunchPage loadHistory={loadHistory} submitPunch={submitPunch} />;
}
