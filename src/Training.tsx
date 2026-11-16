// Batch C UI: workout plans, today's plan, and weekly sets per muscle group.
import { CalendarCheck, Check, ClipboardList, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { SwipeToDelete } from "./Swipe";
import { MUSCLES, guessMuscle, muscleLabel } from "./training-logic";
import type { Muscle, MuscleVolume, Routine } from "./types";
import { Field, FormError } from "./ui";

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** 0 = Monday … 6 = Sunday for a YYYY-MM-DD date. */
export const weekdayIndex = (date: string) => (new Date(`${date}T12:00:00`).getDay() + 6) % 7;

type Row = { name: string; sets: string; reps: string };

export function RoutineForm({ initial, exerciseNames, busy, error, onSubmit, onDelete }: {
  initial: Routine | null;
  exerciseNames: string[];
  busy: boolean;
  error: string;
  onSubmit: (body: Omit<Routine, "id">) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [days, setDays] = useState<number[]>(initial?.days ?? []);
  const [rows, setRows] = useState<Row[]>(initial?.exercises.map((item) => ({ name: item.name, sets: String(item.sets), reps: String(item.reps) })) ?? [{ name: "", sets: "3", reps: "8" }]);
  const [validation, setValidation] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const filled = rows.filter((row) => row.name.trim());
    if (!name.trim()) { setValidation("Give the plan a name, e.g. Push day."); return; }
    if (!filled.length) { setValidation("Add at least one exercise."); return; }
    if (filled.some((row) => !(Number(row.sets) >= 1) || !(Number(row.reps) >= 1))) { setValidation("Each exercise needs sets and reps."); return; }
    setValidation("");
    onSubmit({ name: name.trim(), days, exercises: filled.map((row) => ({ name: row.name.trim(), sets: Math.round(Number(row.sets)), reps: Math.round(Number(row.reps)) })) });
  }
  const update = (index: number, key: keyof Row, value: string) => setRows((current) => current.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Plan name" required><input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Push day" className="input-dark" /></Field>
      <Field label="Days">
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((day, index) => (
            <button key={day} type="button" onClick={() => setDays((current) => (current.includes(index) ? current.filter((d) => d !== index) : [...current, index]))} className={`rounded-lg border py-2 text-[11px] font-medium ${days.includes(index) ? "border-mint bg-mint/10 text-mint" : "border-line text-muted"}`}>
              {day.slice(0, 2)}
            </button>
          ))}
        </div>
      </Field>
      <div>
        <p className="mb-2 text-xs font-medium text-zinc-300">Exercises</p>
        <datalist id="plan-exercise-names">{exerciseNames.map((exercise) => <option key={exercise} value={exercise} />)}</datalist>
        <div className="space-y-2">
          {rows.map((row, index) => {
            const muscle = guessMuscle(row.name);
            return (
              <div key={index}>
                <div className="grid grid-cols-[minmax(0,1fr)_52px_52px_30px] items-end gap-2">
                  <Field label={index === 0 ? "Exercise" : " "}><input list="plan-exercise-names" value={row.name} onChange={(e) => update(index, "name", e.target.value)} placeholder="e.g. Bench press" className="input-dark !px-2.5" /></Field>
                  <Field label={index === 0 ? "Sets" : " "}><input type="number" inputMode="numeric" min="1" value={row.sets} onChange={(e) => update(index, "sets", e.target.value)} className="input-dark !px-1 text-center" /></Field>
                  <Field label={index === 0 ? "Reps" : " "}><input type="number" inputMode="numeric" min="1" value={row.reps} onChange={(e) => update(index, "reps", e.target.value)} className="input-dark !px-1 text-center" /></Field>
                  <button type="button" onClick={() => setRows((current) => (current.length > 1 ? current.filter((_, i) => i !== index) : current))} className="mb-1 rounded-lg p-2 text-muted hover:text-red-300" aria-label="Remove exercise"><X size={14} /></button>
                </div>
                {row.name.trim() && muscle && <p className="ml-1 mt-0.5 text-[10px] text-muted">{muscleLabel(muscle)}</p>}
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => setRows((current) => [...current, { name: "", sets: current[current.length - 1]?.sets ?? "3", reps: current[current.length - 1]?.reps ?? "8" }])} className="mt-3 flex items-center gap-1.5 text-xs font-medium text-mint"><Plus size={14} /> Add exercise</button>
      </div>
      {(validation || error) && <FormError message={validation || error} />}
      <div className="flex gap-2">
        {onDelete && <button type="button" disabled={busy} onClick={onDelete} className="button-secondary !text-red-200 disabled:opacity-60"><Trash2 size={14} /> Delete</button>}
        <button disabled={busy} className="button-primary flex-1 disabled:opacity-60">{busy ? "Saving…" : initial ? "Save plan" : "Create plan"}</button>
      </div>
    </form>
  );
}

export function RoutineCard({ routine, onEdit, onDelete, onStart }: { routine: Routine; onEdit: () => void; onDelete: () => void; onStart: () => void }) {
  return (
    <SwipeToDelete onDelete={onDelete} className="rounded-2xl" contentClassName="">
      <article className="rounded-2xl border border-line bg-panel p-4">
        <div className="flex items-start justify-between gap-2">
          <button onClick={onEdit} className="flex min-w-0 items-center gap-3 text-left">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-mint/10 text-mint"><ClipboardList size={17} /></div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">{routine.name}</h3>
              <p className="mt-1 text-[10px] text-muted">{routine.days.length ? routine.days.map((day) => WEEKDAYS[day]).join(" · ") : "No set days"} · {routine.exercises.length} exercises</p>
            </div>
          </button>
          <div className="flex shrink-0 items-center gap-0.5">
            <button onClick={onStart} className="flex items-center gap-1 rounded-lg bg-mint/10 px-2.5 py-1.5 text-[11px] font-semibold text-mint"><Play size={12} /> Start</button>
            <button onClick={onEdit} className="rounded-lg p-2 text-muted" aria-label={`Edit ${routine.name}`}><Pencil size={14} /></button>
            <button onClick={onDelete} className="hidden rounded-lg p-2 text-muted hover:text-red-300 lg:block" aria-label={`Delete ${routine.name}`}><Trash2 size={14} /></button>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-muted">{routine.exercises.map((item) => `${item.name} ${item.sets}×${item.reps}`).join(" · ")}</p>
      </article>
    </SwipeToDelete>
  );
}

/** Rows for the plans scheduled on the selected day, shown at the top of "Today's training". */
export function TodayPlans({ routines, loggedNames, onStart }: { routines: Routine[]; loggedNames: string[]; onStart: (routine: Routine) => void }) {
  if (!routines.length) return null;
  return (
    <div className="mb-3 space-y-2">
      {routines.map((routine) => {
        const done = loggedNames.some((name) => name.toLowerCase() === routine.name.toLowerCase());
        return (
          <div key={routine.id} className={`flex items-center gap-3 rounded-2xl border p-3 ${done ? "border-lime/30 bg-lime/5" : "border-mint/30 bg-mint/5"}`}>
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${done ? "bg-lime/15 text-lime" : "bg-mint/15 text-mint"}`}>{done ? <Check size={16} /> : <CalendarCheck size={16} />}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{routine.name}</p>
              <p className="text-[10px] text-muted">{done ? "Done" : `Planned · ${routine.exercises.length} exercises`}</p>
            </div>
            {!done && <button onClick={() => onStart(routine)} className="button-primary !min-h-9 !px-3"><Play size={13} /> Start</button>}
          </div>
        );
      })}
    </div>
  );
}

/** Progress tab: working sets per muscle group this week, with a way to assign unknown exercises. */
export function MuscleSection({ volume, onAssign }: { volume: MuscleVolume; onAssign: (exercise: string, muscle: Muscle) => void }) {
  const max = Math.max(20, ...volume.muscles.map((item) => item.sets));
  return (
    <section className="mt-4 rounded-3xl border border-line bg-panel p-4 sm:p-6">
      <h3 className="font-semibold">Weekly sets per muscle</h3>
      <p className="mt-1 text-xs text-muted">Strength sets in the last 7 days. Around 10–20 sets a week per muscle is a common target for growth.</p>
      {volume.muscles.length === 0 && volume.unassigned.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-line p-5 text-center text-xs text-muted">No strength sets in the last 7 days.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {volume.muscles.map(({ muscle, sets }) => (
            <div key={muscle} className="grid grid-cols-[72px_minmax(0,1fr)_28px] items-center gap-2 text-xs">
              <span className="text-muted">{muscleLabel(muscle)}</span>
              <div className="relative h-2.5 overflow-hidden rounded-full bg-night">
                {/* 10–20 set guide band */}
                <div className="absolute inset-y-0 bg-mint/10" style={{ left: `${(10 / max) * 100}%`, width: `${(10 / max) * 100}%` }} />
                <div className={`relative h-full rounded-full ${sets >= 10 ? "bg-mint" : "bg-amber-300"}`} style={{ width: `${Math.min(sets / max, 1) * 100}%` }} />
              </div>
              <span className="text-right font-semibold tabular-nums">{sets}</span>
            </div>
          ))}
        </div>
      )}
      {volume.unassigned.length > 0 && (
        <div className="mt-4 rounded-2xl bg-night p-3">
          <p className="text-[11px] text-muted">Which muscle do these work? (Used for this chart only.)</p>
          <div className="mt-2 space-y-2">
            {volume.unassigned.map(({ exercise, sets }) => (
              <div key={exercise} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate">{exercise} <span className="text-muted">· {sets} sets</span></span>
                <select defaultValue="" onChange={(e) => e.target.value && onAssign(exercise, e.target.value as Muscle)} className="input-dark !min-h-9 !w-auto !py-1 text-xs" aria-label={`Muscle for ${exercise}`}>
                  <option value="">Choose…</option>
                  {MUSCLES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
