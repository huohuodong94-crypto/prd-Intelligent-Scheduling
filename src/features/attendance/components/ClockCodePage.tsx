"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PageHeader, Panel } from "@/components/ui";
import { api } from "@/lib/client";

const MIN_REFRESH_DELAY_MS = 250;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;

export type ClockCodeSnapshot = {
  currentCode: string;
  previousCode: string;
  refreshAt: string;
  expiresAt: string;
};

export type ClockCodePageProps = {
  loadCode: (signal: AbortSignal) => Promise<ClockCodeSnapshot>;
};

function shanghaiTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function secondsUntil(value: string, nowMs: number): number {
  return Math.max(0, Math.ceil((new Date(value).getTime() - nowMs) / 1_000));
}

export default function ClockCodePage({ loadCode }: ClockCodePageProps) {
  const [snapshot, setSnapshot] = useState<ClockCodeSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const inFlightRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let refreshTimer: number | undefined;
    let retryAttempt = 0;
    let controller: AbortController | undefined;

    function schedule(delayMs: number) {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(), delayMs);
    }

    async function refresh() {
      if (disposed || inFlightRef.current) return;
      inFlightRef.current = true;
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      setLoading(true);
      try {
        const next = await loadCode(requestController.signal);
        if (disposed || requestController.signal.aborted) return;
        retryAttempt = 0;
        setSnapshot(next);
        setError("");
        setLoading(false);
        setNowMs(Date.now());
        const serverDelay = new Date(next.refreshAt).getTime() - Date.now();
        schedule(Math.max(MIN_REFRESH_DELAY_MS, serverDelay));
      } catch (cause) {
        if (disposed || requestController.signal.aborted) return;
        setSnapshot(null);
        setLoading(false);
        const retryDelay = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** retryAttempt);
        retryAttempt += 1;
        const detail = cause instanceof Error && cause.message ? `：${cause.message}` : "";
        setError(`动态码加载失败${detail}。${Math.ceil(retryDelay / 1_000)} 秒后重试`);
        schedule(retryDelay);
      } finally {
        inFlightRef.current = false;
      }
    }

    const countdownTimer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    void refresh();
    return () => {
      disposed = true;
      inFlightRef.current = false;
      controller?.abort();
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      window.clearInterval(countdownTimer);
    };
  }, [loadCode]);

  return (
    <div className="space-y-3">
      <PageHeader crumbs={["劳动力管理", "考勤管理", "动态码"]} title="门店动态码" />
      {error && <div role="alert" className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>}
      <Panel className="overflow-hidden">
        {!snapshot ? (
          <div className="enterprise-state border-0">{loading ? "动态码加载中…" : "动态码暂不可用，正在等待重试"}</div>
        ) : (
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <section className="border-r p-8" style={{ borderColor: "var(--border)" }}>
              <p className="text-[12px] font-medium text-[var(--primary)]">当前窗口 · 员工输入此码打卡</p>
              <div className="mt-3 font-mono text-[52px] font-semibold tracking-[0.3em] text-[var(--text)]" aria-label={`当前动态码 ${snapshot.currentCode.split("").join(" ")}`}>{snapshot.currentCode}</div>
              <div
                role="progressbar"
                aria-label="当前动态码剩余时间"
                aria-valuemin={0}
                aria-valuemax={60}
                aria-valuenow={Math.min(60, secondsUntil(snapshot.refreshAt, nowMs))}
                className="mt-6 h-1 overflow-hidden rounded bg-[var(--primary-weak)]"
              >
                <div className="h-full bg-[var(--primary)]" style={{ width: `${Math.min(100, (secondsUntil(snapshot.refreshAt, nowMs) / 60) * 100)}%` }} />
              </div>
              <p role="timer" aria-live="polite" className="mt-2 text-[12px] text-[var(--text-muted)]">距离刷新 {secondsUntil(snapshot.refreshAt, nowMs)} 秒</p>
            </section>
            <section className="bg-[var(--table-head)] p-8">
              <p className="text-[12px] text-[var(--text-muted)]">上一窗口 · 容错期内仍可验证</p>
              <div className="mt-3 font-mono text-[28px] font-semibold tracking-[0.22em] text-slate-500" aria-label={`上一动态码 ${snapshot.previousCode.split("").join(" ")}`}>{snapshot.previousCode}</div>
              <div className="mt-8 rounded border bg-white p-3 text-[12px] leading-6" style={{ borderColor: "var(--border)" }}>
                <p>当前码刷新：{shanghaiTime(snapshot.refreshAt)}</p>
                <p aria-live="polite">最终失效：{shanghaiTime(snapshot.expiresAt)}（{secondsUntil(snapshot.expiresAt, nowMs)} 秒）</p>
              </div>
              <p className="mt-3 text-[11px] text-[var(--text-muted)]">动态码仅证明员工知道本店有效码，不代表定位或设备验证。</p>
            </section>
          </div>
        )}
      </Panel>
    </div>
  );
}

export function ClockCodeRouteClient() {
  const loadCode = useCallback((signal: AbortSignal) => api<ClockCodeSnapshot>("/api/clock-code", { signal }), []);
  return <ClockCodePage loadCode={loadCode} />;
}
