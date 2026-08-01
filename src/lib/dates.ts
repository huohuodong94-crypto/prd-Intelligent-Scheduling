// 周相关的日期工具。weekOf 统一用该周周一的 YYYY-MM-DD 表示。

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 给定任意日期字符串，返回其所在周的周一日期字符串
export function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const dow = d.getDay(); // 0=周日..6=周六
  const diff = dow === 0 ? -6 : 1 - dow; // 周日回退到上周一
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}

// 从周一开始的 7 天日期字符串
export function weekDays(weekOf: string): string[] {
  const start = new Date(weekOf + "T00:00:00");
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(toDateStr(d));
  }
  return days;
}

// 上一周的 weekOf（周一日期减 7 天）
export function previousWeekOf(weekOf: string): string {
  const d = new Date(weekOf + "T00:00:00");
  d.setDate(d.getDate() - 7);
  return toDateStr(d);
}

export const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function currentMonday(): string {
  return mondayOf(toDateStr(new Date()));
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_ONLY = /^\d{4}-(0[1-9]|1[0-2])$/;

export function shanghaiDateOnly(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function shanghaiDateValue(value: string): Date {
  if (!DATE_ONLY.test(value)) throw new Error("invalid Shanghai date");
  const parsed = new Date(`${value}T00:00:00+08:00`);
  if (!Number.isFinite(parsed.getTime()) || shanghaiDateOnly(parsed) !== value) throw new Error("invalid Shanghai date");
  return parsed;
}

export function shanghaiMonthBounds(month: string): { start: Date; end: Date } {
  if (!MONTH_ONLY.test(month)) throw new Error("invalid Shanghai month");
  const [year, monthNumber] = month.split("-").map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return {
    start: new Date(`${month}-01T00:00:00+08:00`),
    end: new Date(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+08:00`),
  };
}

export function shanghaiMonthForInstant(value: Date): string {
  return shanghaiDateOnly(value).slice(0, 7);
}
