"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ActionToolbar, Dialog, EnterpriseTable, QueryBar, StatusTag, type EnterpriseColumn } from "@/components/enterprise";
import { api } from "@/lib/client";
import { dateOnlyToDate, dateToDateOnly } from "@/lib/contracts/store";
import type { EmployeeInput } from "@/lib/contracts/workforce";

export type EmployeeRow = {
  id: string;
  role?: string;
  phone: string;
  employeeNo: string | null;
  name: string;
  position: "cashier" | "sales" | null;
  employmentType: EmployeeInput["employmentType"];
  maxWeeklyHours: number;
  salesAbility: EmployeeInput["salesAbility"];
  performanceBand: EmployeeInput["performanceBand"];
  hireDate: string;
  memberships: Array<{
    id: string;
    workArea: { id: string; name: string };
    workGroup: { id: string; name: string };
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
};

export type EmployeesPageProps = {
  storeId: string;
  readOnly: boolean;
  onRefresh?: () => Promise<void>;
  initialEmployees: EmployeeRow[];
  onSave?: (input: EmployeeInput) => Promise<void>;
};

function isNewEmployee(hireDate: string): boolean {
  const threshold = new Date();
  threshold.setMonth(threshold.getMonth() - 6);
  return dateOnlyToDate(hireDate) >= threshold;
}

const blankEmployee: EmployeeInput = { phone: "", employeeNo: "", name: "", position: "sales", employmentType: "fulltime", maxWeeklyHours: 40, salesAbility: "mid", performanceBand: "frequently", hireDate: "" };

export default function EmployeesPage({ storeId, readOnly, onRefresh, initialEmployees, onSave }: EmployeesPageProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<EmployeeInput | null>(null);
  const [message, setMessage] = useState("");
  const rows = useMemo(() => initialEmployees.filter((employee) => (employee.role ?? "employee") === "employee").filter((employee) => `${employee.employeeNo ?? ""}${employee.name}${employee.phone}`.toLowerCase().includes(query.trim().toLowerCase())), [initialEmployees, query]);
  const today = dateToDateOnly(new Date());

  async function refreshSnapshot() {
    if (onRefresh) await onRefresh();
    else router.refresh();
  }

  async function save() {
    if (!draft) return;
    if (onSave) await onSave(draft);
    else await api("/api/store/employees", { method: "PUT", body: { ...draft, storeId } });
    await refreshSnapshot();
    setDraft(null);
    setMessage("员工标签已保存");
  }

  const columns: EnterpriseColumn<EmployeeRow>[] = [
    { key: "employeeNo", title: "员工编号" },
    { key: "name", title: "姓名" },
    { key: "position", title: "岗位", render: (row) => row.position === "cashier" ? "收银" : "销售" },
    { key: "employmentType", title: "用工类型", render: (row) => row.employmentType === "parttime" ? "兼职" : "全职" },
    { key: "seniority", title: "资历", render: (row) => <StatusTag tone={isNewEmployee(row.hireDate) ? "warning" : "success"}>{isNewEmployee(row.hireDate) ? "新员工" : "熟练员工"}</StatusTag> },
    { key: "membership", title: "当前区域 / 工作组", render: (row) => {
      const current = row.memberships.find((membership) => membership.effectiveFrom <= today && (!membership.effectiveTo || membership.effectiveTo >= today));
      return current ? `${current.workArea.name} / ${current.workGroup.name}` : "未分配";
    } },
    { key: "actions", title: "操作", render: (row) => readOnly ? "只读" : <button type="button" className="text-[var(--primary)]" onClick={() => setDraft({ id: row.id, phone: row.phone, employeeNo: row.employeeNo ?? "", name: row.name, position: row.position ?? "sales", employmentType: row.employmentType, maxWeeklyHours: row.maxWeeklyHours, salesAbility: row.salesAbility, performanceBand: row.performanceBand, hireDate: row.hireDate })}>编辑标签</button> },
  ];

  return <div className="space-y-3">
    <div><h1 className="text-[18px] font-semibold">员工与标签</h1><p className="mt-1 text-[12px] text-[var(--text-muted)]">仅展示 employee；经理和管理员不参与排班</p></div>
    <QueryBar><label className="text-[12px]">员工<input aria-label="员工关键词" className="enterprise-control ml-2 border px-2" value={query} onChange={(event) => setQuery(event.target.value)} /></label></QueryBar>
    <ActionToolbar end={message && <span className="text-[12px] text-emerald-600">{message}</span>}>
      {!readOnly && <button type="button" className="enterprise-primary-button" onClick={() => setDraft(blankEmployee)}>新增员工</button>}
      <span className="text-[12px] text-[var(--text-muted)]">共 {rows.length} 名可排班员工</span>
    </ActionToolbar>
    <EnterpriseTable columns={columns} rows={rows} getRowKey={(row) => row.id} />
    <Dialog open={draft !== null} title={draft?.id ? "编辑员工标签" : "新增员工"} onClose={() => setDraft(null)} footer={<button type="button" className="enterprise-primary-button" onClick={save}>保存员工</button>}>
      {draft && <div className="grid grid-cols-3 gap-3 text-[12px]">
        <label>员工编号<input aria-label="员工编号" className="enterprise-control mt-1 w-full border px-2" value={draft.employeeNo} onChange={(event) => setDraft({ ...draft, employeeNo: event.target.value })} /></label>
        <label>姓名<input aria-label="姓名" className="enterprise-control mt-1 w-full border px-2" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>手机号<input aria-label="手机号" className="enterprise-control mt-1 w-full border px-2" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
        <label>岗位<select aria-label="岗位" className="enterprise-control mt-1 w-full border px-2" value={draft.position} onChange={(event) => setDraft({ ...draft, position: event.target.value as "cashier" | "sales" })}><option value="cashier">收银</option><option value="sales">销售</option></select></label>
        <label>用工类型<select aria-label="用工类型" className="enterprise-control mt-1 w-full border px-2" value={draft.employmentType} onChange={(event) => setDraft({ ...draft, employmentType: event.target.value as "fulltime" | "parttime" })}><option value="fulltime">全职</option><option value="parttime">兼职</option></select></label>
        <label>周工时上限<input aria-label="周工时上限" type="number" className="enterprise-control mt-1 w-full border px-2" value={draft.maxWeeklyHours} onChange={(event) => setDraft({ ...draft, maxWeeklyHours: Number(event.target.value) })} /></label>
        <label>销售能力<select aria-label="销售能力" className="enterprise-control mt-1 w-full border px-2" value={draft.salesAbility} onChange={(event) => setDraft({ ...draft, salesAbility: event.target.value as EmployeeInput["salesAbility"] })}><option value="high">高</option><option value="mid">中</option><option value="low">低</option><option value="none">无</option></select></label>
        <label>绩效标签<select aria-label="绩效标签" className="enterprise-control mt-1 w-full border px-2" value={draft.performanceBand} onChange={(event) => setDraft({ ...draft, performanceBand: event.target.value as EmployeeInput["performanceBand"] })}><option value="always">总是达标</option><option value="almost_always">几乎总是</option><option value="frequently">经常</option><option value="sometimes">有时</option><option value="rarely">很少</option></select></label>
        <label>入职日期<input aria-label="入职日期" type="date" className="enterprise-control mt-1 w-full border px-2" value={draft.hireDate} onChange={(event) => setDraft({ ...draft, hireDate: event.target.value })} /></label>
      </div>}
    </Dialog>
  </div>;
}
