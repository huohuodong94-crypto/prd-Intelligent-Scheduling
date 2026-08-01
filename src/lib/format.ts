const hoursFormatter = new Intl.NumberFormat("zh-CN", {
  useGrouping: false,
  maximumFractionDigits: 2,
});

export function formatHours(value: number): string {
  const compact = hoursFormatter.format(Object.is(value, -0) ? 0 : value);
  return `${compact === "-0" ? "0" : compact} h`;
}
