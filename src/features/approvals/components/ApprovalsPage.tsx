"use client";

import { useEffect, useMemo, useState } from "react";

import { Btn, Dialog, Panel, Tag } from "@/components/ui";
import type { ApprovalDecisionInput, ApprovalItem } from "@/lib/contracts/approvals";

export type ApprovalsPageProps = {
  initialItems: ApprovalItem[];
  onAiCheck: (item: ApprovalItem) => Promise<{ suggestion: "compliant" | "suspicious"; reason: string; aiLogId: string }>;
  onDecide: (input: ApprovalDecisionInput) => Promise<void>;
  onRefresh?: () => Promise<void> | void;
  readOnly?: boolean;
};

export const APPROVAL_TABS = [
  { key: "pending", label: "待审批" },
  { key: "history", label: "审批记录" },
] as const;

const APPROVAL_TYPE_LABELS: Record<ApprovalItem["type"], string> = {
  leave: "请假",
  punch_correction: "补卡",
  shift_swap: "换班",
};

const APPROVAL_STATUS_LABELS: Record<ApprovalItem["status"], string> = {
  pending: "待审批",
  approved: "已通过",
  rejected: "已驳回",
};

export default function ApprovalsPage({ initialItems, onAiCheck, onDecide, onRefresh, readOnly = false }: ApprovalsPageProps) {
  const [items, setItems] = useState(initialItems);
  const [tab, setTab] = useState<(typeof APPROVAL_TABS)[number]["key"]>("pending");
  const [selected, setSelected] = useState<string[]>([]);
  const [aiLogIds, setAiLogIds] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [detail, setDetail] = useState<ApprovalItem | null>(null);
  useEffect(() => setItems(initialItems), [initialItems]);
  const visible = useMemo(() => items.filter((item) => {
    if (tab === "pending" ? item.status !== "pending" : item.status === "pending") return false;
    if (typeFilter && item.type !== typeFilter) return false;
    if (employeeFilter && !item.employeeName.includes(employeeFilter.trim())) return false;
    if (dateFilter && item.submittedAt.slice(0, 10) !== dateFilter) return false;
    return true;
  }), [items, tab, typeFilter, employeeFilter, dateFilter]);

  function key(item: Pick<ApprovalItem, "type" | "id">) { return `${item.type}:${item.id}`; }
  function toggle(item: ApprovalItem) {
    if (readOnly || item.status !== "pending") return;
    const value = key(item);
    setSelected((current) => current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]);
  }

  async function ai(item: ApprovalItem) {
    setBusy(true); setMessage("");
    try {
      const advice = await onAiCheck(item);
      setItems((current) => current.map((row) => key(row) === key(item) ? { ...row, aiSuggestion: advice.suggestion, aiReason: advice.reason } : row));
      setAiLogIds((current) => ({ ...current, [key(item)]: advice.aiLogId }));
    } catch (error) { setMessage(error instanceof Error ? error.message : "AI 建议获取失败"); }
    finally { setBusy(false); }
  }

  async function decide(decision: "approved" | "rejected") {
    const selectedItems = items.filter((item) => selected.includes(key(item)) && item.status === "pending");
    if (!selectedItems.length) return;
    setBusy(true); setMessage("");
    try {
      await onDecide({ items: selectedItems.map(({ id, type }) => ({ id, type })), decision, reason: decision === "rejected" ? reason : null, aiLogIds: selectedItems.map((item) => aiLogIds[key(item)]).filter(Boolean) });
      setItems((current) => current.map((item) => selected.includes(key(item)) ? { ...item, status: decision, decisionReason: decision === "rejected" ? reason : null } : item));
      setSelected([]); setDialog(false); setReason("");
    } catch (error) {
      if (typeof error === "object" && error !== null && "status" in error && error.status === 409) {
        setMessage("单据状态已变化，请核对后重试");
        await onRefresh?.();
      } else setMessage(error instanceof Error ? error.message : "审批失败");
    } finally { setBusy(false); }
  }

  return <div className="space-y-3">
    {message && <p className="text-[12px] text-rose-600">{message}</p>}
    <Panel>
      <div role="tablist" className="flex items-center gap-2 border-b p-3">
        {APPROVAL_TABS.map((entry) => <button role="tab" aria-selected={tab === entry.key} key={entry.key} onClick={() => setTab(entry.key)} className="px-3 py-1 text-[13px]">{entry.label}</button>)}
        <span className="ml-auto text-[11px] text-[var(--text-muted)]">AI 仅提供建议，最终决定必须人工提交</span>
      </div>
      {tab === "pending" && !readOnly && <div className="flex gap-2 p-3 border-b">
        <Btn variant="success" disabled={!selected.length || busy} onClick={() => void decide("approved")}>批量通过</Btn>
        <Btn variant="danger" disabled={!selected.length || busy} onClick={() => setDialog(true)}>批量驳回</Btn>
      </div>}
      <div className="flex gap-2 border-b p-3">
        <select aria-label="审批类型" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="rounded border px-2 py-1 text-[12px]"><option value="">全部类型</option><option value="leave">请假</option><option value="punch_correction">补卡</option><option value="shift_swap">换班</option></select>
        <input aria-label="提交日期" type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="rounded border px-2 py-1 text-[12px]" />
        <input aria-label="员工筛选" value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)} placeholder="员工姓名" className="rounded border px-2 py-1 text-[12px]" />
      </div>
      <div className="p-3 space-y-2">
        {visible.map((item) => <div key={key(item)} data-testid="approval-result-row" className="border rounded p-3 flex items-start gap-3">
          <input type="checkbox" aria-label={`选择 ${item.id}`} checked={selected.includes(key(item))} disabled={readOnly || item.status !== "pending"} onChange={() => toggle(item)} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">{item.employeeName} · {item.summary}</div>
            <div className="text-[11px] text-[var(--text-muted)]">{new Date(item.submittedAt).toLocaleString("zh-CN")} · {APPROVAL_TYPE_LABELS[item.type]} · {APPROVAL_STATUS_LABELS[item.status]}</div>
            {item.aiReason && <div className="mt-2 text-[12px] text-amber-700">AI 建议：{item.aiSuggestion === "compliant" ? "合规" : "存疑"} · <span>{item.aiReason}</span></div>}
            {item.decisionReason && <div className="mt-1 text-[12px] text-gray-500">决定理由：{item.decisionReason}</div>}
          </div>
          <Btn variant="default" size="sm" onClick={() => setDetail(item)}>查看详情</Btn>
          {item.status === "pending" ? !readOnly && <Btn variant="ghost" size="sm" disabled={busy} onClick={() => void ai(item)}>AI 合规建议</Btn> : <Tag color={item.status === "approved" ? "green" : "red"}>{APPROVAL_STATUS_LABELS[item.status]}</Tag>}
        </div>)}
        {!visible.length && <p data-testid="approval-empty-state" className="py-6 text-center text-[12px] text-[var(--text-muted)]">暂无记录</p>}
      </div>
    </Panel>
    <Dialog
      open={dialog}
      title="填写驳回原因"
      onClose={() => setDialog(false)}
      footer={<><Btn onClick={() => setDialog(false)}>取消</Btn><Btn variant="danger" disabled={!reason.trim() || busy} onClick={() => void decide("rejected")}>确认驳回</Btn></>}
    >
      <textarea aria-label="驳回原因" value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-24 w-full rounded border p-2 text-[13px]" />
    </Dialog>
    <Dialog
      open={detail !== null}
      title="单据详情"
      onClose={() => setDetail(null)}
      footer={<Btn onClick={() => setDetail(null)}>返回</Btn>}
    >
      {detail && <><p className="text-[13px]">{detail.employeeName} · {detail.summary}</p><p className="mt-1 text-[12px] text-gray-500">类型：{APPROVAL_TYPE_LABELS[detail.type]} · 状态：{APPROVAL_STATUS_LABELS[detail.status]}</p></>}
    </Dialog>
  </div>;
}
