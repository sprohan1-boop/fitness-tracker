// Shared date and number helpers. Dates are local YYYY-MM-DD strings.

export function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function dateLabel(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Compact label for chart axes, e.g. "Nov 12". */
export function shortDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}
