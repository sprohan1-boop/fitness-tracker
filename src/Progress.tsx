import { Dumbbell, Flame, Gauge, Footprints, Moon, Scale, Trash2, TrendingDown, TrendingUp, Trophy, Utensils } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "./api";
import { SwipeToDelete } from "./Swipe";
import { MeasurementsSection } from "./Measurements";
import { MuscleSection } from "./Training";
import { GoalsSection, WeekSummaryView, weekStartOf } from "./Insights";
import { chartColors, fromKg, resolvedTheme, toKg, usePrefs } from "./prefs";
import type { BodyWeight, EnergyEstimate, FitnessGoal, GoalStatus, Muscle, MuscleVolume, WeekSummary, ExercisePoint, ExerciseSummary, Measurement, MeasureKey, Trends } from "./types";
import { addDays, dateLabel, formatHours, formatNumber, localDate, shortDate } from "./utils";

/** Chart colours and styles for the current theme. */
function useChartTheme() {
  const prefs = usePrefs();
  const colors = chartColors(resolvedTheme(prefs.theme));
  return {
    unit: prefs.unit,
    COLORS: colors,
    AXIS_TICK: { fill: colors.muted, fontSize: 10 },
    TOOLTIP_STYLE: { background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 12, color: colors.tooltipText, fontSize: 12 },
  };
}
const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

type UndoableDelete = (action: () => Promise<unknown>, message: string) => Promise<void>;

export function ProgressPage({ version, onError, onUndoableDelete }: { version: number; onError: (message: string) => void; onUndoableDelete: UndoableDelete }) {
  const [range, setRange] = useState<Range>(30);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [weights, setWeights] = useState<BodyWeight[]>([]);
  const [exercises, setExercises] = useState<ExerciseSummary[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [energy, setEnergy] = useState<EnergyEstimate | null>(null);
  const [volume, setVolume] = useState<MuscleVolume | null>(null);
  const [goals, setGoals] = useState<GoalStatus[]>([]);
  const [savingGoal, setSavingGoal] = useState(false);
  const thisWeek = weekStartOf(localDate());
  const [summaryWeek, setSummaryWeek] = useState(addDays(thisWeek, -7)); // last complete week
  const [summary, setSummary] = useState<WeekSummary | null>(null);
  const [savingMeasure, setSavingMeasure] = useState(false);
  const chartTheme = useChartTheme();

  const load = useCallback(async () => {
    try {
      const [nextTrends, nextWeights, nextExercises, nextMeasurements, nextEnergy] = await Promise.all([api.trends(localDate(), range), api.weights(), api.exercises(), api.measurements(), api.energyEstimate(localDate())]);
      setEnergy(nextEnergy);
      setVolume(await api.muscleVolume(localDate(), 7));
      setGoals(await api.goals(localDate()));
      setTrends(nextTrends);
      setWeights(nextWeights);
      setExercises(nextExercises);
      setMeasurements(nextMeasurements);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not load your progress.");
    }
  }, [range, onError, version]); // version: reload after any change elsewhere (e.g. Undo)

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void api.weekSummary(summaryWeek).then(setSummary); }, [summaryWeek, version]);

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

      <GoalsSection
        goals={goals}
        exercises={exercises.map((exercise) => exercise.name)}
        busy={savingGoal}
        onSave={async (body: Omit<FitnessGoal, "id" | "start_value" | "start_date">) => {
          setSavingGoal(true);
          try {
            await api.saveGoal(body, localDate());
            await load();
            return true;
          } catch (cause) {
            onError(cause instanceof Error ? cause.message : "Couldn't save the goal.");
            return false;
          } finally {
            setSavingGoal(false);
          }
        }}
        onDelete={(goal) => void onUndoableDelete(() => api.deleteGoal(goal.id), "Goal deleted.")}
      />
      {summary && <WeekSummaryView summary={summary} canGoForward={summaryWeek < thisWeek} onStep={(weeks) => setSummaryWeek((current) => addDays(current, weeks * 7))} />}
      {trends && <TrendsSection trends={trends} range={range} />}
      <WeightSection weights={weights} range={range} onChanged={load} onError={onError} onDelete={(entry) => void onUndoableDelete(() => api.deleteWeight(entry.id), `Weigh-in from ${dateLabel(entry.date)} deleted.`)} />
      {energy && <EnergySection energy={energy} calorieTarget={trends?.targets.calories ?? null} />}
      {trends && <SleepStepsSection trends={trends} range={range} />}
      <MeasurementsSection
        measurements={measurements}
        range={range}
        theme={chartTheme}
        busy={savingMeasure}
        onSave={async (date: string, values: Record<MeasureKey, number | null>) => {
          setSavingMeasure(true);
          try {
            await api.saveMeasurement(date, values);
            await load();
            return true;
          } catch (cause) {
            onError(cause instanceof Error ? cause.message : "Couldn't save measurements.");
            return false;
          } finally {
            setSavingMeasure(false);
          }
        }}
        onDelete={(entry) => void onUndoableDelete(() => api.deleteMeasurement(entry.id), `Measurements from ${dateLabel(entry.date)} deleted.`)}
      />
      <ExerciseSection exercises={exercises} />
      {volume && (
        <MuscleSection
          volume={volume}
          onAssign={(exercise: string, muscle: Muscle) => void api.setExerciseMuscle(exercise, muscle).then(load).catch(() => onError("Couldn't save that."))}
        />
      )}
    </div>
  );
}

// ---------- trends ----------

// ---------- measured calorie burn ----------

function EnergySection({ energy, calorieTarget }: { energy: EnergyEstimate; calorieTarget: number | null }) {
  const { unit } = usePrefs();
  const perWeek = (kg: number) => `${kg > 0 ? "+" : ""}${formatNumber(Math.round(fromKg(kg, unit) * 100) / 100)} ${unit}/week`;
  return (
    <section className="mt-4 rounded-3xl border border-line bg-panel p-4 sm:p-6">
      <div className="flex items-center gap-2"><Gauge size={16} className="text-lime" /><h3 className="font-semibold">Your real daily burn</h3></div>
      {energy.ready ? (
        <>
          <p className="mt-3"><span className="text-3xl font-semibold tracking-tight">{formatNumber(energy.tdee)}</span> <span className="text-sm text-muted">kcal / day</span></p>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            You ate {formatNumber(energy.intake_avg)} kcal on average while your weight trend was {perWeek(energy.kg_per_week)}, over {energy.days_logged} logged days and {energy.weighins} weigh-ins in the last {energy.window_days} days.
          </p>
          {calorieTarget !== null && (
            <p className="mt-3 rounded-2xl bg-night p-3 text-xs">
              {Math.abs(((calorieTarget - energy.tdee) * 7) / 7700) < 0.05
                ? <>Your {formatNumber(calorieTarget)} kcal target is about maintenance: <b className="font-semibold">expect roughly the same weight</b>.</>
                : <>At your {formatNumber(calorieTarget)} kcal target, expect about <b className="font-semibold">{perWeek(((calorieTarget - energy.tdee) * 7) / 7700)}</b>.</>}
            </p>
          )}
          <p className="mt-2 text-[10px] leading-4 text-muted">Assumes the days you logged are complete. Gets more accurate the more consistently you log food and weigh in.</p>
        </>
      ) : (
        <>
          <p className="mt-2 text-xs leading-5 text-muted">Worked out from what you eat and how your weight changes, which beats any formula. It needs, within the last {energy.window_days} days:</p>
          <div className="mt-3 space-y-2 text-xs">
            <Requirement done={energy.days_logged >= 14} label={`14 days of food logged (${energy.days_logged} so far)`} />
            <Requirement done={energy.weighins >= 2 && energy.weigh_span_days >= 10} label={`Weigh-ins at least 10 days apart (${energy.weighins} weigh-in${energy.weighins === 1 ? "" : "s"}${energy.weighins >= 2 ? `, ${Math.round(energy.weigh_span_days)} days apart` : ""})`} />
          </div>
        </>
      )}
    </section>
  );
}

function Requirement({ done, label }: { done: boolean; label: string }) {
  return (
    <p className="flex items-center gap-2">
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${done ? "bg-lime text-night" : "border border-zinc-500"}`}>{done ? "✓" : ""}</span>
      <span className={done ? "text-zinc-300" : "text-muted"}>{label}</span>
    </p>
  );
}

// ---------- sleep and steps ----------

function SleepStepsSection({ trends, range }: { trends: Trends; range: Range }) {
  const { COLORS, AXIS_TICK, TOOLTIP_STYLE } = useChartTheme();
  const slept = trends.days.filter((day) => day.sleep_h !== null);
  const walked = trends.days.filter((day) => day.steps !== null);
  if (!slept.length && !walked.length) {
    return (
      <section className="mt-4 rounded-3xl border border-line bg-panel p-4 sm:p-6">
        <div className="flex items-center gap-2"><Moon size={16} className="text-violet-300" /><h3 className="font-semibold">Sleep and steps</h3></div>
        <p className="mt-4 rounded-2xl border border-dashed border-line p-5 text-center text-xs text-muted">Log sleep and steps on the dashboard to see trends here.</p>
      </section>
    );
  }
  const avgSleep = slept.length ? slept.reduce((sum, day) => sum + (day.sleep_h ?? 0), 0) / slept.length : null;
  const avgSteps = walked.length ? walked.reduce((sum, day) => sum + (day.steps ?? 0), 0) / walked.length : null;
  const stepTarget = trends.targets.steps;
  const data = trends.days.map((day) => ({ label: shortDate(day.date), sleep: day.sleep_h, steps: day.steps }));
  const chart = (key: "sleep" | "steps", color: string, unitLabel: string, reference: number | null) => (
    <div className="mt-3 h-[150px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={COLORS.grid} strokeDasharray="3 5" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={18} />
          <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} width={44} tickFormatter={(tick: number) => formatNumber(tick)} />
          <Tooltip cursor={{ fill: COLORS.cursor }} contentStyle={TOOLTIP_STYLE} formatter={(val) => [key === "sleep" ? formatHours(Number(val)) : `${formatNumber(Number(val))} ${unitLabel}`, key === "sleep" ? "Sleep" : "Steps"]} />
          {reference !== null && <ReferenceLine y={reference} stroke={COLORS.amber} strokeDasharray="5 4" />}
          <Bar dataKey={key} fill={color} radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
  return (
    <section className="mt-4 rounded-3xl border border-line bg-panel p-4 sm:p-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-center gap-2"><Moon size={16} className="text-violet-300" /><h3 className="font-semibold">Sleep</h3></div>
            <p className="text-xs text-muted">{avgSleep === null ? "No nights logged" : <><b className="text-sm font-semibold text-white">{formatHours(avgSleep)}</b> average · {slept.length}/{range} nights</>}</p>
          </div>
          {slept.length > 0 && chart("sleep", COLORS.violet, "h", 8)}
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-center gap-2"><Footprints size={16} className="text-sky-300" /><h3 className="font-semibold">Steps</h3></div>
            <p className="text-xs text-muted">{avgSteps === null ? "No days logged" : <><b className="text-sm font-semibold text-white">{formatNumber(Math.round(avgSteps))}</b> average{stepTarget ? ` · target ${formatNumber(stepTarget)}` : ""}</>}</p>
          </div>
          {walked.length > 0 && chart("steps", COLORS.sky, "steps", stepTarget)}
        </div>
      </div>
    </section>
  );
}

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
  const { COLORS, AXIS_TICK, TOOLTIP_STYLE } = useChartTheme();

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
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
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
              <Tooltip cursor={{ fill: COLORS.cursor }} contentStyle={TOOLTIP_STYLE} formatter={(value) => [`${formatNumber(Number(value))} kcal`, "Food"]} />
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

function WeightSection({ weights, range, onChanged, onError, onDelete }: { weights: BodyWeight[]; range: Range; onChanged: () => Promise<void>; onError: (message: string) => void; onDelete: (entry: BodyWeight) => void }) {
  const today = localDate();
  const { unit, COLORS, AXIS_TICK, TOOLTIP_STYLE } = useChartTheme();
  const [value, setValue] = useState("");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);

  const from = addDays(today, -(range - 1));
  // Include the entry just before the range so the line doesn't start mid-air.
  const inRange = useMemo(() => {
    // Shown in the chosen unit; stored in kg.
    const series = withTrend(weights).map((entry) => ({ ...entry, weight_kg: fromKg(entry.weight_kg, unit), trend: fromKg(entry.trend, unit) }));
    const firstIndex = series.findIndex((entry) => entry.date >= from);
    return firstIndex < 0 ? [] : series.slice(Math.max(0, firstIndex - 1));
  }, [weights, from, unit]);
  const latest = weights[weights.length - 1];
  const change = inRange.length >= 2 ? inRange[inRange.length - 1].trend - inRange[0].trend : null;

  async function save(event: FormEvent) {
    event.preventDefault();
    const kg = toKg(Number(value.replace(",", ".")), unit);
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
            <p><span className="text-2xl font-semibold">{formatNumber(fromKg(latest.weight_kg, unit))}</span> <span className="text-xs text-muted">{unit}</span></p>
            {change !== null && (
              <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-zinc-300">
                {change <= 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
                {change > 0 ? "+" : ""}{formatNumber(change)} {unit} trend, {range} days
              </p>
            )}
          </div>
        )}
      </div>

      <form onSubmit={save} className="flex flex-wrap items-end gap-2">
        <label className="min-w-[110px] flex-1">
          <span className="mb-1.5 block text-[11px] font-medium text-zinc-300">Weight · {unit}</span>
          <input type="number" inputMode="decimal" step="0.1" min="0" value={value} onChange={(e) => setValue(e.target.value)} placeholder={unit === "lb" ? "e.g. 160.2" : "e.g. 72.4"} className="input-dark" required />
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
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(val, name) => [`${formatNumber(Number(val))} ${unit}`, name === "trend" ? "7-day trend" : "Weigh-in"]} />
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
            <SwipeToDelete key={entry.id} onDelete={() => onDelete(entry)}>
              <div className="flex items-center justify-between py-2 text-xs">
                <span className="text-muted">{dateLabel(entry.date)}</span>
                <span className="flex items-center gap-2"><b className="font-medium">{formatNumber(fromKg(entry.weight_kg, unit))} {unit}</b>
                  <button onClick={() => onDelete(entry)} className="hidden rounded-lg p-1.5 text-muted hover:text-red-300 lg:block" aria-label={`Delete weigh-in from ${dateLabel(entry.date)}`}><Trash2 size={13} /></button>
                </span>
              </div>
            </SwipeToDelete>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- exercise progress ----------

function ExerciseSection({ exercises }: { exercises: ExerciseSummary[] }) {
  const [name, setName] = useState("");
  const [metric, setMetric] = useState<"top" | "e1rm" | "volume">("top");
  const [points, setPoints] = useState<ExercisePoint[]>([]);
  const { unit, COLORS, AXIS_TICK, TOOLTIP_STYLE } = useChartTheme();
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
  const chartData = points.map((point) => ({ ...point, label: shortDate(point.date), top_weight_kg: fromKg(point.top_weight_kg, unit), volume_kg: fromKg(point.volume_kg, unit), e1rm_kg: point.e1rm_kg === null ? null : fromKg(point.e1rm_kg, unit) }));
  const bestE1rm = points.reduce<number | null>((top, point) => (point.e1rm_kg !== null && (top === null || point.e1rm_kg > top) ? point.e1rm_kg : top), null);
  const METRIC = { top: { key: "top_weight_kg", label: "Heaviest set" }, e1rm: { key: "e1rm_kg", label: "Est. 1RM" }, volume: { key: "volume_kg", label: `Volume (sets × reps × ${unit})` } } as const;

  return (
    <section className="mt-4 rounded-3xl border border-line bg-panel p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2"><Trophy size={16} className="text-mint" /><h3 className="font-semibold">Lift progress</h3></div>
        <div className="flex rounded-xl border border-line bg-night p-1">
          {(["top", "e1rm", "volume"] as const).map((value) => (
            <button key={value} onClick={() => setMetric(value)} className={`rounded-lg px-3 py-1.5 text-[11px] font-medium ${metric === value ? "bg-mint text-night" : "text-muted"}`}>
              {value === "top" ? "Heaviest" : value === "e1rm" ? "1RM" : "Volume"}
            </button>
          ))}
        </div>
      </div>
      <select value={selected} onChange={(e) => setName(e.target.value)} className="input-dark" aria-label="Exercise">
        {exercises.map((exercise) => <option key={exercise.name} value={exercise.name}>{exercise.name} · {exercise.sessions} {exercise.sessions === 1 ? "session" : "sessions"}</option>)}
      </select>

      {best && last && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-night p-3.5"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Best</p><p className="mt-1.5 text-lg font-semibold">{formatNumber(fromKg(best.top_weight_kg, unit))} {unit} <span className="text-xs font-normal text-muted">× {best.reps_at_top}</span></p><p className="text-[10px] text-muted">{dateLabel(best.date)}{bestE1rm !== null ? ` · est. 1RM ${formatNumber(fromKg(bestE1rm, unit))} ${unit}` : ""}</p></div>
          <div className="rounded-2xl bg-night p-3.5"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Last session</p><p className="mt-1.5 text-lg font-semibold">{formatNumber(fromKg(last.top_weight_kg, unit))} {unit} <span className="text-xs font-normal text-muted">× {last.reps_at_top}</span></p><p className="text-[10px] text-muted">{dateLabel(last.date)} · {last.sets} sets · {formatNumber(fromKg(last.volume_kg, unit))} {unit} volume</p></div>
        </div>
      )}

      {points.length >= 2 ? (
        <div className="mt-4 h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={COLORS.grid} strokeDasharray="3 5" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={18} />
              <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} width={48} domain={metric === "volume" ? [0, "auto"] : ["dataMin - 5", "dataMax + 5"]} tickFormatter={(tick: number) => formatNumber(tick)} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(val) => [`${formatNumber(Number(val))} ${unit}`, METRIC[metric].label]} />
              <Line type="monotone" dataKey={METRIC[metric].key} connectNulls stroke={COLORS.mint} strokeWidth={2.5} dot={{ r: 3, fill: COLORS.mint }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="mt-4 rounded-2xl border border-dashed border-line p-5 text-center text-xs text-muted">Log this exercise in one more session to see a chart.</p>
      )}
    </section>
  );
}
