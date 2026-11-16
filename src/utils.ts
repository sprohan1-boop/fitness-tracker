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

/** Hours slept between "HH:MM" bed and wake times (crossing midnight is handled). */
export function sleepHours(bed: string, wake: string): number {
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  let span = minutes(wake) - minutes(bed);
  if (span <= 0) span += 24 * 60;
  return span / 60;
}

/** 7.25 -> "7h 15m"; 8 -> "8h". */
export function formatHours(hours: number): string {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  if (minutes === 60) return `${whole + 1}h`;
  return minutes ? `${whole}h ${minutes}m` : `${whole}h`;
}

/** "0.5 breast" (86 g) -> "1 breast" (172 g): portions in whole units read better as "2 × breast". */
export function normalizeServing<T extends { label: string; grams: number }>(serving: T): T {
  const match = serving.label.match(/^(\d+(?:\.\d+)?|\d+\/\d+)\s+(.*)$/);
  if (!match) return serving;
  const amount = match[1].includes("/") ? Number(match[1].split("/")[0]) / Number(match[1].split("/")[1]) : Number(match[1]);
  if (!amount || amount === 1) return serving;
  return { ...serving, label: `1 ${match[2]}`.slice(0, 40), grams: Math.round((serving.grams / amount) * 10) / 10 };
}
