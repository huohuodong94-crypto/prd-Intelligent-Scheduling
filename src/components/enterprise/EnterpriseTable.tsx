import type { ReactNode } from "react";

export type EnterpriseColumn<T> = {
  key: keyof T | string;
  title: string;
  width?: number;
  render?: (row: T) => ReactNode;
};

export type EnterpriseTableProps<T> = {
  columns: readonly EnterpriseColumn<T>[];
  rows: readonly T[];
  getRowKey?: (row: T, index: number) => string | number;
  emptyText?: string;
};

function renderValue<T>(row: T, key: keyof T | string): ReactNode {
  const value = (row as Record<string, unknown>)[String(key)];
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number") return value;
  return String(value);
}

export default function EnterpriseTable<T>({
  columns,
  rows,
  getRowKey,
  emptyText = "暂无数据",
}: EnterpriseTableProps<T>) {
  return (
    <div className="thin-scroll overflow-x-auto border" style={{ borderColor: "var(--border)" }}>
      <table className="enterprise-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={String(column.key)} style={column.width ? { width: column.width } : undefined}>
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-center text-[var(--text-muted)]">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={getRowKey?.(row, rowIndex) ?? rowIndex}>
                {columns.map((column) => (
                  <td key={String(column.key)}>
                    {column.render ? column.render(row) : renderValue(row, column.key)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
