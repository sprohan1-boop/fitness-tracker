import { Dumbbell, Flame, Scale, Trash2, TrendingDown, TrendingUp, Trophy, Utensils } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "./api";
import type { BodyWeight, ExercisePoint, ExerciseSummary, Trends } from "./types";
import { addDays, dateLabel, formatNumber, localDate, shortDate } from "./utils";

const COLORS = { lime: "#C4F36A", mint: "#8BE0B0", amber: "#FCD34D", grid: "#2C3530", muted: "#87938C" };
const AXIS_TICK = { fill: COLORS.muted, fontSize: 10 };
const TOOLTIP_STYLE = { background: "#202824", border: "1px solid #35413A", borderRadius: 12, color: "#F5F7F2", fontSize: 12 };
const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

export function ProgressPage({ onError }: { onError: (message: string) => void }) {
  const [range, setRange] = useState<Range>(30);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [weights, setWeights] = useState<BodyWeight[]>([]);
  const [exercises, setExercises] = useState<ExerciseSummary[]>([]);

  const load = useCallback(async () => {
    try {
      const [nextTrends, nextWeights, nextExercises] = await Promise.all([api.trends(localDate(), range), api.weights(), api.exercises()]);
      setTrends(nextTrends);
      setWeights(nextWeights);
      setExercises(nextExercises);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not load your progress.");
    }
  }, [range, onError]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="mx-auto max-w-[1050px]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4 sm:mb-6">
        <div className="hidden sm:block">
          <p className="mb-2 text-[10px] font-bold tracking-[.2em] text-lime">YOUR TRENDS</p>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Progress</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted">Averages, streaks, body weight and lifts over time.</p>
        </div>
        <div className="flex w-full rounded-xl border border-line bg-panel p-1 sm:w-auto">
          {RANGES.map((value) => (
            <button key={value} onClick={() => setRange(value)} className={`flex-1 rounded-lg px-3.5 py-1.5 sm:flex-none text-xs font-medium transition ${range === value ? "bg-lime text-night" : "text-muted hover:text-white"}`}>
              {value}D
            </button>
          ))}
        </div>
      </div>

      {trends && <TrendsSection trends={trends} range={range} />}
      <WeightSection weights={weights} range={range} onChanged={load} onError={onError} />
      <ExerciseSection exercises={exercises} />
    </div>
  );
}

// ---------- trends ----------

function TrendsSection({ trends, range }: { trends: Trends; range: Range }) {
  const logged = trends.days.filter((day) => day.logged);
  const avg = (key: "calories" | "protein_g" | "carbohydrates_g" | "fat_g" | "fiber_g") =>
    logged.length ? logged.reduce((sum, day) => sum + day[key], 0) / logged.length : 0;
  const totalWorkouts = trends.days.reduce((sum, day) => sum + day.workouts, 0);
  const calorieTarget = trends.targets.calories;
  const proteinTarget = trends.targets.protein_g;
  const onCalories = calorieTarget ? logged.filter((day) => Math.abs(day.calories - calorieTarget) <= calorieTarget * 0.1).length : null;
  const onProtein = proteinTarget ? logged.filter((day) => day.protein_g >= proteinTarget).length : null;
  const chartData = trends.days.map((day) => ({ ...day, label: shortDate(day.date) }));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Flame size={15} className="text-lime" />} label="Food streak" value={`${trends.food_streak}`} unit={trends.food_streak === 1 ? "day" : "days"} detail="Days in a row with food logged" />
        <StatCard icon={<Dumbbell size={15} className="text-mint" />} label="Workout streak" value={`${trends.workout_week_streak}`} unit={trends.workout_week_streak === 1 ? "week" : "weeks"} detail={trends.targets.workouts_per_week ? `Weeks hitting ${trends.targets.workouts_per_week}+ workouts` : "Weeks with at least 1 workout"} />
        <StatCard icon={<Utensils size={15} className="text-amber-300" />} label="Days logged" value={`${logged.length}`} unit={`/ ${range}`} detail={`Food logged in the last ${range} days`} />
        <StatCard icon={<Dumbbell size={15} className="text-mint" />} label="Workouts" value={formatNumber(totalWorkouts / (range / 7))} unit="/ week" detail={`${totalWorkouts} sessions in ${range} days`} />
      </div>

      <section className="mt-4 rounded-3xl border border-line bg-panel p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div><h3 className="font-semibold">Daily averages</h3><p className="mt-1 text-xs text-muted">Across the {logged.length} days you logged food</p></div>
        </div>
        {logged.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-6 text-center text-xs text-muted">No food logged in this period yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <AverageTile label="Calories" value={avg("calories")} unit="kcal" target={calorieTarget} />
            <AverageTile label="Protein" value={avg("protein_g")} unit="g" target={proteinTarget} />
            <AverageTile label="Carbs" value={avg("carbohydrates_g")} unit="g" target={trends.targets.carbohydrates_g} />
            <AverageTile label="Fat" value={avg("fat_g")} unit="g" target={trends.targets.fat_g} />
            <AverageTile label="Fiber" value={avg("fiber_g")} unit="g" target={trends.targets.fiber_g} />
          </div>
        )}
        {(onCalories !== null || onProtein !== null) && logged.length > 0 && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {onCalories !== null && <Adherence label="Calories within ±10% of target" hit={onCalories} of={logged.length} />}
            {onProtein !== null && <Adherence label="Protein target reached" hit={onProtein} of={logged.length} />}
          </div>
        )}
      </section>

      <section className="mt-4 rounded-3xl border border-line bg-panel p-4 sm:p-6">
        <div className="mb-4"><h3 className="font-semibold">Calories per day</h3><p className="mt-1 text-xs text-muted">{calorieTarget ? `Dashed line: your ${formatNumber(calorieTarget)} kcal target` : "Set a calorie target to see it here"}</p></div>
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={COLORS.grid} strokeDasharray="3 5" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={18} />
              <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} width={48} />
              <Tooltip cursor={{ fill: "rgba(255,255,255,.03)" }} contentStyle={TOOLTIP_STYLE} formatter={(value) => [`${formatNumber(Number(value))} kcal`, "Food"]} />
              {calorieTarget && <ReferenceLine y={calorieTarget} stroke={COLORS.amber} strokeDasharray="5 4" />}
              <Bar dataKey="calories" fill={COLORS.lime} radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </>
  );
}

function StatCard({ icon, label, value, unit, detail }: { icon: ReactNode; label: string; value: string; unit: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted">{icon}{label}</div>
      <p className="mt-3"><span className="text-3xl font-semibold tracking-tight">{value}</span> <span className="text-xs text-muted">{unit}</span></p>
      <p className="mt-1 text-[10px] leading-4 text-muted">{detail}</p>
    </div>
  );
}

function AverageTile({ label, value, unit, target }: { label: string; value: number; unit: string; target: number | null }) {
  const percent = target ? Math.round((value / target) * 100) : null;
  return (
    <div className="rounded-2xl bg-night p-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-2"><span className="text-xl font-semibold">{formatNumber(Math.round(value))}</span> <span className="text-[10px] text-muted">{unit}</span></p>
      <p className="mt-0.5 text-[10px] text-muted">{percent === null ? "No target" : `${percent}% of target`}</p>
    </div>
  );
}

function Adherence({ label, hit, of }: { label: string; hit: number; of: number }) {
  const percent = of ? Math.round((hit / of) * 100) : 0;
  return (
    <div className="rounded-2xl bg-night p-3.5">
      <div className="flex items-baseline justify-between gap-2"><span className="text-xs text-muted">{label}</span><span className="text-sm font-semibold">{hit} of {of} days</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel"><div className="h-full rounded-full bg-mint" style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

// ---------- body weight ----------

/** Average of all entries in the 7 days up to each entry: smooths out daily water swings. */
function withTrend(weights: BodyWeight[]) {
  return weights.map((entry) => {
    const from = addDays(entry.date, -6);
    const window = weights.filter((item) => item.date >= from && item.date <= entry.date);
    return { ...entry, label: shortDate(entry.date), trend: window.reduce((sum, item) => sum + item.weight_kg, 0) / window.length };
  });
}

function WeightSection({ weights, range, onChanged, onError }: { weights: BodyWeight[]; range: Range; onChanged: () => Promise<void>; onError: (message: string) => void }) {
  const today = localDate();
  const todays = weights.find((entry) => entry.date === today);
  const [value, setValue] = useState(todays ? String(todays.weight_kg) : "");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);

  const from = addDays(today, -(range - 1));
  // Include the entry just before the range so the line doesn't start mid-air.
  const inRange = useMemo(() => {
    const series = withTrend(weights);
    const firstIndex = series.findIndex((entry) => entry.date >= from);
    return firstIndex < 0 ? [] : series.slice(Math.max(0, firstIndex - 1));
  }, [weights, from]);
  const latest = weights[weights.length - 1];
  const change = inRange.length >= 2 ? inRange[inRange.length - 1].trend - inRange[0].trend : null;

  async function save(event: FormEvent) {
    event.preventDefault();
    const kg = Number(value.replace(",", "."));
    setBusy(true);
    try {
      await api.saveWeight(date, kg);
      await onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Couldn't save your weight.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-3xl border border-line bg-panel p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Scale size={16} className="text-lime" /><h3 className="font-semibold">Body weight</h3></div>
          <p className="mt-1 text-xs text-muted">Weigh in at the same time each day; the trend line smooths daily swings.</p>
        </div>
        {latest && (
          <div className="text-right">
            <p><span className="text-2xl font-semibold">{formatNumber(latest.weight_kg)}</span> <span className="text-xs text-muted">kg</span></p>
            {change !== null && (
              <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-zinc-300">
                {change <= 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
                {change > 0 ? "+" : ""}{formatNumber(change)} kg trend, {range} days
              </p>
            )}
          </div>
        )}
      </div>

      <form onSubmit={save} className="flex flex-wrap items-end gap-2">
        <label className="min-w-[110px] flex-1">
          <span className="mb-1.5 block text-[11px] font-medium text-zinc-300">Weight · kg</span>
          <input type="number" inputMode="decimal" step="0.1" min="20" max="400" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 72.4" className="input-dark" required />
        </label>
        <label className="min-w-[140px] flex-1">
          <span className="mb-1.5 block text-[11px] font-medium text-zinc-300">Date</span>
          <input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="input-dark" />
        </label>
        <button disabled={busy || !value} className="button-primary disabled:opacity-60">{busy ? "Saving…" : weights.some((entry) => entry.date === date) ? "Update" : "Save"}</button>
      </form>

      {inRange.length >= 2 ? (
        <div className="mt-5 h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={inRange} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={COLORS.grid} strokeDasharray="3 5" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={18} />
              <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} width={48} domain={["dataMin - 1", "dataMax + 1"]} tickFormatter={(tick: number) => formatNumber(tick)} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(val, name) => [`${formatNumber(Number(val))} kg`, name === "trend" ? "7-day trend" : "Weigh-in"]} />
              <Line type="monotone" dataKey="weight_kg" stroke={COLORS.muted} strokeWidth={0} dot={{ r: 2.5, fill: COLORS.muted }} isAnimationActive={false} />
              <Line type="monotone" dataKey="trend" stroke={COLORS.lime} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="mt-4 rounded-2xl border border-dashed border-line p-5 text-center text-xs text-muted">{weights.length ? "Log a few more weigh-ins to see your trend." : "Log your first weigh-in to start a trend line."}</p>
      )}

      {weights.length > 0 && (
        <div className="mt-4 divide-y divide-line">
          {[...weights].reverse().slice(0, 5).map((entry) => (
            <div key={entry.id} className="flex items-center justify-between py-2 text-xs">
              <span className="text-muted">{dateLabel(entry.date)}</span>
              <span className="flex items-center gap-2"><b className="font-medium">{formatNumber(entry.weight_kg)} kg</b>
                <button onClick={() => { if (window.confirm(`Delete the ${formatNumber(entry.weight_kg)} kg weigh-in from ${dateLabel(entry.date)}?`)) void api.deleteWeight(entry.id).then(onChanged); }} className="rounded-lg p-1.5 text-muted hover:text-red-300" aria-label={`Delete weigh-in from ${dateLabel(entry.date)}`}><Trash2 size={13} /></button>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- exercise progress ----------

function ExerciseSection({ exercises }: { exercises: ExerciseSummary[] }) {
  const [name, setName] = useState("");
  const [metric, setMetric] = useState<"top" | "volume">("top");
  const [points, setPoints] = useState<ExercisePoint[]>([]);
  const selected = name || exercises[0]?.name || "";

  useEffect(() => {
    if (!selected) return;
    let live = true;
    void api.exerciseProgress(selected).then((next) => { if (live) setPoints(next); });
    return () => { live = false; };
  }, [selected, exercises]);

  if (exercises.length === 0) {
    return (
      <section className="mt-4 rounded-3xl border border-line bg-panel p-4 sm:p-6">
        <div className="flex items-center gap-2"><Trophy size={16} className="text-mint" /><h3 className="font-semibold">Lift progress</h3></div>
        <p className="mt-4 rounded-2xl border border-dashed border-line p-5 text-center text-xs text-muted">Log workouts to see each exercise's progress here.</p>
      </section>
    );
  }

  const best = points.reduce<ExercisePoint | null>((top, point) => (!top || point.top_weight_kg > top.top_weight_kg ? point : top), null);
  const last = points[points.length - 1];
  const chartData = points.map((point) => ({ ...point, label: shortDate(point.date) }));

  return (
    <section className="mt-4 rounded-3xl border border-line bg-panel p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2"><Trophy size={16} className="text-mint" /><h3 className="font-semibold">Lift progress</h3></div>
        <div className="flex rounded-xl border border-line bg-night p-1">
          {(["top", "volume"] as const).map((value) => (
            <button key={value} onClick={() => setMetric(value)} className={`rounded-lg px-3 py-1.5 text-[11px] font-medium ${metric === value ? "bg-mint text-night" : "text-muted"}`}>
              {value === "top" ? "Heaviest set" : "Volume"}
            </button>
          ))}
        </div>
      </div>
      <select value={selected} onChange={(e) => setName(e.target.value)} className="input-dark" aria-label="Exercise">
        {exercises.map((exercise) => <option key={exercise.name} value={exercise.name}>{exercise.name} · {exercise.sessions} {exercise.sessions === 1 ? "session" : "sessions"}</option>)}
      </select>

      {best && last && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-night p-3.5"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Best</p><p className="mt-1.5 text-lg font-semibold">{formatNumber(best.top_weight_kg)} kg <span className="text-xs font-normal text-muted">× {best.reps_at_top}</span></p><p className="text-[10px] text-muted">{dateLabel(best.date)}</p></div>
          <div className="rounded-2xl bg-night p-3.5"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Last session</p><p className="mt-1.5 text-lg font-semibold">{formatNumber(last.top_weight_kg)} kg <span className="text-xs font-normal text-muted">× {last.reps_at_top}</span></p><p className="text-[10px] text-muted">{dateLabel(last.date)} · {last.sets} sets · {formatNumber(last.volume_kg)} kg volume</p></div>
        </div>
      )}

      {points.length >= 2 ? (
        <div className="mt-4 h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={COLORS.grid} strokeDasharray="3 5" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={18} />
              <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} width={48} domain={metric === "top" ? ["dataMin - 5", "dataMax + 5"] : [0, "auto"]} tickFormatter={(tick: number) => formatNumber(tick)} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(val) => [`${formatNumber(Number(val))} kg`, metric === "top" ? "Heaviest set" : "Volume (sets × reps × kg)"]} />
              <Line type="monotone" dataKey={metric === "top" ? "top_weight_kg" : "volume_kg"} stroke={COLORS.mint} strokeWidth={2.5} dot={{ r: 3, fill: COLORS.mint }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="mt-4 rounded-2xl border border-dashed border-line p-5 text-center text-xs text-muted">Log this exercise in one more session to see a chart.</p>
      )}
    </section>
  );
}
