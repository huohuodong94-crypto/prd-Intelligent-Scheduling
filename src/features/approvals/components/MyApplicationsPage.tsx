"use client";

import { useState } from "react";
import { Btn, Panel, Tag, inputCls } from "@/components/ui";

type Row = { id: string; status: string; summary?: string; requesterName?: string; targetUserId?: string; currentUserId?: string; reason?: string | null };
type Props = {
  leaveRows: Row[];
  correctionRows: Row[];
  swapRows: Row[];
  onCreateLeave?: (input: Record<string, unknown>) => Promise<void>;
  onCreateCorrection?: (input: Record<string, unknown>) => Promise<void>;
  onCreateSwap?: (input: Record<string, unknown>) => Promise<void>;
  onAcceptTarget?: (id: string) => Promise<void>;
};

const tabs = [{ key: "leave", label: "请假" }, { key: "correction", label: "补卡" }, { key: "swap", label: "换班" }] as const;

export default function MyApplicationsPage(props: Props) {
  const [tab, setTab] = useState<(typeof tabs)[number]["key"]>("leave");
  const [message, setMessage] = useState("");
  const rows = tab === "leave" ? props.leaveRows : tab === "correction" ? props.correctionRows : props.swapRows;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      if (tab === "leave") await props.onCreateLeave?.({ type: data.type, startTime: `${data.startDate}T00:00:00+08:00`, endTime: `${data.endDate || data.startDate}T23:59:00+08:00`, isFullDay: true, reason: data.reason });
      if (tab === "correction") await props.onCreateCorrection?.({ date: data.date, direction: data.direction, requestedTime: `${data.date}T${data.time}:00+08:00`, reason: data.reason });
      if (tab === "swap") await props.onCreateSwap?.({ reqScheduleId: data.reqScheduleId, targetUserId: data.targetUserId, tgtScheduleId: data.tgtScheduleId });
      setMessage("提交成功，已进入审批流程"); form.reset();
    } catch (error) { setMessage(error instanceof Error ? error.message : "提交失败"); }
  }
  return <div className="space-y-3">
    <div role="tablist" className="flex gap-2 border-b bg-white p-3">
      {tabs.map((entry) => <button role="tab" aria-selected={tab === entry.key} key={entry.key} onClick={() => setTab(entry.key)} className="px-4 py-1.5 text-[13px]">{entry.label}</button>)}
    </div>
    <Panel title={`发起${tabs.find((entry) => entry.key === tab)?.label}申请`}>
      <form onSubmit={submit} className="grid grid-cols-4 gap-3 p-4 text-[12px]">
        {tab === "leave" && <><select name="type" className={inputCls}><option value="annual">年假</option><option value="sick">病假</option></select><input aria-label="开始日期" name="startDate" type="date" required className={inputCls}/><input aria-label="结束日期" name="endDate" type="date" className={inputCls}/><input aria-label="请假事由" name="reason" placeholder="事由" className={inputCls}/></>}
        {tab === "correction" && <><input aria-label="补卡日期" name="date" type="date" required className={inputCls}/><select name="direction" className={inputCls}><option value="in">上班</option><option value="out">下班</option></select><input aria-label="补卡时间" name="time" type="time" required className={inputCls}/><input aria-label="补卡原因" name="reason" required placeholder="原因" className={inputCls}/></>}
        {tab === "swap" && <><input aria-label="本人班次ID" name="reqScheduleId" required placeholder="本人班次 ID" className={inputCls}/><input aria-label="目标员工ID" name="targetUserId" required placeholder="目标员工 ID" className={inputCls}/><input aria-label="目标班次ID" name="tgtScheduleId" required placeholder="目标班次 ID" className={inputCls}/></>}
        <div className="col-span-4"><Btn variant="primary">提交申请</Btn></div>
      </form>
      {message && <p className="px-4 pb-3 text-[12px] text-[var(--primary)]">{message}</p>}
    </Panel>
    <Panel title="我的申请记录"><div className="p-3 space-y-2">{rows.map((row) => <div key={row.id} className="flex items-center border-b py-2 text-[12px]"><span className="flex-1">{row.summary ?? row.reason ?? row.id}</span><Tag color={row.status.includes("pending") ? "amber" : row.status === "approved" ? "green" : "red"}>{row.status}</Tag>{tab === "swap" && row.status === "pending_target" && row.targetUserId === row.currentUserId && <Btn size="sm" variant="primary" onClick={() => void props.onAcceptTarget?.(row.id)}>接受换班</Btn>}</div>)}{!rows.length && <p className="py-5 text-center text-gray-400">暂无记录</p>}</div></Panel>
  </div>;
}
