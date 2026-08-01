import { POSITIONS, SHIFTS, SHIFT_TIMES, type Position, type Shift } from "@/lib/config";
import type {
  ConstraintIssue,
  RequiredByPosition,
  ScheduleAssignment,
  WorkMode,
} from "@/lib/contracts/scheduling";
import { weekDays } from "@/lib/dates";

type Membership = {
  effectiveFrom: string;
  effectiveTo?: string | null;
  workGroupActive: boolean;
  workAreaActive: boolean;
};

type ConstraintEmployee = {
  id: string;
  storeId: string | null;
  role: string;
  position: string | null;
  maxWeeklyHours: number;
  memberships?: Membership[];
};

type ConstraintLeave = {
  userId: string;
  status: string;
  startTime: string | Date;
  endTime: string | Date;
};

type ConstraintUnavailable = {
  userId: string;
  date: string;
  shiftType: string;
};

export type HardConstraintInput = {
  storeId: string;
  planId?: string;
  weekOf: string;
  mode: WorkMode;
  employees: ConstraintEmployee[];
  assignments: ScheduleAssignment[];
  leaves: ConstraintLeave[];
  unavailable: ConstraintUnavailable[];
  requiredByPosition: RequiredByPosition;
};

const issue = (
  code: ConstraintIssue["code"],
  message: string,
  assignment?: Partial<ScheduleAssignment>,
): ConstraintIssue => ({ code, message, ...assignment });

function membershipActive(employee: ConstraintEmployee, date: string) {
  if (employee.memberships === undefined) return true;
  return employee.memberships.some(
    (membership) =>
      membership.workGroupActive &&
      membership.workAreaActive &&
      membership.effectiveFrom <= date &&
      (!membership.effectiveTo || membership.effectiveTo >= date),
  );
}

function shiftInterval(date: string, shift: Shift) {
  const { start, end } = SHIFT_TIMES[shift];
  return {
    start: new Date(`${date}T${String(start).padStart(2, "0")}:00:00+08:00`),
    end: new Date(`${date}T${String(end).padStart(2, "0")}:00:00+08:00`),
  };
}

export function validateHardConstraints(input: HardConstraintInput): ConstraintIssue[] {
  const issues: ConstraintIssue[] = [];
  const employees = new Map(input.employees.map((employee) => [employee.id, employee]));
  const allowedDates = new Set(weekDays(input.weekOf));
  const validAssignments = input.assignments.filter((assignment) =>
    SHIFTS.includes(assignment.shiftType as Shift),
  );

  for (const assignment of input.assignments) {
    const employee = employees.get(assignment.userId);
    if (!employee || employee.storeId !== input.storeId) {
      issues.push(issue("employee_store", "员工不存在或不属于当前门店", assignment));
    }
  }

  for (const assignment of input.assignments) {
    const employee = employees.get(assignment.userId);
    if (
      !employee ||
      employee.role !== "employee" ||
      !POSITIONS.includes(employee.position as Position) ||
      !membershipActive(employee, assignment.date)
    ) {
      issues.push(
        issue("employee_role", "仅有效在岗且具有可排班岗位的员工可以排班", assignment),
      );
    }
  }

  for (const assignment of input.assignments) {
    if (!allowedDates.has(assignment.date)) {
      issues.push(issue("week_range", "排班日期不在计划周内", assignment));
    }
  }

  const seen = new Set<string>();
  for (const assignment of input.assignments) {
    const key = `${assignment.userId}\u0000${assignment.date}\u0000${assignment.shiftType}`;
    if (!SHIFTS.includes(assignment.shiftType as Shift) || seen.has(key)) {
      issues.push(issue("invalid_shift", "班次无效或排班记录重复", assignment));
    }
    seen.add(key);
  }

  for (const assignment of validAssignments) {
    const interval = shiftInterval(assignment.date, assignment.shiftType);
    if (
      input.leaves.some((leave) => {
        if (leave.status !== "approved" || leave.userId !== assignment.userId) return false;
        const start = new Date(leave.startTime);
        const end = new Date(leave.endTime);
        return start < interval.end && end > interval.start;
      })
    ) {
      issues.push(issue("leave", "班次与已批准请假重叠", assignment));
    }
  }

  const unavailable = new Set(
    input.unavailable.map(
      (slot) => `${slot.userId}\u0000${slot.date}\u0000${slot.shiftType}`,
    ),
  );
  for (const assignment of validAssignments) {
    if (
      unavailable.has(
        `${assignment.userId}\u0000${assignment.date}\u0000${assignment.shiftType}`,
      )
    ) {
      issues.push(issue("unavailable", "员工在该班次不可供班", assignment));
    }
  }

  const byCell = new Map<string, ScheduleAssignment[]>();
  for (const assignment of validAssignments) {
    const key = `${assignment.userId}\u0000${assignment.date}`;
    const cell = byCell.get(key) ?? [];
    cell.push(assignment);
    byCell.set(key, cell);
  }
  for (const cell of byCell.values()) {
    const ordered = [...cell].sort(
      (left, right) => SHIFT_TIMES[left.shiftType].start - SHIFT_TIMES[right.shiftType].start,
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = SHIFT_TIMES[ordered[index - 1].shiftType];
      const current = SHIFT_TIMES[ordered[index].shiftType];
      if (current.start - previous.end < 4) {
        issues.push(issue("rest", "同日班次之间至少休息 4 小时", ordered[index]));
        break;
      }
    }
  }

  const byEmployee = new Map<string, ScheduleAssignment[]>();
  for (const assignment of validAssignments) {
    const rows = byEmployee.get(assignment.userId) ?? [];
    rows.push(assignment);
    byEmployee.set(assignment.userId, rows);
  }
  const maxDays = input.mode === "work5rest2" ? 5 : 6;
  for (const [userId, assignments] of byEmployee) {
    const employee = employees.get(userId);
    const distinctDays = new Set(assignments.map((assignment) => assignment.date)).size;
    if (assignments.length * 4 > (employee?.maxWeeklyHours ?? 0) || distinctDays > maxDays) {
      issues.push(issue("weekly_hours", "员工周工时或工作天数超过工作制上限", { userId }));
    }
  }

  for (const [date, shifts] of Object.entries(input.requiredByPosition)) {
    for (const [shiftType, requiredPositions] of Object.entries(shifts)) {
      if (!requiredPositions) continue;
      for (const [position, required] of Object.entries(requiredPositions)) {
        if (!required || required <= 0) continue;
        const actual = validAssignments.filter((assignment) => {
          if (assignment.date !== date || assignment.shiftType !== shiftType) return false;
          const employee = employees.get(assignment.userId);
          return (
            employee?.storeId === input.storeId &&
            employee.role === "employee" &&
            employee.position === position &&
            membershipActive(employee, date)
          );
        }).length;
        if (actual < required) {
          issues.push(
            issue("staffing_gap", `${date} ${shiftType} ${position} 岗位人力不足`, {
              date,
              shiftType: shiftType as Shift,
            }),
          );
        }
      }
    }
  }

  return issues;
}
