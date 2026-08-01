"use client";

import { useCallback, useEffect, useState } from "react";

import { Btn, Panel, inputCls } from "@/components/ui";
import { api, SHIFT_LABELS, WEEKDAYS } from "@/lib/client";

export type ForecastCell = {
  date: string;
  shift: string;
  predicted: number;
  adjusted: number | null;
  adjustReason: string | null;
  effective: number;
  mean4w: number;
  lastWeek: number;
  eventFactor: number;
};

export type ForecastResponse = {
  planId: string;
  plan: { id: string; version: number };
  weekOf: string;
  days: string[];
  shifts: string[];
  cells: ForecastCell[];
  staffing: StaffingCell[];
};

export type StaffingCell = {
  date: string;
  shift: string;
  visitors: number;
  total: number;
  perPosition: Record<string, number>;
  v2sLower: number;
  v2sUpper: number;
  minTotal: number;
  clampedBy: "min" | "upper" | "none";
};

export default function ForecastStep({
  planId,
  readOnly,
  onPrev,
  onNext,
}: {
  planId: string;
  readOnly: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [editing, setEditing] = useState<ForecastCell | null>(null);
  const [draft, setDraft] = useState({ value: "", reason: "" });
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const load = useCallback(async () => {
    setData(await api<ForecastResponse>(`/api/schedule/forecast?planId=${encodeURIComponent(planId)}`));
  }, [planId]);
  useEffect(() => { load().catch((error: Error) => setMessage(error.message)); }, [load]);

  async function save(adjusted: number | null, reason: string) {
    if (!editing || !data) return;
    setPending(true);
    try {
      await api("/api/schedule/forecast", {
        method: "POST",
        body: {
          planId,
          version: data.plan.version,
          date: editing.date,
          timeSlot: editing.shift,
          adjusted,
          reason,
        },
      });
      setEditing(null);
      await load();
      setMessage(adjusted === null ? "已恢复模型值" : "单格调整已留痕");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setPending(false);
    }
  }

  if (!data) return <Panel><div className="p-4 text-[12px] text-gray-400">加载业务预测… {message}</div></Panel>;
  const cellOf = (date: string, shift: string) => data.cells.find((cell) => cell.date === date && cell.shift === shift);

  return (
    <div className="space-y-3">
      {message && <div className="text-[12px] text-[var(--primary)]">{message}</div>}
      <Panel title="业务预测（客流）">
        <div className="p-4 overflow-x-auto">
          <table className="ent-table" style={{ minWidth: 920 }}><thead><tr><th>班次</th>{data.days.map((date) => <th key={date} className="text-center">{WEEKDAYS[new Date(`${date}T00:00:00`).getDay()]}<span className="ml-1 font-normal text-gray-400">{date.slice(5)}</span></th>)}</tr></thead><tbody>{data.shifts.map((shift) => <tr key={shift}><td>{SHIFT_LABELS[shift]}</td>{data.days.map((date) => { const cell = cellOf(date, shift)!; return <td key={date} className="text-center"><button type="button" disabled={readOnly} className={`w-full rounded py-1 ${cell.adjusted !== null ? "text-amber-600 font-medium" : "text-gray-700"}`} title={`近4周 ${cell.mean4w} / 上周 ${cell.lastWeek} / 活动 ×${cell.eventFactor}`} onClick={() => { setEditing(cell); setDraft({ value: String(cell.effective), reason: "" }); }}>{cell.effective.toFixed(1)}{cell.adjusted !== null ? " ✎" : ""}</button></td>; })}</tr>)}</tbody></table>
          <p className="mt-2 text-[11px] text-gray-400">模型值与人工调整分开留痕；只允许逐格调整，且原因必填。最低人力不在本步骤直接编辑。</p>
        </div>
      </Panel>
      {editing && !readOnly && (
        <Panel title={`调整 ${editing.date} ${SHIFT_LABELS[editing.shift]}`}>
          <div className="p-4 flex items-center gap-2">
            <input aria-label="调整后客流" type="number" min={0} className={inputCls} value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} />
            <input aria-label="调整原因" className={`${inputCls} w-72`} placeholder="调整原因（必填）" value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} />
            <Btn variant="primary" size="sm" disabled={pending || !draft.reason.trim()} onClick={() => save(Number(draft.value), draft.reason.trim())}>保存</Btn>
            {editing.adjusted !== null && <Btn size="sm" disabled={pending} onClick={() => save(null, "撤销人工调整")}>恢复模型值</Btn>}
            <Btn size="sm" onClick={() => setEditing(null)}>取消</Btn>
          </div>
        </Panel>
      )}
      <div className="flex justify-between"><Btn onClick={onPrev}>← 上一步：排班准备</Btn><Btn variant="primary" onClick={onNext}>下一步：人力预测 →</Btn></div>
    </div>
  );
}
