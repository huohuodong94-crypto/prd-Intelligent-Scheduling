"use client";

import { useState } from "react";
import { ActionToolbar, Dialog, EnterpriseTable, QueryBar } from "@/components/enterprise";
import type { EnterpriseColumn } from "@/components/enterprise";
import { api } from "@/lib/client";
import { SHIFT_LABELS } from "@/lib/config";
import type {
  OperatingDayInput,
  StoreBasicInput,
  StoreBasicRecord,
  StoreOption,
} from "@/lib/contracts/store";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export type StoreBasicPageProps = {
  sessionStoreId: string | null;
  readOnly: boolean;
  storeOptions: StoreOption[];
  initialStore: StoreBasicRecord;
  initialDays: OperatingDayInput[];
  onSaveBasic?: (input: StoreBasicInput) => Promise<void>;
  onSaveDays?: (days: OperatingDayInput[]) => Promise<void>;
};

function navigateToStore(storeId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("storeId", storeId);
  window.location.assign(url.toString());
}

export default function StoreBasicPage({
  readOnly,
  storeOptions,
  initialStore,
  initialDays,
  onSaveBasic,
  onSaveDays,
}: StoreBasicPageProps) {
  const [store, setStore] = useState(initialStore);
  const [draft, setDraft] = useState<StoreBasicRecord>(initialStore);
  const [days, setDays] = useState(initialDays);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");

  async function saveBasic() {
    const input: StoreBasicInput = {
      storeId: store.id,
      name: draft.name,
      code: draft.code,
      address: draft.address,
      active: draft.active,
    };
    if (onSaveBasic) await onSaveBasic(input);
    else await api("/api/store/basic", { method: "PUT", body: input });
    setStore(draft);
    setEditing(false);
    setMessage("门店信息已保存");
  }

  async function saveDays() {
    if (onSaveDays) await onSaveDays(days);
    else {
      await api("/api/store/operating-days", {
        method: "PUT",
        body: { storeId: store.id, days },
      });
    }
    setMessage("营业日已保存");
  }

  function updateDay(dayOfWeek: number, patch: Partial<OperatingDayInput>) {
    setDays((current) =>
      current.map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day))
    );
  }

  const columns: EnterpriseColumn<OperatingDayInput>[] = [
    { key: "dayOfWeek", title: "星期", render: (row) => WEEKDAYS[row.dayOfWeek] },
    {
      key: "isOpen",
      title: "营业状态",
      render: (row) => readOnly ? (row.isOpen ? "营业" : "休息") : (
        <input
          aria-label={`${WEEKDAYS[row.dayOfWeek]}营业`}
          type="checkbox"
          checked={row.isOpen}
          onChange={(event) => updateDay(row.dayOfWeek, { isOpen: event.target.checked })}
        />
      ),
    },
    {
      key: "openTime",
      title: "开店时间",
      render: (row) => readOnly ? row.openTime : (
        <input
          aria-label={`${WEEKDAYS[row.dayOfWeek]}开店时间`}
          className="enterprise-control border px-2 text-[12px]"
          type="time"
          value={row.openTime}
          disabled={!row.isOpen}
          onChange={(event) => updateDay(row.dayOfWeek, { openTime: event.target.value })}
        />
      ),
    },
    {
      key: "closeTime",
      title: "闭店时间",
      render: (row) => readOnly ? row.closeTime : (
        <input
          aria-label={`${WEEKDAYS[row.dayOfWeek]}闭店时间`}
          className="enterprise-control border px-2 text-[12px]"
          type="time"
          value={row.closeTime}
          disabled={!row.isOpen}
          onChange={(event) => updateDay(row.dayOfWeek, { closeTime: event.target.value })}
        />
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[18px] font-semibold">门店基础与营业日</h1>
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">维护当前门店资料和每周营业时间</p>
      </div>
      <QueryBar>
        <label className="flex items-center gap-2 text-[12px]">
          门店
          <select
            aria-label="门店"
            className="enterprise-control border px-2 text-[12px]"
            value={store.id}
            onChange={(event) => navigateToStore(event.target.value)}
          >
            {storeOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.name}（{option.code}）</option>
            ))}
          </select>
        </label>
      </QueryBar>
      <ActionToolbar end={message && <span className="text-[12px] text-emerald-600">{message}</span>}>
        {!readOnly && (
          <>
            <button className="enterprise-primary-button" type="button" onClick={() => setEditing(true)}>编辑门店</button>
            <button className="enterprise-primary-button" type="button" onClick={saveDays}>保存营业日</button>
          </>
        )}
        <span className="text-[12px] text-[var(--text-muted)]">
          {store.name} · {store.code} · {store.active ? "启用" : "停用"}
        </span>
      </ActionToolbar>

      <section className="border bg-white p-3" style={{ borderColor: "var(--border)" }}>
        <h2 className="mb-2 text-[13px] font-medium">固定班次（只读）</h2>
        <div className="flex gap-5 text-[12px] text-[var(--text-muted)]">
          {Object.values(SHIFT_LABELS).map((label) => <span key={label}>{label}</span>)}
        </div>
      </section>
      <EnterpriseTable columns={columns} rows={days} getRowKey={(row) => row.dayOfWeek} />

      <Dialog
        open={editing}
        title="编辑门店"
        onClose={() => setEditing(false)}
        footer={
          <button className="enterprise-primary-button" type="button" onClick={saveBasic}>保存门店</button>
        }
      >
        <div className="grid grid-cols-2 gap-3 text-[12px]">
          <label>门店名称<input aria-label="门店名称" className="enterprise-control mt-1 w-full border px-2" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>门店编码<input aria-label="门店编码" className="enterprise-control mt-1 w-full border px-2" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} /></label>
          <label className="col-span-2">地址<input aria-label="地址" className="enterprise-control mt-1 w-full border px-2" value={draft.address ?? ""} onChange={(event) => setDraft({ ...draft, address: event.target.value || null })} /></label>
          <label className="col-span-2 flex items-center gap-2"><input aria-label="启用门店" type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />启用门店</label>
        </div>
      </Dialog>
    </div>
  );
}
