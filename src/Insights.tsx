// Batch D: weekly summary and goals with projections.
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Flag, PartyPopper, Plus, Trash2, Trophy, X } from "lucide-react";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { distanceUnit, fromCm, fromKg, fromKm, lengthUnit, toCm, toKg, usePrefs } from "./prefs";
import { SwipeToDelete } from "./Swipe";
import type { FitnessGoal, GoalStatus, MeasureKey, WeekSummary } from "./types";
import { Field, FormError } from "./ui";
import { addDays, dateLabel, formatHours, formatNumber, localDate, shortDate } from "./utils";
import type { Unit } from "./prefs";

/** Monday of the week containing `date`. */
export function weekStartOf(date: string): string {
  const day = (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
  return addDays(date, -day);
}

const weekLabel = (summary: WeekSummary) => `${shortDate(summary.start)} – ${shortDate(summary.end)}`;

/** Small "+3% / −0.4" style comparison with the previous week. */
function Delta({ now, before, unit = "", decimals = 0, invert = false }: { now: number | null; before: number | null; unit?: string; decimals?: number; invert?: boolean }) {
  if (now === null || before === null) return null;
  const diff = now - before;
  const rounded = Math.round(diff * 10 ** decimals) / 10 ** decimals;
  if (rounded === 0) return <span className="text-[10px] text-muted">same as last week</span>;
  const good = invert ? diff < 0 : diff > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] ${good ? "text-mint" : "text-zinc-300"}`}>
      {diff > 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {diff > 0 ? "+" : ""}{formatNumber(rounded)}{unit} vs last week
    </span>
  );
}

function Stat({ label, value, extra }: { label: string; value: string; extra?: ReactNode }) {
  return (
    <div className="rounded-2xl bg-night p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 text-base font-semibold">{value}</p>
      {extra && <div className="mt-0.5">{extra}</div>}
    </div>
  );
}

const weightText = (kg: number | null, unit: Unit) => (kg === null ? "—" : `${formatNumber(fromKg(kg, unit))} ${unit}`);

// ---------- weekly summary ----------

/** Dashboard card for last week; dismissible. */
export function WeekSummaryCard({ summary, onOpen, onDismiss }: { summary: WeekSummary; onOpen: () => void; onDismiss: () => void }) {
  const { unit } = usePrefs();
  const sessions = summary.training.strength + summary.training.cardio;
  return (
    <section className="mb-4 rounded-3xl border border-lime/30 bg-lime/5 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold tracking-[.18em] text-lime">YOUR WEEK IN REVIEW</p>
          <h3 className="mt-1 font-semibold">{weekLabel(summary)}</h3>
        </div>
        <button onClick={onDismiss} className="rounded-xl border border-line p-2 text-muted" aria-label="Dismiss weekly summary"><X size={14} /></button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat label="Avg calories" value={summary.food.calories_avg === null ? "—" : `${formatNumber(Math.round(summary.food.calories_avg))} kcal`} extra={<Delta now={summary.current.calories_avg} before={summary.previous.calories_avg} />} />
        <Stat label="Sessions" value={`${sessions}${summary.training.target ? ` / ${summary.training.target}` : ""}`} extra={<Delta now={summary.current.sessions} before={summary.previous.sessions} />} />
        <Stat label="Weight change" value={summary.body.weight_change === null ? "—" : `${summary.body.weight_change > 0 ? "+" : ""}${formatNumber(Math.round(fromKg(summary.body.weight_change, unit) * 10) / 10)} ${unit}`} extra={<span className="text-[10px] text-muted">week average vs week before</span>} />
        <Stat label="Sleep" value={summary.body.sleep_avg_h === null ? "—" : formatHours(summary.body.sleep_avg_h)} extra={<span className="text-[10px] text-muted">{summary.body.nights} nights logged</span>} />
      </div>
      {summary.training.new_bests.length > 0 && (
        <p className="mt-3 flex items-start gap-2 text-xs"><Trophy size={14} className="mt-0.5 shrink-0 text-amber-300" /><span>New bests: {summary.training.new_bests.map((best) => `${best.exercise} ${weightText(best.weight_kg, unit)}`).join(" · ")}</span></p>
      )}
      <button onClick={onOpen} className="mt-3 text-xs font-semibold text-lime">See the full summary →</button>
    </section>
  );
}

/** Progress tab: full summary for any past week. */
export function WeekSummaryView({ summary, onStep, canGoForward }: { summary: WeekSummary; onStep: (weeks: number) => void; canGoForward: boolean }) {
  const { unit } = usePrefs();
  const dist = distanceUnit(unit);
  const { food, training, body, habits } = summary;
  return (
    <section className="mt-4 rounded-3xl border border-line bg-panel p-4 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => onStep(-1)} className="rounded-xl p-2 text-muted" aria-label="Previous week"><ChevronLeft size={18} /></button>
        <div className="text-center"><h3 className="font-semibold">Weekly summary</h3><p className="text-[11px] text-muted">{weekLabel(summary)}</p></div>
        <button onClick={() => onStep(1)} disabled={!canGoForward} className="rounded-xl p-2 text-muted disabled:opacity-30" aria-label="Next week"><ChevronRight size={18} /></button>
      </div>
      {!summary.has_data ? (
        <p className="mt-4 rounded-2xl border border-dashed border-line p-5 text-center text-xs text-muted">Nothing logged that week.</p>
      ) : (
        <div className="mt-4 space-y-4 text-xs">
          <SummaryBlock title="Food">
            <Stat label="Days logged" value={`${food.days_logged} / 7`} />
            <Stat label="Avg calories" value={food.calories_avg === null ? "—" : `${formatNumber(Math.round(food.calories_avg))}`} extra={<Delta now={summary.current.calories_avg} before={summary.previous.calories_avg} />} />
            <Stat label="Avg protein" value={food.protein_avg === null ? "—" : `${formatNumber(Math.round(food.protein_avg))} g`} extra={<Delta now={summary.current.protein_avg} before={summary.previous.protein_avg} unit=" g" />} />
            <Stat label="On calorie target" value={food.days_on_target === null ? "No target" : `${food.days_on_target} days`} extra={food.calorie_target ? <span className="text-[10px] text-muted">within ±10% of {formatNumber(food.calorie_target)}</span> : undefined} />
          </SummaryBlock>
          <SummaryBlock title="Training">
            <Stat label="Sessions" value={`${training.strength + training.cardio}${training.target ? ` / ${training.target}` : ""}`} extra={<span className="text-[10px] text-muted">{training.strength} strength · {training.cardio} cardio</span>} />
            <Stat label="Strength sets" value={`${training.sets}`} />
            <Stat label="Cardio" value={`${training.cardio_minutes} min`} extra={training.cardio_km > 0 ? <span className="text-[10px] text-muted">{formatNumber(fromKm(training.cardio_km, unit))} {dist}</span> : undefined} />
            <Stat label="New bests" value={`${training.new_bests.length}`} extra={training.new_bests.length ? <span className="text-[10px] text-muted">{training.new_bests.map((best) => `${best.exercise} ${weightText(best.weight_kg, unit)}`).join(" · ")}</span> : undefined} />
          </SummaryBlock>
          <SummaryBlock title="Body and habits">
            <Stat label="Weight (avg)" value={weightText(body.weight_avg, unit)} extra={body.weight_change !== null ? <span className="text-[10px] text-muted">{body.weight_change > 0 ? "+" : ""}{formatNumber(Math.round(fromKg(body.weight_change, unit) * 10) / 10)} {unit} vs week before</span> : undefined} />
            <Stat label="Sleep (avg)" value={body.sleep_avg_h === null ? "—" : formatHours(body.sleep_avg_h)} extra={<Delta now={summary.current.sleep_avg_h} before={summary.previous.sleep_avg_h} unit="h" decimals={1} />} />
            <Stat label="Steps (avg)" value={body.steps_avg === null ? "—" : formatNumber(Math.round(body.steps_avg))} extra={<Delta now={summary.current.steps_avg} before={summary.previous.steps_avg} />} />
            <Stat label="Habits" value={habits.possible ? `${Math.round((habits.done / habits.possible) * 100)}%` : "—"} extra={habits.possible ? <span className="text-[10px] text-muted">{habits.done} of {habits.possible} ticks</span> : undefined} />
          </SummaryBlock>
        </div>
      )}
    </section>
  );
}

function SummaryBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[.16em] text-muted">{title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{children}</div>
    </div>
  );
}

// ---------- goals ----------

const MEASURE_LABELS: Record<MeasureKey, string> = { waist_cm: "Waist", hips_cm: "Hips", chest_cm: "Chest", arm_cm: "Arm", thigh_cm: "Thigh", body_fat_pct: "Body fat" };

function goalUnit(goal: Pick<FitnessGoal, "kind" | "measure">, unit: Unit) {
  if (goal.kind === "measure") return goal.measure === "body_fat_pct" ? "%" : lengthUnit(unit);
  return unit;
}
function toDisplay(goal: Pick<FitnessGoal, "kind" | "measure">, value: number, unit: Unit) {
  if (goal.kind === "measure") return goal.measure === "body_fat_pct" ? value : fromCm(value, unit);
  return fromKg(value, unit);
}
function fromDisplay(goal: Pick<FitnessGoal, "kind" | "measure">, value: number, unit: Unit) {
  if (goal.kind === "measure") return goal.measure === "body_fat_pct" ? value : toCm(value, unit);
  return toKg(value, unit);
}
const goalTitle = (goal: FitnessGoal) => (goal.kind === "weight" ? "Body weight" : goal.kind === "lift" ? goal.exercise ?? "Lift" : MEASURE_LABELS[goal.measure as MeasureKey] ?? "Measurement");

export function GoalsSection({ goals, exercises, busy, onSave, onDelete }: {
  goals: GoalStatus[];
  exercises: string[];
  busy: boolean;
  onSave: (body: Omit<FitnessGoal, "id" | "start_value" | "start_date">) => Promise<boolean>;
  onDelete: (goal: FitnessGoal) => void;
}) {
  const { unit } = usePrefs();
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-4 rounded-3xl border border-line bg-panel p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Flag size={16} className="text-lime" /><h3 className="font-semibold">Goals</h3></div>
          <p className="mt-1 text-xs text-muted">Projections use your trend over the last 6 weeks.</p>
        </div>
        {!open && <button onClick={() => setOpen(true)} className="button-secondary !min-h-9 !px-3"><Plus size={14} /> Goal</button>}
      </div>
      {open && <GoalForm exercises={exercises} busy={busy} onCancel={() => setOpen(false)} onSave={async (body) => { if (await onSave(body)) setOpen(false); }} />}
      {goals.length === 0 && !open ? (
        <p className="mt-4 rounded-2xl border border-dashed border-line p-5 text-center text-xs text-muted">Set a goal for body weight, a lift or a measurement, e.g. "75 kg by March" or "Bench 100 kg".</p>
      ) : (
        <div className="mt-4 space-y-2">
          {goals.map((status) => <GoalCard key={status.goal.id} status={status} unit={unit} onDelete={() => onDelete(status.goal)} />)}
        </div>
      )}
    </section>
  );
}

function GoalCard({ status, unit, onDelete }: { status: GoalStatus; unit: Unit; onDelete: () => void }) {
  const { goal } = status;
  const u = goalUnit(goal, unit);
  const show = (value: number) => `${formatNumber(Math.round(toDisplay(goal, value, unit) * 10) / 10)} ${u}`;
  const perWeek = status.per_week === null ? "" : `${status.per_week > 0 ? "+" : ""}${formatNumber(Math.round(toDisplay(goal, status.per_week, unit) * 100) / 100)} ${u}/week`;
  const message: Record<GoalStatus["status"], ReactNode> = {
    reached: <span className="flex items-center gap-1.5 font-semibold text-lime"><PartyPopper size={14} /> Goal reached!</span>,
    on_track: <span className="text-mint">On track: about <b>{dateLabel(status.projected_date!)}</b> at {perWeek}{goal.deadline ? ` (deadline ${dateLabel(goal.deadline)})` : ""}</span>,
    behind: <span className="text-amber-300">At {perWeek}: about <b>{dateLabel(status.projected_date!)}</b>, after your {dateLabel(goal.deadline!)} deadline</span>,
    away: <span className="text-amber-300">Your trend is moving away from this goal ({perWeek})</span>,
    no_trend: <span className="text-muted">Keep logging. A projection needs 2+ entries spread over at least a week.</span>,
    no_data: <span className="text-muted">No data yet.</span>,
  };
  return (
    <SwipeToDelete onDelete={onDelete} className="rounded-2xl" contentClassName="">
      <div className="rounded-2xl bg-night p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{goalTitle(goal)} → {show(goal.target)}</p>
            <p className="mt-0.5 text-[11px] text-muted">Now {status.current === null ? "—" : show(status.current)} · started at {show(goal.start_value)} on {shortDate(goal.start_date)}</p>
          </div>
          <button onClick={onDelete} className="hidden rounded-lg p-1.5 text-muted hover:text-red-300 lg:block" aria-label="Delete goal"><Trash2 size={13} /></button>
        </div>
        <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-panel"><div className={`h-full rounded-full ${status.status === "reached" ? "bg-lime" : "bg-mint"}`} style={{ width: `${status.percent}%` }} /></div>
        <p className="mt-2 text-[11px] leading-4">{message[status.status]}</p>
      </div>
    </SwipeToDelete>
  );
}

function GoalForm({ exercises, busy, onCancel, onSave }: { exercises: string[]; busy: boolean; onCancel: () => void; onSave: (body: Omit<FitnessGoal, "id" | "start_value" | "start_date">) => void }) {
  const { unit } = usePrefs();
  const [kind, setKind] = useState<FitnessGoal["kind"]>("weight");
  const [exercise, setExercise] = useState(exercises[0] ?? "");
  const [measure, setMeasure] = useState<MeasureKey>("waist_cm");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [validation, setValidation] = useState("");
  const shape = { kind, measure: kind === "measure" ? measure : null };

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = Number(target);
    if (!(value > 0)) { setValidation("Enter a target."); return; }
    setValidation("");
    onSave({ kind, exercise: kind === "lift" ? exercise : null, measure: kind === "measure" ? measure : null, target: fromDisplay(shape, value, unit), deadline: deadline || null });
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-2xl bg-night p-3">
      <div className="grid grid-cols-3 gap-1.5">
        {([["weight", "Weight"], ["lift", "Lift"], ["measure", "Measure"]] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setKind(key)} className={`rounded-xl border py-2 text-[11px] font-medium ${kind === key ? "border-lime bg-lime/10 text-lime" : "border-line text-muted"}`}>{label}</button>
        ))}
      </div>
      {kind === "lift" && (
        exercises.length ? (
          <Field label="Exercise"><select value={exercise} onChange={(e) => setExercise(e.target.value)} className="input-dark">{exercises.map((name) => <option key={name} value={name}>{name}</option>)}</select></Field>
        ) : <p className="text-[11px] text-muted">Log a strength workout first.</p>
      )}
      {kind === "measure" && (
        <Field label="Measurement"><select value={measure} onChange={(e) => setMeasure(e.target.value as MeasureKey)} className="input-dark">{(Object.keys(MEASURE_LABELS) as MeasureKey[]).map((key) => <option key={key} value={key}>{MEASURE_LABELS[key]}</option>)}</select></Field>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label={`Target · ${goalUnit(shape, unit)}`}><input type="number" inputMode="decimal" step="any" min="0" required value={target} onChange={(e) => setTarget(e.target.value)} className="input-dark" placeholder={kind === "lift" ? "e.g. 100" : kind === "weight" ? (unit === "lb" ? "e.g. 165" : "e.g. 75") : "e.g. 80"} /></Field>
        <Field label="By (optional)"><input type="date" min={addDays(localDate(), 1)} value={deadline} onChange={(e) => setDeadline(e.target.value)} className="input-dark" /></Field>
      </div>
      {validation && <FormError message={validation} />}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="button-secondary">Cancel</button>
        <button disabled={busy || (kind === "lift" && !exercises.length)} className="button-primary flex-1 disabled:opacity-60">{busy ? "Saving…" : "Add goal"}</button>
      </div>
    </form>
  );
}
