"use client";

import { useState } from "react";
import { ActionToolbar, EnterpriseTable, QueryBar } from "@/components/enterprise";
import type { EnterpriseColumn } from "@/components/enterprise";
import { api } from "@/lib/client";
import { POSITION_LABELS, SHIFT_LABELS } from "@/lib/config";
import type { StaffingRow, StoreOption } from "@/lib/contracts/store";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export type StaffingPageProps = {
  sessionStoreId: string | null;
  readOnly: boolean;
  storeOptions?: StoreOption[];
  initialRows?: StaffingRow[];
  initialStoreId?: string;
  onSave?: (rows: StaffingRow[]) => Promise<void>;
};

function navigateToStore(storeId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("storeId", storeId);
  window.location.assign(url.toString());
}

export default function StaffingPage({
  sessionStoreId,
  readOnly,
  storeOptions = [],
  initialRows = [],
  initialStoreId,
  onSave,
}: StaffingPageProps) {
  const selectedStoreId = initialStoreId ?? sessionStoreId ?? storeOptions[0]?.id ?? "";
  const [rows, setRows] = useState(initialRows);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");

  function rowKey(row: StaffingRow) {
    return `${row.dayOfWeek}:${row.timeSlot}:${row.position}`;
  }

  function update(target: StaffingRow, minHeadcount: number) {
    const key = rowKey(target);
    setRows((current) => current.map((row) => rowKey(row) === key ? { ...row, minHeadcount } : row));
    setDirtyKeys((current) => new Set(current).add(key));
  }

  async function save() {
    if (onSave) await onSave(rows);
    else await api("/api/demand", { method: "PUT", body: { storeId: selectedStoreId, rows } });
    setDirtyKeys(new Set());
    setMessage("最低人力已批量保存");
  }

  const columns: EnterpriseColumn<StaffingRow>[] = [
    { key: "dayOfWeek", title: "星期", render: (row) => WEEKDAYS[row.dayOfWeek] },
    { key: "timeSlot", title: "班次", render: (row) => SHIFT_LABELS[row.timeSlot] },
    { key: "position", title: "岗位", render: (row) => POSITION_LABELS[row.position] },
    {
      key: "minHeadcount",
      title: "最低人数",
      render: (row) => readOnly ? row.minHeadcount : (
        <input aria-label={`${WEEKDAYS[row.dayOfWeek]} ${SHIFT_LABELS[row.timeSlot].split(" ")[0]} ${POSITION_LABELS[row.position]} 最低人数`} className="enterprise-control w-24 border px-2" type="number" min={0} step={1} disabled={readOnly} value={row.minHeadcount} onChange={(event) => update(row, Number(event.target.value))} />
      ),
    },
    { key: "status", title: "状态", render: (row) => dirtyKeys.has(rowKey(row)) ? "待保存" : "已同步" },
  ];

  return (
    <div className="space-y-3">
      <div><h1 className="text-[18px] font-semibold">最低人力</h1><p className="mt-1 text-[12px] text-[var(--text-muted)]">按星期、固定班次和岗位维护 42 个配置项</p></div>
      <QueryBar>
        <label className="flex items-center gap-2 text-[12px]">门店<select aria-label="门店" className="enterprise-control border px-2" value={selectedStoreId} onChange={(event) => navigateToStore(event.target.value)}>{storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}（{option.code}）</option>)}</select></label>
      </QueryBar>
      <ActionToolbar end={message && <span className="text-[12px] text-emerald-600">{message}</span>}>
        {!readOnly && <button className="enterprise-primary-button" type="button" onClick={save}>批量保存</button>}
        <span className="text-[12px] text-[var(--text-muted)]">{dirtyKeys.size} 行待保存</span>
      </ActionToolbar>
      <EnterpriseTable columns={columns} rows={rows} getRowKey={(row) => rowKey(row)} />
    </div>
  );
}
