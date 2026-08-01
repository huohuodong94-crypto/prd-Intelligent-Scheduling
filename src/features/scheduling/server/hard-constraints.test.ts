import { describe, expect, it } from "vitest";

import type { HardConstraintInput } from "./hard-constraints";
import { validateHardConstraints } from "./hard-constraints";

const employee = {
  id: "employee-1",
  storeId: "store-1",
  role: "employee" as const,
  position: "sales" as const,
  maxWeeklyHours: 40,
  memberships: [
    {
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      workGroupActive: true,
      workAreaActive: true,
    },
  ],
};

const base: HardConstraintInput = {
  storeId: "store-1",
  planId: "plan-1",
  weekOf: "2026-07-20",
  mode: "work5rest2",
  employees: [employee],
  assignments: [],
  leaves: [],
  unavailable: [],
  requiredByPosition: {},
};

function codes(input: Partial<HardConstraintInput>) {
  return validateHardConstraints({ ...base, ...input }).map((issue) => issue.code);
}

describe("validateHardConstraints", () => {
  it("reports employee_store for unknown and cross-store employees", () => {
    expect(
      codes({
        employees: [{ ...employee, storeId: "store-2" }],
        assignments: [{ userId: employee.id, date: "2026-07-20", shiftType: "morning" }],
      }),
    ).toContain("employee_store");
    expect(
      codes({
        assignments: [{ userId: "unknown", date: "2026-07-20", shiftType: "morning" }],
      }),
    ).toContain("employee_store");
  });

  it("reports employee_role for manager, invalid position, and inactive membership", () => {
    for (const invalidEmployee of [
      { ...employee, role: "manager" as const },
      { ...employee, position: null },
      {
        ...employee,
        memberships: [
          {
            effectiveFrom: "2026-07-21",
            effectiveTo: null,
            workGroupActive: true,
            workAreaActive: true,
          },
        ],
      },
    ]) {
      expect(
        codes({
          employees: [invalidEmployee],
          assignments: [{ userId: employee.id, date: "2026-07-20", shiftType: "morning" }],
        }),
      ).toContain("employee_role");
    }
  });

  it("reports week_range for dates outside the plan week", () => {
    expect(
      codes({
        assignments: [{ userId: employee.id, date: "2026-07-27", shiftType: "morning" }],
      }),
    ).toContain("week_range");
  });

  it("reports invalid_shift for an unknown shift and a duplicate assignment", () => {
    expect(
      codes({
        assignments: [
          { userId: employee.id, date: "2026-07-20", shiftType: "night" as "morning" },
        ],
      }),
    ).toContain("invalid_shift");
    expect(
      codes({
        assignments: [
          { userId: employee.id, date: "2026-07-20", shiftType: "morning" },
          { userId: employee.id, date: "2026-07-20", shiftType: "morning" },
        ],
      }),
    ).toContain("invalid_shift");
  });

  it("reports approved leave and unavailable shift overlaps", () => {
    const assignment = {
      userId: employee.id,
      date: "2026-07-20",
      shiftType: "morning" as const,
    };
    expect(
      codes({
        assignments: [assignment],
        leaves: [
          {
            userId: employee.id,
            status: "approved",
            startTime: "2026-07-20T10:00:00+08:00",
            endTime: "2026-07-20T11:00:00+08:00",
          },
        ],
      }),
    ).toContain("leave");
    expect(
      codes({
        assignments: [assignment],
        unavailable: [{ userId: employee.id, date: "2026-07-20", shiftType: "morning" }],
      }),
    ).toContain("unavailable");
  });

  it("interprets fixed shifts in Asia/Shanghai regardless of the process timezone", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      expect(
        codes({
          assignments: [
            { userId: employee.id, date: "2026-07-20", shiftType: "morning" },
          ],
          leaves: [
            {
              userId: employee.id,
              status: "approved",
              startTime: "2026-07-20T12:00:00+08:00",
              endTime: "2026-07-20T12:30:00+08:00",
            },
          ],
        }),
      ).toContain("leave");
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it("allows exactly morning plus evening and counts both as four hours each", () => {
    const assignments = [
      { userId: employee.id, date: "2026-07-20", shiftType: "morning" as const },
      { userId: employee.id, date: "2026-07-20", shiftType: "evening" as const },
    ];
    const issues = codes({
      employees: [{ ...employee, maxWeeklyHours: 8 }],
      assignments,
    });
    expect(issues).not.toContain("rest");
    expect(issues).not.toContain("weekly_hours");
  });

  it("rejects morning plus afternoon, afternoon plus evening, and all three shifts", () => {
    for (const shifts of [
      ["morning", "afternoon"],
      ["afternoon", "evening"],
      ["morning", "afternoon", "evening"],
    ] as const) {
      expect(
        codes({
          assignments: shifts.map((shiftType) => ({
            userId: employee.id,
            date: "2026-07-20",
            shiftType,
          })),
        }),
      ).toContain("rest");
    }
  });

  it("enforces max hours and work-mode distinct-day limits", () => {
    expect(
      codes({
        employees: [{ ...employee, maxWeeklyHours: 4 }],
        assignments: [
          { userId: employee.id, date: "2026-07-20", shiftType: "morning" },
          { userId: employee.id, date: "2026-07-21", shiftType: "morning" },
        ],
      }),
    ).toContain("weekly_hours");
    expect(
      codes({
        assignments: ["20", "21", "22", "23", "24", "25"].map((day) => ({
          userId: employee.id,
          date: `2026-07-${day}`,
          shiftType: "morning" as const,
        })),
      }),
    ).toContain("weekly_hours");
  });

  it("does not let one position satisfy another position's staffing requirement", () => {
    expect(
      codes({
        assignments: [
          { userId: employee.id, date: "2026-07-20", shiftType: "morning" },
        ],
        requiredByPosition: {
          "2026-07-20": { morning: { cashier: 1, sales: 1 } },
        },
      }),
    ).toContain("staffing_gap");
  });

  it("emits issues in the controller-defined pipeline order", () => {
    const issueCodes = codes({
      employees: [{ ...employee, storeId: "store-2", role: "manager" as const }],
      assignments: [
        { userId: employee.id, date: "2026-07-27", shiftType: "night" as "morning" },
      ],
      requiredByPosition: {
        "2026-07-20": { morning: { cashier: 1 } },
      },
    });
    expect(issueCodes.slice(0, 4)).toEqual([
      "employee_store",
      "employee_role",
      "week_range",
      "invalid_shift",
    ]);
    expect(issueCodes.at(-1)).toBe("staffing_gap");
  });
});
