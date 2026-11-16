// Body measurements section of the Progress tab (lazy-loaded with it, as it uses charts).
import { Plus, Ruler, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fromCm, lengthUnit, toCm, usePrefs } from "./prefs";
import { SwipeToDelete } from "./Swipe";
import type { Measurement, MeasureKey } from "./types";
import { Field } from "./ui";
import { addDays, dateLabel, formatNumber, localDate, shortDate } from "./utils";

const card = "rounded-3xl border border-line bg-panel p-4 sm:p-6";

const MEASURES: { key: MeasureKey; label: string; length: boolean }[] = [
  { key: "waist_cm", label: "Waist", length: true },
  { key: "hips_cm", label: "Hips", length: true },
  { key: "chest_cm", label: "Chest", length: true },
  { key: "arm_cm", label: "Arm", length: true },
  { key: "thigh_cm", label: "Thigh", length: true },
  { key: "body_fat_pct", label: "Body fat", length: false },
];

type ChartTheme = { COLORS: { mint: string; grid: string; muted: string }; AXIS_TICK: object; TOOLTIP_STYLE: object };

export function MeasurementsSection({ measurements, range, theme, busy, onSave, onDelete }: {
  measurements: Measurement[];
  range: number;
  theme: ChartTheme;
  busy: boolean;
  onSave: (date: string, values: Record<MeasureKey, number | null>) => Promise<boolean>;
  onDelete: (entry: Measurement) => void;
}) {
  const { unit } = usePrefs();
  const len = lengthUnit(unit);
  const today = localDate();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [values, setValues] = useState<Record<MeasureKey, string>>({ waist_cm: "", hips_cm: "", chest_cm: "", arm_cm: "", thigh_cm: "", body_fat_pct: "" });
  const [metric, setMetric] = useState<MeasureKey>("waist_cm");
  const show = (key: MeasureKey, value: number) => (key === "body_fat_pct" ? value : fromCm(value, unit));
  const suffix = (key: MeasureKey) => (key === "body_fat_pct" ? "%" : len);

  function startEntry() {
    // Pre-fill with the latest values so only what changed needs editing.
    const latest = measurements[measurements.length - 1];
    const next = {} as Record<MeasureKey, string>;
    for (const { key } of MEASURES) next[key] = latest?.[key] != null ? String(show(key, latest[key] as number)) : "";
    setValues(next);
    setDate(today);
    setOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const out = {} as Record<MeasureKey, number | null>;
    for (const { key } of MEASURES) {
      const text = values[key].trim();
      out[key] = text === "" ? null : key === "body_fat_pct" ? Number(text) : toCm(Number(text), unit);
    }
    if (await onSave(date, out)) setOpen(false);
  }

  const from = addDays(today, -(range - 1));
  const series = useMemo(() => measurements.filter((entry) => entry[metric] != null).map((entry) => ({ date: entry.date, label: shortDate(entry.date), value: show(metric, entry[metric] as number) })),
    [measurements, metric, unit]);
  const inRange = series.filter((point) => point.date >= from);
  const latest = measurements[measurements.length - 1];

  return (
    <section className={`mt-4 ${card}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Ruler size={16} className="text-mint" /><h3 className="font-semibold">Body measurements</h3></div>
          <p className="mt-1 text-xs text-muted">Measure every week or two, same time of day.</p>
        </div>
        {!open && <button onClick={startEntry} className="button-secondary !min-h-9 !px-3"><Plus size={14} /> Measure</button>}
      </div>

      {open && (
        <form onSubmit={save} className="mb-4 space-y-3 rounded-2xl bg-night p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {MEASURES.map(({ key, label }) => (
              <Field key={key} label={`${label} · ${suffix(key)}`}>
                <input type="number" inputMode="decimal" min="0" step="0.1" value={values[key]} onChange={(e) => setValues((current) => ({ ...current, [key]: e.target.value }))} placeholder="—" className="input-dark" />
              </Field>
            ))}
          </div>
          <Field label="Date"><input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="input-dark" /></Field>
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="button-secondary">Cancel</button>
            <button disabled={busy} className="button-primary flex-1 disabled:opacity-60">{busy ? "Saving…" : "Save measurements"}</button>
          </div>
        </form>
      )}

      {measurements.length === 0 ? (
        !open && <p className="rounded-2xl border border-dashed border-line p-5 text-center text-xs text-muted">No measurements yet. Tap Measure to add waist, hips, chest, arm, thigh or body fat.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {MEASURES.map(({ key, label }) => {
              const latestValue = latest?.[key] != null ? show(key, latest[key] as number) : null;
              const firstInRange = measurements.find((entry) => entry.date >= from && entry[key] != null);
              const change = latestValue !== null && firstInRange && firstInRange !== latest ? latestValue - show(key, firstInRange[key] as number) : null;
              return (
                <button key={key} onClick={() => setMetric(key)} disabled={!measurements.some((entry) => entry[key] != null)} className={`rounded-2xl p-3 text-left transition disabled:opacity-50 ${metric === key ? "bg-mint/10 ring-1 ring-mint/40" : "bg-night"}`}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
                  <p className="mt-1 text-base font-semibold">{latestValue === null ? "—" : formatNumber(latestValue)}<span className="text-[10px] font-normal text-muted"> {suffix(key)}</span></p>
                  {change !== null && Math.abs(change) >= 0.05 && <p className="text-[10px] text-zinc-300">{change > 0 ? "+" : ""}{formatNumber(change)} in {range}d</p>}
                </button>
              );
            })}
          </div>
          {inRange.length >= 2 ? (
            <div className="mt-4 h-[180px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={inRange} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={theme.COLORS.grid} strokeDasharray="3 5" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={theme.AXIS_TICK} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis axisLine={false} tickLine={false} tick={theme.AXIS_TICK} width={44} domain={["dataMin - 1", "dataMax + 1"]} tickFormatter={(tick: number) => formatNumber(tick)} />
                  <Tooltip contentStyle={theme.TOOLTIP_STYLE} formatter={(val) => [`${formatNumber(Number(val))} ${suffix(metric)}`, MEASURES.find((item) => item.key === metric)?.label]} />
                  <Line type="monotone" dataKey="value" stroke={theme.COLORS.mint} strokeWidth={2.5} dot={{ r: 3, fill: theme.COLORS.mint }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-4 text-center text-[11px] text-muted">Tap a measurement above; its chart appears once there are two entries in this period.</p>
          )}
          <div className="mt-3 divide-y divide-line">
            {[...measurements].reverse().slice(0, 4).map((entry) => (
              <SwipeToDelete key={entry.id} onDelete={() => onDelete(entry)}>
                <div className="flex items-center justify-between gap-2 py-2 text-xs">
                  <span className="shrink-0 text-muted">{dateLabel(entry.date)}</span>
                  <span className="truncate text-right text-[11px] text-zinc-300">
                    {MEASURES.filter(({ key }) => entry[key] != null).map(({ key, label }) => `${label} ${formatNumber(show(key, entry[key] as number))}${key === "body_fat_pct" ? "%" : ""}`).join(" · ")}
                  </span>
                  <button onClick={() => onDelete(entry)} className="hidden rounded-lg p-1.5 text-muted hover:text-red-300 lg:block" aria-label={`Delete measurements from ${dateLabel(entry.date)}`}><Trash2 size={13} /></button>
                </div>
              </SwipeToDelete>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
