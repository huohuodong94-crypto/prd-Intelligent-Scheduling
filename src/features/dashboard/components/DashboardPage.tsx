"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { DashboardSummary } from "@/lib/contracts/dashboard";
import { AsyncBoundary } from "@/components/enterprise";

type MetricProps = {
  label: string;
  value: number | null;
  testId?: string;
};

function Metric({ label, value, testId }: MetricProps) {
  return (
    <article className="border bg-white p-4" style={{ borderColor: "var(--border)", borderRadius: 4 }}>
      <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>{label}</div>
      {value === null ? (
        <div className="mt-2 text-[12px]" style={{ color: "var(--warning)" }}>待该模块完成计算</div>
      ) : (
        <div className="mt-1 text-[24px] font-semibold" data-testid={testId}>{value}</div>
      )}
    </article>
  );
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await api<DashboardSummary>("/api/dashboard"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "仪表盘加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <div className="mb-3 border-b pb-2" style={{ borderColor: "var(--border)" }}>
        <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>个人中心 / 首页</div>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-[18px] font-semibold">门店工作台</h1>
          {summary?.store && <span className="text-[12px]">{summary.store.name}</span>}
        </div>
      </div>

      <AsyncBoundary loading={loading} error={error} empty={!summary} onRetry={load}>
        {summary && (
          <div className="grid grid-cols-4 gap-3">
            <Metric label="待审批" value={summary.pendingApprovals} testId="pending-approvals" />
            <Metric label="草稿计划" value={summary.draftPlans} testId="draft-plans" />
            <Metric label="排班缺口" value={summary.scheduleGapCount} />
            <Metric label="考勤异常" value={summary.attendanceExceptionCount} />
          </div>
        )}
      </AsyncBoundary>
      <div className="mt-3 grid grid-cols-2 gap-3" aria-label="报表快捷入口">
        <a className="border bg-white p-4 text-[13px] text-[var(--primary)]" href="/reports/monthly">月度工时报表</a>
        <a className="border bg-white p-4 text-[13px] text-[var(--primary)]" href="/reports/scheduling">排班分析报表</a>
      </div>
    </section>
  );
}
