"use client";

import { useState } from "react";
import { ActionToolbar, EnterpriseTable, QueryBar } from "@/components/enterprise";
import type { EnterpriseColumn } from "@/components/enterprise";
import { api } from "@/lib/client";
import type { StoreOption, V2SRow } from "@/lib/contracts/store";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export type V2SPageProps = {
  sessionStoreId: string | null;
  readOnly: boolean;
  storeOptions?: StoreOption[];
  initialRows?: V2SRow[];
  initialStoreId?: string;
  onSave?: (rows: V2SRow[]) => Promise<void>;
};

function navigateToStore(storeId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("storeId", storeId);
  window.location.assign(url.toString());
}

export default function V2SPage({
  sessionStoreId,
  readOnly,
  storeOptions = [],
  initialRows = [],
  initialStoreId,
  onSave,
}: V2SPageProps) {
  const selectedStoreId = initialStoreId ?? sessionStoreId ?? storeOptions[0]?.id ?? "";
  const [rows, setRows] = useState(initialRows);
  const [dirtyDays, setDirtyDays] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState("");

  function update(dayOfWeek: number, patch: Partial<V2SRow>) {
    setRows((current) =>
      current.map((row) => (row.dayOfWeek === dayOfWeek ? { ...row, ...patch } : row))
    );
    setDirtyDays((current) => new Set(current).add(dayOfWeek));
  }

  async function save() {
    if (onSave) await onSave(rows);
    else await api("/api/store/v2s", { method: "PUT", body: { storeId: selectedStoreId, rows } });
    setDirtyDays(new Set());
    setMessage("V2S 参数已批量保存");
  }

  const columns: EnterpriseColumn<V2SRow>[] = [
    { key: "dayOfWeek", title: "星期", render: (row) => WEEKDAYS[row.dayOfWeek] },
    {
      key: "v2sLower",
      title: "V2S 下限",
      render: (row) => readOnly ? row.v2sLower : (
        <input aria-label={`${WEEKDAYS[row.dayOfWeek]} V2S 下限`} className="enterprise-control w-28 border px-2" type="number" min={0.01} step="0.01" disabled={readOnly} value={row.v2sLower} onChange={(event) => update(row.dayOfWeek, { v2sLower: Number(event.target.value) })} />
      ),
    },
    {
      key: "v2sUpper",
      title: "V2S 上限",
      render: (row) => readOnly ? row.v2sUpper : (
        <input aria-label={`${WEEKDAYS[row.dayOfWeek]} V2S 上限`} className="enterprise-control w-28 border px-2" type="number" min={0.01} step="0.01" disabled={readOnly} value={row.v2sUpper} onChange={(event) => update(row.dayOfWeek, { v2sUpper: Number(event.target.value) })} />
      ),
    },
    { key: "status", title: "状态", render: (row) => dirtyDays.has(row.dayOfWeek) ? "待保存" : "已同步" },
  ];

  return (
    <div className="space-y-3">
      <div><h1 className="text-[18px] font-semibold">V2S 参数</h1><p className="mt-1 text-[12px] text-[var(--text-muted)]">按星期维护客流到人力的折算区间</p></div>
      <QueryBar>
        <label className="flex items-center gap-2 text-[12px]">门店<select aria-label="门店" className="enterprise-control border px-2" value={selectedStoreId} onChange={(event) => navigateToStore(event.target.value)}>{storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}（{option.code}）</option>)}</select></label>
      </QueryBar>
      <ActionToolbar end={message && <span className="text-[12px] text-emerald-600">{message}</span>}>
        {!readOnly && <button className="enterprise-primary-button" type="button" onClick={save}>批量保存</button>}
        <span className="text-[12px] text-[var(--text-muted)]">{dirtyDays.size} 行待保存</span>
      </ActionToolbar>
      <EnterpriseTable columns={columns} rows={rows} getRowKey={(row) => row.dayOfWeek} />
    </div>
  );
}
