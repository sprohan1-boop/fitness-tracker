// Loaded on demand (React.lazy) so the chart library isn't part of the app's first download.
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { chartColors, resolvedTheme, usePrefs } from "./prefs";
import { formatNumber } from "./utils";

export default function WeekChart({ days }: { days: { label: string; calories: number }[] }) {
  const colors = chartColors(resolvedTheme(usePrefs().theme));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={days} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={colors.grid} strokeDasharray="3 5" />
        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: colors.muted, fontSize: 11 }} dy={9} />
        <Tooltip
          cursor={{ fill: colors.cursor }}
          contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 12, color: colors.tooltipText, fontSize: 12 }}
          formatter={(value) => [`${formatNumber(Number(value))} kcal`, "Food"]}
          labelStyle={{ color: colors.tooltipLabel, marginBottom: 4 }}
        />
        <Bar dataKey="calories" fill={colors.lime} radius={[5, 5, 0, 0]} maxBarSize={23} />
      </BarChart>
    </ResponsiveContainer>
  );
}
