import { describe, expect, it } from "vitest";

import { solveDemoSchedule } from "./demoScheduleSolver";

describe("solveDemoSchedule", () => {
  it("honors position, unavailability and reports remaining gaps", () => {
    const result = solveDemoSchedule({
      week_of: "2026-07-20",
      days: ["2026-07-20"],
      shifts: ["morning", "afternoon", "evening"],
      demand: {},
      position_demand: {
        "2026-07-20": {
          morning: { cashier: 1, sales: 1 },
          afternoon: { cashier: 0, sales: 0 },
          evening: { cashier: 0, sales: 0 },
        },
      },
      employees: [
        { id: "cashier", name: "收银", position: "cashier" },
        {
          id: "sales",
          name: "销售",
          position: "sales",
          unavailable: [{ date: "2026-07-20", shift: "morning" }],
        },
      ],
      work_mode: "work5rest2",
    });

    expect(result.assignments).toEqual([
      { employee_id: "cashier", date: "2026-07-20", shift: "morning" },
    ]);
    expect(result.gaps).toEqual([
      {
        date: "2026-07-20",
        shift: "morning",
        position: "sales",
        required: 1,
        shortfall: 1,
      },
    ]);
  });

  it("limits work5rest2 to five distinct days", () => {
    const days = [
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
    ];
    const result = solveDemoSchedule({
      week_of: days[0],
      days,
      shifts: ["morning", "afternoon", "evening"],
      demand: Object.fromEntries(
        days.map((date) => [date, { morning: 1, afternoon: 0, evening: 0 }]),
      ),
      position_demand: {},
      employees: [{ id: "employee", name: "员工", position: "sales" }],
      work_mode: "work5rest2",
    });

    expect(new Set(result.assignments.map((row) => row.date)).size).toBe(5);
    expect(result.gaps).toHaveLength(2);
  });
});
