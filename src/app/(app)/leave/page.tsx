"use client";

import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@/components/ui";
import MyApplicationsPage from "@/features/approvals/components/MyApplicationsPage";
import { api } from "@/lib/client";

type Row = { id: string; status: string; summary?: string; reason?: string | null; requester?: { name: string }; targetUserId?: string; currentUserId?: string; reqSchedule?: { date: string; shiftType: string }; tgtSchedule?: { date: string; shiftType: string } };

export default function ApplicationsRoutePage() {
  const [leaves, setLeaves] = useState<Row[]>([]);
  const [corrections, setCorrections] = useState<Row[]>([]);
  const [swaps, setSwaps] = useState<Row[]>([]);
  const load = useCallback(async () => {
    const [leaveRows, correctionRows, swapRows] = await Promise.all([
      api<any[]>("/api/leave"), api<any[]>("/api/punch-corrections"), api<any[]>("/api/shift-swaps"),
    ]);
    setLeaves(leaveRows.map((row) => ({ ...row, summary: `${row.type === "annual" ? "年假" : "病假"} ${row.hours} 小时 · ${row.reason || "未填写事由"}` })));
    setCorrections(correctionRows.map((row) => ({ ...row, summary: `${new Date(row.date).toLocaleDateString("zh-CN")} ${row.direction === "in" ? "上班" : "下班"}补卡 · ${row.reason}` })));
    setSwaps(swapRows.map((row) => ({ ...row, requesterName: row.requester?.name, summary: `${row.requester?.name ?? "员工"}：${new Date(row.reqSchedule.date).toLocaleDateString("zh-CN")} ${row.reqSchedule.shiftType} ↔ ${new Date(row.tgtSchedule.date).toLocaleDateString("zh-CN")} ${row.tgtSchedule.shiftType}` })));
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function submit(path: string, input: Record<string, unknown>) { await api(path, { method: "POST", body: input }); await load(); }
  return <div className="space-y-3">
    <PageHeader crumbs={["劳动力管理", "我的申请"]} title="我的申请" />
    <MyApplicationsPage
      leaveRows={leaves}
      correctionRows={corrections}
      swapRows={swaps}
      onCreateLeave={(input) => submit("/api/leave", input)}
      onCreateCorrection={(input) => submit("/api/punch-corrections", input)}
      onCreateSwap={(input) => submit("/api/shift-swaps", input)}
      onAcceptTarget={(id) => submit("/api/shift-swaps", { action: "accept_target", requestId: id })}
    />
  </div>;
}
