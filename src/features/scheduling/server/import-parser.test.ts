import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  createScheduleTemplate,
  parseScheduleWorkbook,
  parseScheduleWorksheet,
  parseShiftCell,
} from "./import-parser";

const weekOf = "2026-07-20";
const headers = [
  "员工工号",
  "姓名",
  "岗位",
  "2026-07-20",
  "2026-07-21",
  "2026-07-22",
  "2026-07-23",
  "2026-07-24",
  "2026-07-25",
  "2026-07-26",
];
const employees = [
  {
    id: "employee-1",
    employeeNo: "E001",
    name: "小王",
    position: "sales" as const,
  },
];

describe("schedule import parser", () => {
  it("parses the legal morning plus evening cell into two assignments", () => {
    expect(parseShiftCell("早班+晚班")).toEqual(["morning", "evening"]);
    expect(parseShiftCell("早班+早班")).toBeNull();
    const result = parseScheduleWorksheet(
      [headers, ["E001", "小王", "sales", "早班+晚班", "", "", "", "", "", ""]],
      weekOf,
      employees,
    );
    expect(result.errors).toEqual([]);
    expect(result.assignments).toEqual([
      { userId: "employee-1", date: "2026-07-20", shiftType: "morning" },
      { userId: "employee-1", date: "2026-07-20", shiftType: "evening" },
    ]);
  });

  it("returns exact issue coordinates for an unknown shift", () => {
    const result = parseScheduleWorksheet(
      [headers, ["E001", "小王", "sales", "通宵班", "", "", "", "", "", ""]],
      weekOf,
      employees,
    );

    expect(result.errors).toContainEqual({
      severity: "error",
      row: 2,
      column: "2026-07-20",
      value: "通宵班",
      code: "invalid_shift",
      suggestion: "仅允许早班、午班、晚班；同日双班用 + 分隔",
    });
  });

  it("rejects extra or cross-week headers instead of guessing columns", () => {
    const result = parseScheduleWorksheet(
      [[...headers, "2026-07-27"], ["E001", "小王", "sales"]],
      weekOf,
      employees,
    );
    expect(result.errors.map((issue) => issue.code)).toContain("invalid_headers");
  });

  it("rejects duplicate employee rows and identity mismatches", () => {
    const duplicate = parseScheduleWorksheet(
      [
        headers,
        ["E001", "小王", "sales", "早班", "", "", "", "", "", ""],
        ["E001", "小王", "sales", "", "早班", "", "", "", "", ""],
      ],
      weekOf,
      employees,
    );
    expect(duplicate.errors.map((issue) => issue.code)).toContain("duplicate_employee");

    const mismatch = parseScheduleWorksheet(
      [headers, ["E001", "假名字", "cashier", "早班", "", "", "", "", "", ""]],
      weekOf,
      employees,
    );
    expect(mismatch.errors.map((issue) => issue.code)).toContain("employee_identity");
  });

  it("rejects every populated row when production supplies an empty employee set", () => {
    const result = parseScheduleWorksheet(
      [headers, ["FAKE", "假员工", "sales", "早班", "", "", "", "", "", ""]],
      weekOf,
      [],
    );
    expect(result.errors.map((issue) => issue.code)).toContain("employee_identity");
    expect(result).toMatchObject({ successRows: 0, errorRows: 1, assignments: [] });
  });

  it("creates a real xlsx template with seven exact dates and cell validation", async () => {
    const buffer = await createScheduleTemplate(weekOf, employees);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).values).toEqual([undefined, ...headers]);
    expect(sheet.getCell("D2").dataValidation).toMatchObject({
      type: "list",
      allowBlank: true,
    });
    expect(String(sheet.getCell("D2").dataValidation.formulae?.[0])).toContain("早班+晚班");
  });

  it("rejects formulas from a real workbook and never trusts displayed text", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("班表导入");
    sheet.addRow(headers);
    sheet.addRow(["E001", "小王", "sales", { formula: '="早班"', result: "早班" }]);
    const buffer = await workbook.xlsx.writeBuffer();
    const result = await parseScheduleWorkbook(buffer, weekOf, employees);
    expect(result.errors.map((issue) => issue.code)).toContain("formula_not_allowed");
  });
});
