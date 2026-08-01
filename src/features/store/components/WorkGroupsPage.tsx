"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ActionToolbar, Dialog, Drawer, EnterpriseTable, StatusTag, type EnterpriseColumn } from "@/components/enterprise";
import { api } from "@/lib/client";
import type { WorkGroupInput, WorkGroupMemberInput } from "@/lib/contracts/workforce";

type Option = { id: string; name: string };
type EmployeeOption = Option & { employeeNo: string | null };
type AreaOption = Option & { active: boolean };

export type WorkGroupRow = {
  id: string;
  name: string;
  leaderId: string;
  leader: Option;
  volumeType: "traffic" | "delivery" | string;
  active: boolean;
  members: Array<{
    id: string;
    user: EmployeeOption;
    workArea: Option;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
};

export type WorkGroupsPageProps = {
  storeId: string;
  readOnly: boolean;
  onRefresh?: () => Promise<void>;
  initialGroups: WorkGroupRow[];
  managers: Option[];
  employees: EmployeeOption[];
  areas: AreaOption[];
  onSave?: (input: WorkGroupInput) => Promise<void>;
  onAddMember?: (input: WorkGroupMemberInput) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onDeleteMember?: (id: string) => Promise<void>;
};

export default function WorkGroupsPage({ storeId, readOnly, onRefresh, initialGroups, managers, employees, areas, onSave, onAddMember, onDelete, onDeleteMember }: WorkGroupsPageProps) {
  const router = useRouter();
  const [groupDraft, setGroupDraft] = useState<WorkGroupInput | null>(null);
  const [memberGroupId, setMemberGroupId] = useState<string | null>(null);
  const [viewingGroup, setViewingGroup] = useState<WorkGroupRow | null>(null);
  const [memberDraft, setMemberDraft] = useState({ userId: employees[0]?.id ?? "", workAreaId: areas.find((area) => area.active)?.id ?? "", effectiveFrom: "", effectiveTo: "" });
  const [message, setMessage] = useState("");

  async function refreshSnapshot() {
    if (onRefresh) await onRefresh();
    else router.refresh();
  }

  async function saveGroup(input: WorkGroupInput) {
    if (onSave) await onSave(input);
    else await api("/api/store/work-groups", { method: input.id ? "PUT" : "POST", body: { ...input, storeId } });
    await refreshSnapshot();
    setGroupDraft(null);
    setMessage("工作组已保存");
  }

  async function saveMember() {
    if (!memberGroupId) return;
    const input: WorkGroupMemberInput = { workGroupId: memberGroupId, userId: memberDraft.userId, workAreaId: memberDraft.workAreaId, effectiveFrom: memberDraft.effectiveFrom, effectiveTo: memberDraft.effectiveTo || null };
    if (onAddMember) await onAddMember(input);
    else await api("/api/store/work-groups/members", { method: "POST", body: { ...input, storeId } });
    await refreshSnapshot();
    setMemberGroupId(null);
    setMessage("成员有效期已保存");
  }

  async function toggleGroup(group: WorkGroupRow) {
    await saveGroup({ id: group.id, name: group.name, leaderId: group.leaderId, volumeType: group.volumeType as "traffic" | "delivery", active: !group.active });
  }

  async function removeGroup(id: string) {
    if (onDelete) await onDelete(id);
    else await api("/api/store/work-groups", { method: "DELETE", body: { id, storeId } });
    await refreshSnapshot();
    setMessage("工作组已删除");
  }

  async function removeMember(id: string) {
    if (onDeleteMember) await onDeleteMember(id);
    else await api("/api/store/work-groups/members", { method: "DELETE", body: { id, storeId } });
    await refreshSnapshot();
    setViewingGroup(null);
    setMessage("成员有效期已删除");
  }

  const columns: EnterpriseColumn<WorkGroupRow>[] = [
    { key: "name", title: "工作组" },
    { key: "leader", title: "组长", render: (row) => row.leader.name },
    { key: "volumeType", title: "业务量", render: (row) => row.volumeType === "traffic" ? "客流" : "交付" },
    { key: "members", title: "成员", render: (row) => <button aria-label="查看成员有效期" type="button" className="text-[var(--primary)]" onClick={() => setViewingGroup(row)}>查看（{row.members.length}）</button> },
    { key: "active", title: "状态", render: (row) => <StatusTag tone={row.active ? "success" : "neutral"}>{row.active ? "启用" : "停用"}</StatusTag> },
    { key: "actions", title: "操作", render: (row) => readOnly ? "只读" : <div className="flex gap-2"><button aria-label="编辑工作组" type="button" className="text-[var(--primary)]" onClick={() => setGroupDraft({ id: row.id, name: row.name, leaderId: row.leaderId, volumeType: row.volumeType as "traffic" | "delivery", active: row.active })}>编辑</button><button aria-label={row.active ? "停用工作组" : "启用工作组"} type="button" className="text-[var(--primary)]" onClick={() => toggleGroup(row)}>{row.active ? "停用" : "启用"}</button><button aria-label="删除工作组" type="button" className="text-[var(--danger)]" onClick={() => removeGroup(row.id)}>删除</button><button type="button" className="text-[var(--primary)]" onClick={() => setMemberGroupId(row.id)}>添加成员</button></div> },
  ];

  return <div className="space-y-3">
    <div><h1 className="text-[18px] font-semibold">工作组</h1><p className="mt-1 text-[12px] text-[var(--text-muted)]">组长限本店经理，成员限本店员工</p></div>
    <ActionToolbar end={message && <span className="text-[12px] text-emerald-600">{message}</span>}>
      {!readOnly && <button type="button" className="enterprise-primary-button" onClick={() => setGroupDraft({ name: "", leaderId: managers[0]?.id ?? "", volumeType: "traffic", active: true })}>新增工作组</button>}
      <span className="text-[12px] text-[var(--text-muted)]">有效期按本地 YYYY-MM-DD 闭区间计算</span>
    </ActionToolbar>
    <EnterpriseTable columns={columns} rows={initialGroups} getRowKey={(row) => row.id} />

    <Dialog open={groupDraft !== null} title={groupDraft?.id ? "编辑工作组" : "新增工作组"} onClose={() => setGroupDraft(null)} footer={<button type="button" className="enterprise-primary-button" onClick={() => groupDraft && saveGroup(groupDraft)}>保存工作组</button>}>
      {groupDraft && <div className="grid grid-cols-2 gap-3 text-[12px]">
        <label>工作组名称<input aria-label="工作组名称" className="enterprise-control mt-1 w-full border px-2" value={groupDraft.name} onChange={(event) => setGroupDraft({ ...groupDraft, name: event.target.value })} /></label>
        <label>组长<select aria-label="组长" className="enterprise-control mt-1 w-full border px-2" value={groupDraft.leaderId} onChange={(event) => setGroupDraft({ ...groupDraft, leaderId: event.target.value })}>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label>
        <label>业务量类型<select aria-label="业务量类型" className="enterprise-control mt-1 w-full border px-2" value={groupDraft.volumeType} onChange={(event) => setGroupDraft({ ...groupDraft, volumeType: event.target.value as "traffic" | "delivery" })}><option value="traffic">客流</option><option value="delivery">交付</option></select></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={groupDraft.active} onChange={(event) => setGroupDraft({ ...groupDraft, active: event.target.checked })} />启用工作组</label>
      </div>}
    </Dialog>

    <Dialog open={memberGroupId !== null} title="设置成员有效期" onClose={() => setMemberGroupId(null)} footer={<button type="button" className="enterprise-primary-button" onClick={saveMember}>保存成员</button>}>
      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <label>员工<select aria-label="员工" className="enterprise-control mt-1 w-full border px-2" value={memberDraft.userId} onChange={(event) => setMemberDraft({ ...memberDraft, userId: event.target.value })}>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNo} · {employee.name}</option>)}</select></label>
        <label>工作区域<select aria-label="工作区域" className="enterprise-control mt-1 w-full border px-2" value={memberDraft.workAreaId} onChange={(event) => setMemberDraft({ ...memberDraft, workAreaId: event.target.value })}>{areas.filter((area) => area.active).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
        <label>生效日期<input aria-label="生效日期" type="date" className="enterprise-control mt-1 w-full border px-2" value={memberDraft.effectiveFrom} onChange={(event) => setMemberDraft({ ...memberDraft, effectiveFrom: event.target.value })} /></label>
        <label>结束日期<input aria-label="结束日期" type="date" className="enterprise-control mt-1 w-full border px-2" value={memberDraft.effectiveTo} onChange={(event) => setMemberDraft({ ...memberDraft, effectiveTo: event.target.value })} /></label>
      </div>
    </Dialog>
    <Drawer open={viewingGroup !== null} title={`${viewingGroup?.name ?? ""}成员有效期`} onClose={() => setViewingGroup(null)}>
      <ul className="space-y-2 text-[12px]">{viewingGroup?.members.map((member) => <li key={member.id} className="border p-2" style={{ borderColor: "var(--border)" }}><div>{member.user.employeeNo} · {member.user.name}</div><div>{member.workArea.name} · {member.effectiveFrom} 至 {member.effectiveTo ?? "长期"}</div>{!readOnly && <button aria-label="删除成员有效期" type="button" className="mt-2 text-[var(--danger)]" onClick={() => removeMember(member.id)}>删除记录</button>}</li>)}</ul>
    </Drawer>
  </div>;
}
