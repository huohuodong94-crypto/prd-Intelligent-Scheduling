"use client";

import { useCallback, useEffect, useState } from "react";

import { Btn, Panel, ShiftBlock } from "@/components/ui";
import {
  api,
  ApiError,
  assignmentsToCells,
  cellsToAssignments,
  POSITION_LABELS,
  SHIFT_LABELS,
  WEEKDAYS,
} from "@/lib/client";
import type {
  ConstraintIssue,
  ImportValidationResult,
  ScheduleAssignment,
  ScheduleCell,
  SchedulePlanDetail,
  Shift,
} from "@/lib/contracts/scheduling";
import { validateHardConstraints } from "@/features/scheduling/server/hard-constraints";

import ImportPanel from "./ImportPanel";
import ScheduleGrid from "./ScheduleGrid";

const MANUAL_SHIFTS: Shift[] = ["morning", "afternoon", "evening"];

type Recommendation = {
  assignments: Array<{ userId: string; userName: string; date: string; shiftType: string }>;
  gaps: Array<{ date: string; shift: string; position?: string; required: number; shortfall: number }>;
  note: string;
  explanation: string;
  solveTimeMs?: number;
  status: string;
};

type DetailResponse = SchedulePlanDetail & {
  plan: { id: string; version: number };
  recommendation: Recommendation | null;
};

export default function GenerateStep({
  planId,
  readOnly,
  onPrev,
}: {
  planId: string;
  readOnly: boolean;
  onPrev: () => void;
}) {
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [instruction, setInstruction] = useState("");
  const [message, setMessage] = useState("");
  const [manualAvailable, setManualAvailable] = useState(false);
  const [cells, setCells] = useState<ScheduleCell[]>([]);
  const [issues, setIssues] = useState<ConstraintIssue[]>([]);
  const [importValidation, setImportValidation] = useState<ImportValidationResult | null>(null);
  const [sourcePlanId, setSourcePlanId] = useState("");
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const next = await api<DetailResponse>(`/api/schedule/plan?id=${encodeURIComponent(planId)}`);
    setDetail(next);
    setRecommendation(next.recommendation);
    setCells(assignmentsToCells(next.schedules ?? []));
    setIssues([]);
  }, [planId]);
  useEffect(() => { load().catch((error: Error) => setMessage(error.message)); }, [load]);

  async function generate() {
    if (!detail) return;
    setPending(true);
    setMessage("");
    try {
      const response = await api<Recommendation & { plan: { version: number } }>("/api/schedule/generate", {
        method: "POST",
        body: {
          planId,
          version: detail.plan.version,
          instruction: instruction.trim() || undefined,
        },
      });
      setRecommendation(response);
      setCells(assignmentsToCells(response.assignments.map(({ userId, date, shiftType }) => ({
        userId,
        date,
        shiftType: shiftType as Shift,
      }))));
      setIssues([]);
      setDetail({
        ...detail,
        version: response.plan.version,
        plan: { ...detail.plan, version: response.plan.version },
      });
      setMessage(`优化完成${response.solveTimeMs !== undefined ? `（${response.solveTimeMs}ms）` : ""}`);
      setManualAvailable(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        setMessage("优化引擎不可用，可继续手动排班");
        setManualAvailable(true);
      } else {
        setMessage(error instanceof Error ? error.message : "生成失败");
      }
    } finally {
      setPending(false);
    }
  }

  const assignmentsAt = (userId: string, date: string) =>
    recommendation?.assignments.filter(
      (row) => row.userId === userId && row.date === date,
    ) ?? [];

  function openGridEditor() {
    if (!detail || readOnly) return;
    if (recommendation) {
      setCells(assignmentsToCells(
        recommendation.assignments.map(({ userId, date, shiftType }) => ({
          userId,
          date,
          shiftType: shiftType as Shift,
        })),
      ));
      setIssues([]);
    }
    setTimeout(() => {
      document.getElementById("schedule-grid-panel")?.scrollIntoView?.({ block: "start" });
      const firstEmployee = detail.employees[0];
      const firstDate = detail.days[0];
      if (firstEmployee && firstDate) {
        document.getElementById(`cell-${firstEmployee.id}-${firstDate}`)?.focus();
      }
    }, 0);
  }

  async function saveManualDraft(assignments: ScheduleAssignment[]) {
    if (!detail) return;
    setPending(true);
    try {
      const response = await api<{ saved: number; plan: { version: number } }>(
        "/api/schedule/save",
        {
          method: "POST",
          body: {
            planId,
            version: detail.plan.version,
            weekOf: detail.weekOf,
            assignments,
            source: "manual",
          },
        },
      );
      setDetail({
        ...detail,
        version: response.plan.version,
        plan: { ...detail.plan, version: response.plan.version },
      });
      setCells(assignmentsToCells(assignments));
      setIssues([]);
      setMessage(`手工草稿已保存（${response.saved} 个班次）`);
    } catch (error) {
      setIssues(serverIssues(error));
      setMessage(error instanceof Error ? error.message : "手工草稿保存失败");
    } finally {
      setPending(false);
    }
  }

  async function saveGridDraft() {
    await saveManualDraft(cellsToAssignments(cells));
  }

  function serverIssues(error: unknown): ConstraintIssue[] {
    if (!(error instanceof ApiError) || !error.details || typeof error.details !== "object") {
      return [];
    }
    const candidate = (error.details as { issues?: unknown }).issues;
    return Array.isArray(candidate) ? candidate as ConstraintIssue[] : [];
  }

  function mergePlan(next: { version: number; status?: DetailResponse["status"]; publishedAt?: string | null }) {
    setDetail((current) => current ? {
      ...current,
      version: next.version,
      status: next.status ?? current.status,
      publishedAt: next.publishedAt === undefined ? current.publishedAt : next.publishedAt,
      plan: { ...current.plan, version: next.version },
    } : current);
    setImportValidation(null);
  }

  function validateCell(next: ScheduleCell) {
    if (!detail) return [];
    const candidateCells = [
      ...cells.filter((cell) => !(cell.userId === next.userId && cell.date === next.date)),
      ...(next.shifts.length > 0 ? [next] : []),
    ];
    const closedDates = new Set(
      detail.days.filter((date) =>
        detail.operatingDays.some(
          (day) => day.dayOfWeek === new Date(`${date}T00:00:00`).getDay() && !day.isOpen,
        ),
      ),
    );
    const unavailable = [
      ...detail.unavailable.filter((slot) => slot.source === "unavailable").map((slot) => ({
        userId: slot.userId,
        date: slot.date,
        shiftType: slot.timeSlot,
      })),
      ...detail.employees.flatMap((employee) =>
        [...closedDates].flatMap((date) =>
          MANUAL_SHIFTS.map((shiftType) => ({ userId: employee.id, date, shiftType })),
        ),
      ),
    ];
    const nextIssues = validateHardConstraints({
      storeId: detail.storeId,
      planId,
      weekOf: detail.weekOf,
      mode: detail.mode,
      employees: detail.employees.map((employee) => ({
        id: employee.id,
        storeId: employee.storeId ?? detail.storeId,
        role: employee.role ?? "employee",
        position: employee.position,
        maxWeeklyHours: employee.maxWeeklyHours,
        memberships: employee.memberships,
      })),
      assignments: cellsToAssignments(candidateCells),
      leaves: detail.approvedLeaves ?? [],
      unavailable,
      requiredByPosition: detail.requiredByPosition ?? {},
    });
    setIssues(nextIssues);
    return nextIssues.filter((issue) =>
      issue.code !== "staffing_gap" &&
      issue.userId === next.userId &&
      (issue.code === "weekly_hours" || issue.date === next.date),
    );
  }

  function changeCells(next: ScheduleCell[]) {
    setCells(next);
  }

  async function restoreServerRecommendation() {
    if (!detail) return;
    setPending(true);
    setMessage("");
    try {
      const response = await api<{
        restored: number;
        assignments: ScheduleAssignment[];
        plan: DetailResponse;
      }>("/api/schedule/restore-recommendation", {
        method: "POST",
        body: { planId, version: detail.plan.version },
      });
      setCells(assignmentsToCells(response.assignments));
      mergePlan(response.plan);
      setIssues([]);
      setMessage(`已恢复服务端推荐（${response.restored} 个班次）`);
    } catch (error) {
      setIssues(serverIssues(error));
      setMessage(error instanceof Error ? error.message : "恢复推荐失败");
    } finally {
      setPending(false);
    }
  }

  async function publish() {
    if (!detail) return;
    setPending(true);
    setMessage("");
    try {
      const response = await api<{ published: number; plan: DetailResponse }>("/api/schedule/publish", {
        method: "POST",
        body: {
          planId,
          version: detail.plan.version,
          assignments: cellsToAssignments(cells),
        },
      });
      mergePlan(response.plan);
      setIssues([]);
      setMessage(`已发布（${response.published} 个班次）`);
    } catch (error) {
      setIssues(serverIssues(error));
      setMessage(error instanceof Error ? error.message : "发布失败");
    } finally {
      setPending(false);
    }
  }

  async function copyPublishedHistory() {
    if (!detail || !sourcePlanId.trim()) return;
    setPending(true);
    setMessage("");
    try {
      const response = await api<{ copied: number; plan: DetailResponse }>("/api/schedule/copy-history", {
        method: "POST",
        body: { planId, sourcePlanId: sourcePlanId.trim(), version: detail.plan.version },
      });
      mergePlan(response.plan);
      await load();
      setMessage(`已复制历史已发布班表（${response.copied} 个班次）`);
    } catch (error) {
      setIssues(serverIssues(error));
      setMessage(error instanceof Error ? error.message : "复制历史班表失败");
    } finally {
      setPending(false);
    }
  }

  async function refreshAfterImport(nextVersion: number) {
    mergePlan({ version: nextVersion });
    await load();
    setMessage("导入已应用到当前班表");
  }

  return (
    <div className="space-y-3">
      <Panel title="智能排班">
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <input aria-label="自然语言排班偏好" className="flex-1 border rounded px-3 py-2 text-[12px] outline-none" value={instruction} disabled={readOnly || pending} placeholder="可选：例如“小王优先早班”；自然语言只转软偏好，不参与约束计算" onChange={(event) => setInstruction(event.target.value)} />
            {!readOnly && <Btn variant="primary" disabled={pending || !detail} onClick={generate}>{pending ? "求解中…" : "生成推荐"}</Btn>}
            {!readOnly && <Btn disabled={!manualAvailable && !recommendation} onClick={openGridEditor}>继续手动排班</Btn>}
          </div>
          {message && <div className={`rounded px-3 py-2 text-[12px] ${message.includes("不可用") ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>{message}</div>}
          {recommendation?.explanation && <div className="rounded bg-gray-50 p-3 text-[12px] text-gray-600"><span className="font-medium text-gray-700">推荐说明：</span>{recommendation.explanation}</div>}
        </div>
      </Panel>

      {detail && (
        <Panel title="班表编辑与发布">
          <div id="schedule-grid-panel" className="space-y-4 p-4">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[12px] text-gray-600">
                历史已发布计划 ID
                <input
                  aria-label="历史已发布计划 ID"
                  className="ml-2 rounded border px-2 py-1.5"
                  value={sourcePlanId}
                  disabled={pending || readOnly || detail.status === "published"}
                  onChange={(event) => setSourcePlanId(event.target.value)}
                />
              </label>
              <Btn disabled={pending || readOnly || detail.status === "published" || !sourcePlanId.trim()} onClick={copyPublishedHistory}>复制历史</Btn>
              <a className="rounded border px-3 py-1.5 text-[12px]" href={`/api/schedule/export?planId=${encodeURIComponent(planId)}`}>导出 xlsx</a>
              <Btn variant="primary" disabled={pending || readOnly || detail.status === "published"} onClick={saveGridDraft}>{pending ? "处理中…" : "保存草稿"}</Btn>
              <span className="text-[11px] text-gray-500">版本 {detail.plan.version}{detail.status === "published" ? " · 已发布（只读）" : ""}
              </span>
            </div>
            <ScheduleGrid
              planId={planId}
              weekOf={detail.weekOf}
              version={detail.plan.version}
              employees={detail.employees}
              days={detail.days}
              cells={cells}
              issues={issues}
              onChange={changeCells}
              validateCell={validateCell}
              onRestore={restoreServerRecommendation}
              onPublish={publish}
              readOnly={pending || readOnly || detail.status === "published"}
            />
            {!readOnly && detail.status !== "published" && (
              <ImportPanel
                planId={planId}
                version={detail.plan.version}
                validation={importValidation}
                onValidated={setImportValidation}
                onCommitted={(nextVersion) => { void refreshAfterImport(nextVersion); }}
              />
            )}
          </div>
        </Panel>
      )}

      <Panel title="推荐排班网格">
        <div className="p-4 overflow-x-auto">
          {!detail ? <div className="py-8 text-center text-[12px] text-gray-400">读取计划…</div> : (
            <table className="ent-table" style={{ minWidth: 900 }}><thead><tr><th>员工 / 岗位</th>{detail.days.map((date) => <th key={date} className="text-center">{WEEKDAYS[new Date(`${date}T00:00:00`).getDay()]}<span className="block font-normal text-gray-400">{date.slice(5)}</span></th>)}</tr></thead><tbody>{detail.employees.map((employee) => <tr key={employee.id}><td>{employee.name}<span className="ml-2 text-[11px] text-gray-400">{POSITION_LABELS[employee.position]}</span></td>{detail.days.map((date) => { const assignments = assignmentsAt(employee.id, date); return <td key={date}>{assignments.length > 0 ? <div className="space-y-1">{assignments.map((assignment) => <ShiftBlock key={assignment.shiftType} shift={assignment.shiftType} />)}</div> : <div className="text-center text-[11px] text-gray-300">OFF / 休</div>}</td>; })}</tr>)}</tbody></table>
          )}
        </div>
      </Panel>

      {recommendation && recommendation.gaps.length > 0 && (
        <Panel title="岗位缺口"><div className="p-4 flex flex-wrap gap-2">{recommendation.gaps.map((gap, index) => <span key={`${gap.date}-${gap.shift}-${gap.position}-${index}`} className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">{gap.date} {SHIFT_LABELS[gap.shift]} {gap.position ? POSITION_LABELS[gap.position] : "全店"}：需 {gap.required}，缺 {gap.shortfall}</span>)}</div></Panel>
      )}
      <div><Btn onClick={onPrev}>← 上一步：人力预测</Btn></div>
    </div>
  );
}
