"use client";

import { useCallback, useEffect, useState } from "react";

import { Btn, Panel, inputCls } from "@/components/ui";
import { api, POSITION_LABELS, SHIFT_LABELS, WEEKDAYS } from "@/lib/client";
import type { SchedulePlanDetail, WorkMode } from "@/lib/contracts/scheduling";

type PrepareData = SchedulePlanDetail & {
  plan: Pick<SchedulePlanDetail, "id" | "storeId" | "weekOf" | "mode" | "status" | "version" | "publishedAt">;
  store: { id: string; name: string };
  shifts: Array<{ key: string; label: string; start: number; end: number }>;
};

export default function PrepareStep({
  planId,
  readOnly,
  onNext,
}: {
  planId: string;
  readOnly: boolean;
  onNext: () => void;
}) {
  const [data, setData] = useState<PrepareData | null>(null);
  const [form, setForm] = useState({ userId: "", date: "", timeSlot: "morning", reason: "" });
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const next = await api<PrepareData>(`/api/schedule/plan?id=${encodeURIComponent(planId)}`);
    setData(next);
    setForm((current) => ({
      ...current,
      userId: current.userId || next.employees[0]?.id || "",
      date: current.date || next.days[0],
    }));
  }, [planId]);

  useEffect(() => {
    load().catch((error: Error) => setMessage(error.message));
  }, [load]);

  async function saveMode(mode: WorkMode) {
    if (!data) return;
    setPending(true);
    try {
      await api("/api/schedule/plan", {
        method: "POST",
        body: { id: planId, mode, version: data.plan.version },
      });
      await load();
      setMessage("排班模式已保存，旧推荐已失效");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setPending(false);
    }
  }

  async function addUnavailable() {
    if (!data) return;
    setPending(true);
    try {
      await api("/api/schedule/unavailable", {
        method: "POST",
        body: { ...form, planId, version: data.plan.version },
      });
      setForm((current) => ({ ...current, reason: "" }));
      await load();
      setMessage("不可供班已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setPending(false);
    }
  }

  async function removeUnavailable(id: string) {
    if (!data) return;
    setPending(true);
    try {
      await api(
        `/api/schedule/unavailable?id=${encodeURIComponent(id)}&planId=${encodeURIComponent(planId)}&version=${data.plan.version}`,
        { method: "DELETE" },
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    } finally {
      setPending(false);
    }
  }

  if (!data) return <Panel><div className="p-4 text-[12px] text-[var(--text-muted)]">加载排班准备… {message}</div></Panel>;

  return (
    <div className="space-y-3">
      {message && <div className="text-[12px] text-[var(--primary)]">{message}</div>}
      <Panel title="计划与工作制">
        <div className="p-4 grid grid-cols-4 gap-6 text-[12px]">
          <div><span className="text-[var(--text-muted)]">门店</span><div className="mt-1 text-gray-700">{data.store?.name ?? data.storeId}</div></div>
          <div><span className="text-[var(--text-muted)]">计划周</span><div className="mt-1 text-gray-700">{data.days[0]} ~ {data.days[6]}</div></div>
          <label className="col-span-2"><span className="text-[var(--text-muted)]">工作制</span><select aria-label="工作制" className={`${inputCls} mt-1 w-full`} disabled={readOnly || pending} value={data.plan.mode} onChange={(event) => saveMode(event.target.value as WorkMode)}><option value="work5rest2">做五休二（每周最多 5 个工作日）</option><option value="work6rest1">做六休一（每周最多 6 个工作日）</option></select></label>
        </div>
      </Panel>

      <Panel title="营业日与固定班次">
        <div className="p-4 overflow-x-auto">
          <table className="ent-table">
            <thead><tr><th>日期</th><th>营业状态</th><th>营业时间</th><th>固定班次</th></tr></thead>
            <tbody>{data.days.map((date) => {
              const day = data.operatingDays.find((row) => row.dayOfWeek === new Date(`${date}T00:00:00`).getDay());
              return <tr key={date}><td>{date} {WEEKDAYS[new Date(`${date}T00:00:00`).getDay()]}</td><td>{day?.isOpen ? "营业" : "闭店"}</td><td>{day?.isOpen ? `${day.openTime}–${day.closeTime}` : "—"}</td><td>09:00–13:00 / 13:00–17:00 / 17:00–21:00</td></tr>;
            })}</tbody>
          </table>
        </div>
      </Panel>

      <Panel title="不可供班与已批准请假">
        <div className="p-4 space-y-3">
          {!readOnly && (
            <div className="flex items-center gap-2">
              <select aria-label="员工" className={inputCls} value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })}>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}（{POSITION_LABELS[employee.position]}）</option>)}</select>
              <select aria-label="日期" className={inputCls} value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })}>{data.days.map((date) => <option key={date}>{date}</option>)}</select>
              <select aria-label="班次" className={inputCls} value={form.timeSlot} onChange={(event) => setForm({ ...form, timeSlot: event.target.value })}>{data.shifts.map((shift) => <option key={shift.key} value={shift.key}>{SHIFT_LABELS[shift.key]}</option>)}</select>
              <input aria-label="不可供班原因" className={inputCls} placeholder="原因（选填）" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
              <Btn variant="primary" size="sm" disabled={pending || !form.userId} onClick={addUnavailable}>添加</Btn>
            </div>
          )}
          <table className="ent-table"><thead><tr><th>员工</th><th>日期</th><th>班次</th><th>来源</th><th>原因</th><th>操作</th></tr></thead><tbody>{data.unavailable.length === 0 ? <tr><td colSpan={6} className="py-6 text-center text-gray-400">无不可供班记录</td></tr> : data.unavailable.map((slot) => <tr key={slot.id}><td>{data.employees.find((employee) => employee.id === slot.userId)?.name ?? slot.userId}</td><td>{slot.date}</td><td>{SHIFT_LABELS[slot.timeSlot]}</td><td>{slot.source === "approved_leave" ? "已批准请假" : "不可供班"}</td><td>{slot.reason || "—"}</td><td>{!readOnly && slot.source === "unavailable" ? <Btn size="sm" disabled={pending} onClick={() => removeUnavailable(slot.id)}>删除</Btn> : "—"}</td></tr>)}</tbody></table>
        </div>
      </Panel>
      <div className="flex justify-end"><Btn variant="primary" onClick={onNext}>下一步：业务预测 →</Btn></div>
    </div>
  );
}
