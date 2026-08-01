"use client";

import { useEffect, useState } from "react";

import { Btn, Dialog, ShiftBlock } from "@/components/ui";
import { SHIFTS, type Shift } from "@/lib/config";
import type { ConstraintIssue, ScheduleCell } from "@/lib/contracts/scheduling";

export type ScheduleGridProps = {
  planId: string;
  weekOf: string;
  version: number;
  employees: Array<{ id: string; name: string; position: string }>;
  days: string[];
  cells: ScheduleCell[];
  issues: ConstraintIssue[];
  onChange: (cells: ScheduleCell[]) => void;
  validateCell: (cell: ScheduleCell) => ConstraintIssue[];
  onRestore?: () => Promise<void> | void;
  onPublish?: () => Promise<void> | void;
  readOnly?: boolean;
};

const labels: Record<Shift, string> = {
  morning: "早班",
  afternoon: "午班",
  evening: "晚班",
};

export default function ScheduleGrid(props: ScheduleGridProps) {
  const [contextCell, setContextCell] = useState<ScheduleCell | null>(null);
  const [clipboard, setClipboard] = useState<ScheduleCell | null>(null);
  const [editing, setEditing] = useState<ScheduleCell | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    const first = props.issues.find((item) => item.userId && item.date);
    if (first?.userId && first.date) {
      document.getElementById(`cell-${first.userId}-${first.date}`)?.focus();
    }
  }, [props.issues]);

  function cellAt(userId: string, date: string): ScheduleCell {
    return props.cells.find((cell) => cell.userId === userId && cell.date === date) ?? {
      userId,
      date,
      shifts: [],
    };
  }

  function applyCell(next: ScheduleCell) {
    if (!props.days.includes(next.date) || props.validateCell(next).length > 0) return;
    props.onChange([
      ...props.cells.filter(
        (cell) => !(cell.userId === next.userId && cell.date === next.date),
      ),
      ...(next.shifts.length > 0 ? [next] : []),
    ]);
    setContextCell(null);
    setEditing(null);
  }

  return (
    <div className="space-y-3" data-plan-id={props.planId} data-week-of={props.weekOf} data-version={props.version}>
      <div className="flex items-center justify-end gap-2">
        {props.onRestore && <Btn disabled={props.readOnly} onClick={() => void props.onRestore?.()}>恢复推荐</Btn>}
        <Btn disabled={props.readOnly} onClick={() => setConfirmClear(true)}>清空排班</Btn>
        {props.onPublish && <Btn variant="primary" disabled={props.readOnly} onClick={() => void props.onPublish?.()}>发布</Btn>}
      </div>
      {props.issues.length > 0 && (
        <div className="rounded border border-rose-200 bg-rose-50 p-2 text-[12px] text-rose-700">
          {props.issues.map((item, index) => <div key={`${item.code}-${index}`}>{item.message}</div>)}
        </div>
      )}
      <div className="overflow-x-auto rounded border bg-white">
        <table className="ent-table" style={{ minWidth: 960 }}>
          <thead><tr><th className="sticky left-0 z-20 bg-white">员工 / 岗位</th>{props.days.map((date) => <th key={date} className="text-center">{date}</th>)}<th className="sticky right-0 bg-white">周工时</th></tr></thead>
          <tbody>{props.employees.map((employee) => {
            const hours = props.cells.filter((cell) => cell.userId === employee.id).reduce((sum, cell) => sum + cell.shifts.length * 4, 0);
            return <tr key={employee.id}><td className="sticky left-0 z-10 bg-white">{employee.name}<span className="ml-2 text-[11px] text-gray-400">{employee.position}</span></td>{props.days.map((date) => {
              const cell = cellAt(employee.id, date);
              return <td key={date}><button disabled={props.readOnly} id={`cell-${employee.id}-${date}`} data-testid={`cell-${employee.id}-${date}`} className="min-h-12 w-full rounded p-1 text-left hover:bg-gray-50 focus:outline focus:outline-2 focus:outline-blue-400 disabled:cursor-default" onClick={() => !props.readOnly && setEditing(cell)} onContextMenu={(event) => { event.preventDefault(); if (!props.readOnly) setContextCell(cell); }}>{cell.shifts.length ? <div className="space-y-1">{cell.shifts.map((shift) => <ShiftBlock key={shift} shift={shift} />)}</div> : <span className="block text-center text-[11px] text-gray-300">OFF / 休</span>}</button></td>;
            })}<td className="sticky right-0 bg-white text-center text-[12px]">{hours}H</td></tr>;
          })}</tbody>
        </table>
      </div>

      {contextCell && <div role="menu" className="fixed z-50 flex gap-1 rounded border bg-white p-1 shadow-lg">
        <button role="menuitem" onClick={() => setEditing(contextCell)}>编辑</button>
        <button role="menuitem" onClick={() => { setClipboard(contextCell); setContextCell(null); }}>复制</button>
        <button role="menuitem" disabled={!clipboard} onClick={() => clipboard && applyCell({ ...clipboard, userId: contextCell.userId, date: contextCell.date })}>粘贴</button>
        <button role="menuitem" onClick={() => applyCell({ ...contextCell, shifts: [] })}>清除</button>
      </div>}

      <Dialog
        open={editing !== null}
        title="编辑班次"
        onClose={() => setEditing(null)}
        footer={<><Btn onClick={() => setEditing(null)}>取消</Btn><Btn variant="primary" onClick={() => editing && applyCell(editing)}>保存</Btn></>}
      >
        {editing && <div className="space-y-2">{SHIFTS.map((shift) => <label key={shift} className="flex gap-2 text-[12px]"><input type="checkbox" checked={editing.shifts.includes(shift)} onChange={() => setEditing({ ...editing, shifts: editing.shifts.includes(shift) ? editing.shifts.filter((item) => item !== shift) : [...editing.shifts, shift] })} />{labels[shift]}</label>)}</div>}
      </Dialog>

      <Dialog
        open={confirmClear}
        title="确认清空排班"
        role="alertdialog"
        onClose={() => setConfirmClear(false)}
        footer={<><Btn onClick={() => setConfirmClear(false)}>取消</Btn><Btn variant="danger" onClick={() => { props.onChange([]); setConfirmClear(false); }}>确认清空</Btn></>}
      >
        <p className="text-[13px]">确认清空当前计划的全部排班？</p>
      </Dialog>
    </div>
  );
}
