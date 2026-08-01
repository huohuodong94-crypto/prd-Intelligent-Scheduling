"use client";

import { useEffect, useState } from "react";

import { Btn, Panel } from "@/components/ui";
import { api, POSITION_LABELS, SHIFT_LABELS, WEEKDAYS } from "@/lib/client";
import type { ForecastResponse, StaffingCell } from "./ForecastStep";

export default function StaffingStep({
  planId,
  onBackToForecast,
  onNext,
}: {
  planId: string;
  onBackToForecast: () => void;
  onNext: () => void;
}) {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    api<ForecastResponse>(`/api/schedule/forecast?planId=${encodeURIComponent(planId)}`)
      .then(setData)
      .catch((error: Error) => setMessage(error.message));
  }, [planId]);
  const cellOf = (date: string, shift: string): StaffingCell | undefined =>
    data?.staffing.find((cell) => cell.date === date && cell.shift === shift);

  return (
    <div className="space-y-3">
      <Panel title="岗位人力需求（只读）">
        <div className="p-4 overflow-x-auto">
          {!data ? (
            <div className="py-8 text-center text-[12px] text-gray-400">{message || "读取客流折算结果…"}</div>
          ) : (
            <table className="ent-table" style={{ minWidth: 980 }}>
              <thead><tr><th>岗位</th>{data.days.flatMap((date) => data.shifts.map((shift) => <th key={`${date}-${shift}`} className="text-center"><span className="block">{WEEKDAYS[new Date(`${date}T00:00:00`).getDay()]} {date.slice(5)}</span><span className="font-normal text-gray-400">{SHIFT_LABELS[shift]}</span></th>))}<th>总工时</th></tr></thead>
              <tbody>{["cashier", "sales"].map((position) => {
                const heads = data.days.flatMap((date) => data.shifts.map((shift) => cellOf(date, shift)?.perPosition[position] ?? 0));
                return <tr key={position}><td>{POSITION_LABELS[position]}</td>{heads.map((count, index) => <td key={index} className="text-center">{count}</td>)}<td>{heads.reduce((sum, count) => sum + count, 0) * 4}h</td></tr>;
              })}</tbody>
            </table>
          )}
          <div className="mt-3 rounded bg-blue-50 px-3 py-2 text-[11px] text-blue-700">本步骤严格只读：岗位需求来自业务预测、V2S 与最低人力配置。需要修正时返回业务预测调整客流，不在这里直接改最低人力。</div>
        </div>
      </Panel>
      <div className="flex justify-between"><Btn onClick={onBackToForecast}>返回业务预测调整</Btn><Btn variant="primary" onClick={onNext}>下一步：自动排班 →</Btn></div>
    </div>
  );
}
