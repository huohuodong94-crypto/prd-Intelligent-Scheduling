"use client";

import { SHIFT_STYLE } from "@/components/ui";

type Row = { date: string; shiftType: string; hours: number };

export default function MySchedulePage({
  weekOf,
  rows,
  totalHours,
  onWeekChange,
}: {
  weekOf: string;
  rows: Row[];
  totalHours: number;
  onWeekChange?: (weekOf: string) => void;
}) {
  return <div className="space-y-3">
    <div className="flex items-center justify-between"><label className="text-[12px]">周一日期 <input className="ml-2 rounded border px-2 py-1" type="date" value={weekOf} onChange={(event) => onWeekChange?.(event.target.value)} /></label><strong className="text-[13px]">本周 {totalHours} 小时</strong></div>
    <div className="grid grid-cols-7 gap-2">{rows.map((row, index) => { const style = SHIFT_STYLE[row.shiftType]; const label = style ? `${style.label} ${style.time.replace("-", "–")}` : row.shiftType; return <div key={`${row.date}-${row.shiftType}-${index}`} className="rounded border p-3" style={style ? { background: style.bg, borderColor: style.border, color: style.text } : undefined}><div className="text-[11px] opacity-75">{row.date}</div><div className="mt-1 text-[12px] font-medium">{label}</div></div>; })}</div>
  </div>;
}
