import { SHIFT_TIMES, type Position, type Shift } from "./config";
import type { SolveRequest, SolveResult } from "./scheduleEngine";

type Assignment = SolveResult["assignments"][number];

function slotRange(date: string, shift: Shift) {
  const base = new Date(`${date}T00:00:00Z`).getTime();
  return {
    start: base + SHIFT_TIMES[shift].start * 60 * 60 * 1000,
    end: base + SHIFT_TIMES[shift].end * 60 * 60 * 1000,
  };
}

function hasEnoughRest(
  candidate: { date: string; shift: Shift },
  existing: Assignment[],
  minRestHours: number,
) {
  const next = slotRange(candidate.date, candidate.shift);
  return existing.every((row) => {
    const current = slotRange(row.date, row.shift);
    const gapMs =
      next.start >= current.start ? next.start - current.end : current.start - next.end;
    return gapMs >= minRestHours * 60 * 60 * 1000;
  });
}

/**
 * Vercel 演示环境使用的确定性贪心求解器。
 *
 * 生产/本地仍使用 Python OR-Tools。这里保留请假、岗位、工时、工作日和
 * 休息间隔等硬约束，并在人员不足时显式返回缺口，保证面试演示链路完整。
 */
export function solveDemoSchedule(req: SolveRequest): SolveResult {
  const startedAt = Date.now();
  const shifts = req.shifts ?? (["morning", "afternoon", "evening"] as Shift[]);
  const shiftHours = req.shift_hours ?? 4;
  const minRestHours = req.min_rest_hours ?? 4;
  const maxWorkDays = req.work_mode === "work6rest1" ? 6 : 5;
  const preferences = new Set(
    (req.preferences ?? []).map((row) => `${row.employee_id}:${row.shift}`),
  );
  const unavailable = new Map(
    req.employees.map((employee) => [
      employee.id,
      new Set((employee.unavailable ?? []).map((row) => `${row.date}:${row.shift}`)),
    ]),
  );
  const assignedByEmployee = new Map<string, Assignment[]>();
  const workDaysByEmployee = new Map<string, Set<string>>();
  const assignments: Assignment[] = [];
  const gaps: SolveResult["gaps"] = [];

  const allocate = (date: string, shift: Shift, required: number, position?: Position) => {
    for (let index = 0; index < required; index += 1) {
      const candidates = req.employees
        .filter((employee) => !position || employee.position === position)
        .filter((employee) => !unavailable.get(employee.id)?.has(`${date}:${shift}`))
        .filter((employee) => {
          const rows = assignedByEmployee.get(employee.id) ?? [];
          const maxHours = employee.max_weekly_hours ?? req.max_weekly_hours ?? 40;
          if ((rows.length + 1) * shiftHours > maxHours) return false;
          const days = workDaysByEmployee.get(employee.id) ?? new Set<string>();
          if (!days.has(date) && days.size >= maxWorkDays) return false;
          return hasEnoughRest({ date, shift }, rows, minRestHours);
        })
        .sort((left, right) => {
          const leftRows = assignedByEmployee.get(left.id) ?? [];
          const rightRows = assignedByEmployee.get(right.id) ?? [];
          const leftPreferred = preferences.has(`${left.id}:${shift}`) ? 1 : 0;
          const rightPreferred = preferences.has(`${right.id}:${shift}`) ? 1 : 0;
          if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred;
          if (leftRows.length !== rightRows.length) return leftRows.length - rightRows.length;
          const lastWeekDiff = (left.last_week_hours ?? 0) - (right.last_week_hours ?? 0);
          if (lastWeekDiff !== 0) return lastWeekDiff;
          return left.id.localeCompare(right.id);
        });

      const employee = candidates[0];
      if (!employee) {
        const existingGap = gaps.find(
          (gap) =>
            gap.date === date && gap.shift === shift && gap.position === position,
        );
        if (existingGap) existingGap.shortfall += 1;
        else gaps.push({ date, shift, position, required, shortfall: 1 });
        continue;
      }

      const assignment = { employee_id: employee.id, date, shift };
      assignments.push(assignment);
      assignedByEmployee.set(employee.id, [
        ...(assignedByEmployee.get(employee.id) ?? []),
        assignment,
      ]);
      const workDays = workDaysByEmployee.get(employee.id) ?? new Set<string>();
      workDays.add(date);
      workDaysByEmployee.set(employee.id, workDays);
    }
  };

  for (const date of req.days) {
    for (const shift of shifts) {
      const positionDemand = req.position_demand?.[date]?.[shift];
      if (positionDemand) {
        allocate(date, shift, Number(positionDemand.cashier ?? 0), "cashier");
        allocate(date, shift, Number(positionDemand.sales ?? 0), "sales");
      } else {
        allocate(date, shift, Number(req.demand?.[date]?.[shift] ?? 0));
      }
    }
  }

  return {
    status: gaps.length ? "feasible_with_gaps" : "feasible",
    message: gaps.length ? "演示求解完成，部分时段存在人数缺口" : "演示求解成功",
    objective: gaps.reduce((total, gap) => total + gap.shortfall, 0),
    solve_time_ms: Date.now() - startedAt,
    assignments,
    gaps,
  };
}
