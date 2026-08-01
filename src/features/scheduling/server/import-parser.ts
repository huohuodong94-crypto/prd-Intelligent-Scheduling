import ExcelJS from "exceljs";

import type { Position, Shift } from "@/lib/config";
import type { ImportIssue, ScheduleAssignment } from "@/lib/contracts/scheduling";
import { toDateStr, weekDays } from "@/lib/dates";

const SHIFT_BY_LABEL: Record<string, Shift> = {
  早班: "morning",
  午班: "afternoon",
  晚班: "evening",
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
};

export type ImportEmployee = {
  id: string;
  employeeNo: string;
  name: string;
  position: Position;
};

export type ParsedScheduleImport = {
  assignments: ScheduleAssignment[];
  normalizedRows: ScheduleAssignment[];
  warnings: ImportIssue[];
  errors: ImportIssue[];
  totalRows: number;
  successRows: number;
  errorRows: number;
};

export function parseShiftCell(value: string): Shift[] | null {
  if (!value.trim()) return [];
  const shifts = value.split("+").map((part) => SHIFT_BY_LABEL[part.trim()]);
  return shifts.every(Boolean) && new Set(shifts).size === shifts.length
    ? shifts
    : null;
}

function error(
  row: number,
  column: string,
  value: string,
  code: string,
  suggestion: string,
): ImportIssue {
  return { severity: "error", row, column, value, code, suggestion };
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value instanceof Date) return toDateStr(value);
  if (typeof value === "object" && "richText" in value) {
    return ((value as { richText: Array<{ text: string }> }).richText ?? [])
      .map((part) => part.text)
      .join("")
      .trim();
  }
  return String(value).trim();
}

export function parseScheduleWorksheet(
  rows: unknown[][],
  weekOf: string,
  employees?: ImportEmployee[],
): ParsedScheduleImport {
  const expectedHeaders = ["员工工号", "姓名", "岗位", ...weekDays(weekOf)];
  const actualHeaders = (rows[0] ?? []).map(textValue);
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const assignments: ScheduleAssignment[] = [];
  if (
    actualHeaders.length !== expectedHeaders.length ||
    actualHeaders.some((header, index) => header !== expectedHeaders[index])
  ) {
    errors.push(
      error(
        1,
        "表头",
        actualHeaders.join(" | "),
        "invalid_headers",
        `表头必须严格为：${expectedHeaders.join("、")}`,
      ),
    );
    return {
      assignments,
      normalizedRows: assignments,
      warnings,
      errors,
      totalRows: Math.max(0, rows.length - 1),
      successRows: 0,
      errorRows: Math.max(0, rows.length - 1),
    };
  }

  const validateEmployeeIdentity = employees !== undefined;
  const employeeByNo = new Map((employees ?? []).map((employee) => [employee.employeeNo, employee]));
  const seenEmployeeNos = new Set<string>();
  let totalRows = 0;
  let successRows = 0;
  let errorRows = 0;
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const values = Array.from({ length: expectedHeaders.length }, (_, index) =>
      textValue(rows[rowIndex]?.[index]),
    );
    if (values.every((value) => !value)) continue;
    totalRows += 1;
    const issueStart = errors.length;
    const [employeeNo, name, position] = values;
    const employee = employeeByNo.get(employeeNo);
    if (seenEmployeeNos.has(employeeNo)) {
      errors.push(
        error(rowIndex + 1, "员工工号", employeeNo, "duplicate_employee", "每名员工只能出现一行"),
      );
    }
    seenEmployeeNos.add(employeeNo);
    if (
      validateEmployeeIdentity &&
      (!employee || employee.name !== name || employee.position !== position)
    ) {
      errors.push(
        error(
          rowIndex + 1,
          "员工身份",
          `${employeeNo}/${name}/${position}`,
          "employee_identity",
          "请使用模板中本门店员工的工号、姓名和岗位",
        ),
      );
    }

    const rowAssignments: ScheduleAssignment[] = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const date = expectedHeaders[dayIndex + 3];
      const value = values[dayIndex + 3];
      const shifts = parseShiftCell(value);
      if (shifts === null) {
        errors.push(
          error(
            rowIndex + 1,
            date,
            value,
            "invalid_shift",
            "仅允许早班、午班、晚班；同日双班用 + 分隔",
          ),
        );
        continue;
      }
      if (employee) {
        for (const shiftType of shifts) {
          rowAssignments.push({ userId: employee.id, date, shiftType });
        }
      }
    }
    if (errors.length === issueStart) {
      assignments.push(...rowAssignments);
      successRows += 1;
    } else {
      errorRows += 1;
    }
  }

  return {
    assignments,
    normalizedRows: assignments,
    warnings,
    errors,
    totalRows,
    successRows,
    errorRows,
  };
}

export async function createScheduleTemplate(
  weekOf: string,
  employees: ImportEmployee[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("班表导入");
  const dates = weekDays(weekOf);
  sheet.addRow(["员工工号", "姓名", "岗位", ...dates]);
  for (const employee of employees) {
    sheet.addRow([employee.employeeNo, employee.name, employee.position, ...dates.map(() => "")]);
  }
  sheet.views = [{ state: "frozen", ySplit: 1, xSplit: 3 }];
  sheet.getRow(1).font = { bold: true };
  sheet.columns = [
    { width: 16 },
    { width: 16 },
    { width: 12 },
    ...dates.map(() => ({ width: 15 })),
  ];
  for (let row = 2; row <= Math.max(2, employees.length + 1); row += 1) {
    for (let column = 4; column <= 10; column += 1) {
      sheet.getCell(row, column).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: ['"早班,午班,晚班,早班+晚班"'],
        showErrorMessage: true,
        errorTitle: "班次无效",
        error: "仅允许早班、午班、晚班、早班+晚班或留空",
      };
      sheet.getCell(row, column).note = "合法班次：早班、午班、晚班、早班+晚班";
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function parseScheduleWorkbook(
  buffer: ExcelJS.Buffer | Buffer | ArrayBuffer,
  weekOf: string,
  employees: ImportEmployee[],
): Promise<ParsedScheduleImport> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return {
      assignments: [],
      normalizedRows: [],
      warnings: [],
      errors: [error(1, "工作表", "", "missing_sheet", "请使用系统下载的导入模板")],
      totalRows: 0,
      successRows: 0,
      errorRows: 0,
    };
  }
  const formulaIssues: ImportIssue[] = [];
  const rows: unknown[][] = [];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row: unknown[] = [];
    for (let column = 1; column <= Math.max(10, sheet.columnCount); column += 1) {
      const cell = sheet.getCell(rowNumber, column);
      if (cell.value && typeof cell.value === "object" && "formula" in cell.value) {
        formulaIssues.push(
          error(
            rowNumber,
            sheet.getCell(1, column).text || `第 ${column} 列`,
            cell.text,
            "formula_not_allowed",
            "请粘贴静态文本，不允许公式",
          ),
        );
      }
      row.push(cell.value);
    }
    while (row.length > 0 && textValue(row.at(-1)) === "") row.pop();
    rows.push(row);
  }
  const parsed = parseScheduleWorksheet(rows, weekOf, employees);
  parsed.errors.unshift(...formulaIssues);
  if (formulaIssues.length > 0) parsed.errorRows += 1;
  return parsed;
}
