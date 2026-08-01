"use client";

import { useEffect, useState, useCallback } from "react";
import { api, SHIFT_LABELS, POSITION_LABELS, WEEKDAYS } from "@/lib/client";
import { PageHeader, Panel, FilterBar, inputCls } from "@/components/ui";

type Config = {
  id: string;
  dayOfWeek: number;
  timeSlot: string;
  position: string;
  minHeadcount: number;
};
type Store = { id: string; name: string };

const SHIFTS = ["morning", "afternoon", "evening"];
const POSITIONS = ["cashier", "sales"];

export default function MinStaffingConfigPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState("");
  const [configs, setConfigs] = useState<Config[]>([]);
  const [msg, setMsg] = useState("");

  const load = useCallback(async (sid?: string) => {
    const q = sid ? `?storeId=${sid}` : "";
    const data = await api<{ storeId: string; stores: Store[]; configs: Config[] }>(`/api/demand${q}`);
    setStores(data.stores);
    setStoreId(data.storeId);
    setConfigs(data.configs);
  }, []);

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, [load]);

  function get(dow: number, slot: string, pos: string): number {
    return (
      configs.find((c) => c.dayOfWeek === dow && c.timeSlot === slot && c.position === pos)
        ?.minHeadcount ?? 0
    );
  }

  async function update(dow: number, slot: string, pos: string, val: number) {
    const next = Math.max(0, val);
    setConfigs((cs) => {
      const idx = cs.findIndex(
        (c) => c.dayOfWeek === dow && c.timeSlot === slot && c.position === pos
      );
      if (idx >= 0) {
        const copy = [...cs];
        copy[idx] = { ...copy[idx], minHeadcount: next };
        return copy;
      }
      return [
        ...cs,
        { id: `${dow}_${slot}_${pos}`, dayOfWeek: dow, timeSlot: slot, position: pos, minHeadcount: next },
      ];
    });
    try {
      await api("/api/demand", {
        method: "POST",
        body: { storeId, dayOfWeek: dow, timeSlot: slot, position: pos, minHeadcount: next },
      });
      setMsg("已保存");
    } catch (e: any) {
      setMsg("保存失败：" + e.message);
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader
        crumbs={["系统管理", "门店管理", "最低人力配置"]}
        title="最低人力配置"
      />

      <FilterBar
        right={
          <span className="text-[11px] text-gray-400">
            各班次分岗位最低人数，作为排班引擎人数需求下界（Sprint 2 起由客流预测折算）
          </span>
        }
      >
        <select value={storeId} onChange={(e) => load(e.target.value)} className={inputCls}>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </FilterBar>

      <Panel title="星期 + 时段 + 岗位 → 最低人数">
        <div className="p-4 overflow-x-auto thin-scroll">
          <table className="ent-table" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th rowSpan={2} style={{ width: 90 }}>
                  星期
                </th>
                {SHIFTS.map((s) => (
                  <th key={s} className="text-center" colSpan={POSITIONS.length}>
                    {SHIFT_LABELS[s]}
                  </th>
                ))}
              </tr>
              <tr>
                {SHIFTS.map((s) =>
                  POSITIONS.map((p) => (
                    <th key={`${s}_${p}`} className="text-center text-[11px] font-normal text-gray-500">
                      {POSITION_LABELS[p]}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
                <tr key={dow}>
                  <td>{WEEKDAYS[dow]}</td>
                  {SHIFTS.map((s) =>
                    POSITIONS.map((p) => (
                      <td key={`${s}_${p}`} className="text-center">
                        <input
                          type="number"
                          min={0}
                          value={get(dow, s, p)}
                          onChange={(e) => update(dow, s, p, Number(e.target.value))}
                          className="w-14 border rounded px-2 py-1 text-center text-[12px] outline-none focus:border-[var(--primary)]"
                        />
                      </td>
                    ))
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {msg && <p className="mt-2 text-[11px] text-emerald-600">{msg}</p>}
        </div>
      </Panel>
    </div>
  );
}
