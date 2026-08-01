"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  ActionToolbar,
  Dialog,
  Drawer,
  EnterpriseTable,
  QueryBar,
  StatusTag,
  type EnterpriseColumn,
} from "@/components/enterprise";
import { api } from "@/lib/client";
import type { WorkAreaInput } from "@/lib/contracts/workforce";

export type WorkAreaRow = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  members: Array<{
    id: string;
    user: { id: string; name: string };
    workGroup: { id: string; name: string };
    effectiveFrom?: string | Date;
    effectiveTo?: string | Date | null;
  }>;
};

export type WorkAreasPageProps = {
  storeId: string;
  readOnly: boolean;
  onRefresh?: () => Promise<void>;
  initialAreas: WorkAreaRow[];
  onSave?: (input: WorkAreaInput) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
};

const emptyDraft = { name: "", code: "", active: true };

export default function WorkAreasPage({
  storeId,
  readOnly,
  onRefresh,
  initialAreas,
  onSave,
  onDelete,
}: WorkAreasPageProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<WorkAreaInput | null>(null);
  const [selected, setSelected] = useState<WorkAreaRow | null>(null);
  const [message, setMessage] = useState("");
  const rows = useMemo(
    () => initialAreas.filter((area) => `${area.name}${area.code}`.toLowerCase().includes(query.trim().toLowerCase())),
    [initialAreas, query]
  );

  async function refreshSnapshot() {
    if (onRefresh) await onRefresh();
    else router.refresh();
  }

  async function save(input: WorkAreaInput) {
    if (onSave) await onSave(input);
    else await api("/api/store/work-areas", {
      method: input.id ? "PUT" : "POST",
      body: { ...input, storeId },
    });
    await refreshSnapshot();
    setDraft(null);
    setMessage("工作区域已保存");
  }

  async function toggle(area: WorkAreaRow) {
    await save({ id: area.id, name: area.name, code: area.code, active: !area.active });
  }

  async function remove(id: string) {
    if (onDelete) await onDelete(id);
    else await api("/api/store/work-areas", { method: "DELETE", body: { id, storeId } });
    await refreshSnapshot();
    setMessage("工作区域已删除");
  }

  const columns: EnterpriseColumn<WorkAreaRow>[] = [
    { key: "name", title: "区域名称" },
    { key: "code", title: "区域编码" },
    { key: "active", title: "状态", render: (row) => <StatusTag tone={row.active ? "success" : "neutral"}>{row.active ? "启用" : "停用"}</StatusTag> },
    { key: "members", title: "关联成员", render: (row) => <button type="button" className="text-[var(--primary)]" onClick={() => setSelected(row)}>查看成员（{row.members.length}）</button> },
    {
      key: "actions",
      title: "操作",
      render: (row) => readOnly ? "只读" : (
        <div className="flex gap-2">
          <button aria-label="编辑区域" type="button" className="text-[var(--primary)]" onClick={() => setDraft({ id: row.id, name: row.name, code: row.code, active: row.active })}>编辑</button>
          <button aria-label={row.active ? "停用区域" : "启用区域"} type="button" className="text-[var(--primary)]" onClick={() => toggle(row)}>{row.active ? "停用" : "启用"}</button>
          <button aria-label="删除区域" type="button" className="text-[var(--danger)]" onClick={() => remove(row.id)}>删除</button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div><h1 className="text-[18px] font-semibold">工作区域</h1><p className="mt-1 text-[12px] text-[var(--text-muted)]">维护门店内可分配给员工的工作区域</p></div>
      <QueryBar><label className="text-[12px]">关键词<input aria-label="区域关键词" className="enterprise-control ml-2 border px-2" value={query} onChange={(event) => setQuery(event.target.value)} /></label></QueryBar>
      <ActionToolbar end={message && <span className="text-[12px] text-emerald-600">{message}</span>}>
        {!readOnly && <button type="button" className="enterprise-primary-button" onClick={() => setDraft(emptyDraft)}>新增区域</button>}
        <span className="text-[12px] text-[var(--text-muted)]">共 {rows.length} 个区域</span>
      </ActionToolbar>
      <EnterpriseTable columns={columns} rows={rows} getRowKey={(row) => row.id} />

      <Dialog open={draft !== null} title={draft?.id ? "编辑工作区域" : "新增工作区域"} onClose={() => setDraft(null)} footer={<button type="button" className="enterprise-primary-button" onClick={() => draft && save(draft)}>保存区域</button>}>
        {draft && <div className="grid grid-cols-2 gap-3 text-[12px]">
          <label>区域名称<input aria-label="区域名称" className="enterprise-control mt-1 w-full border px-2" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>区域编码<input aria-label="区域编码" className="enterprise-control mt-1 w-full border px-2" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} /></label>
          <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />启用区域</label>
        </div>}
      </Dialog>

      <Drawer open={selected !== null} title={`${selected?.name ?? ""}关联成员`} onClose={() => setSelected(null)}>
        <ul className="space-y-2 text-[12px]">{selected?.members.map((member) => <li key={member.id} className="border p-2" style={{ borderColor: "var(--border)" }}>{member.user.name} · {member.workGroup.name}</li>)}</ul>
      </Drawer>
    </div>
  );
}
