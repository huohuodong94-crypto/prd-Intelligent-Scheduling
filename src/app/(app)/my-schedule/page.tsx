"use client";

import { useCallback, useEffect, useState } from "react";

import { PageHeader, Panel } from "@/components/ui";
import MySchedulePage from "@/features/scheduling/components/MySchedulePage";
import { api } from "@/lib/client";
import { currentMonday } from "@/lib/dates";

type MineResponse = {
  weekOf: string;
  rows: Array<{ date: string; shiftType: string; hours: number }>;
  totalHours: number;
};

export default function Page() {
  const [weekOf, setWeekOf] = useState(currentMonday());
  const [data, setData] = useState<MineResponse>({ weekOf, rows: [], totalHours: 0 });
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await api<MineResponse>(`/api/schedule/mine?weekOf=${encodeURIComponent(weekOf)}`));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取班表失败");
    }
  }, [weekOf]);
  useEffect(() => { void load(); }, [load]);
  return <><PageHeader crumbs={["排班管理"]} title="我的班表" /><Panel>{message ? <div className="p-4 text-[12px] text-rose-600">{message}</div> : <div className="p-4"><MySchedulePage weekOf={weekOf} rows={data.rows} totalHours={data.totalHours} onWeekChange={setWeekOf} /></div>}</Panel></>;
}
