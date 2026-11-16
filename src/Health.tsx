// Batch A health features: sleep, steps, habits, cardio and body measurements.
import { Bike, Check, Flame, Footprints, ListChecks, Moon, Pencil, Plus, Settings2, Trash2, Waves, X } from "lucide-react";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { distanceUnit, fromKm, toKm, usePrefs } from "./prefs";
import { SwipeToDelete } from "./Swipe";
import type { Cardio, CardioType, HabitStatus, Sleep } from "./types";
import { Field, FormError } from "./ui";
import { dateLabel, formatHours, formatNumber, localDate, sleepHours } from "./utils";

const card = "rounded-3xl border border-line bg-panel p-4 sm:p-6";

function CardHeading({ icon, label, action }: { icon: ReactNode; label: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted">{icon} {label}</div>
      {action}
    </div>
  );
}

// ---------- sleep ----------

const QUALITY = ["Poor", "Fair", "OK", "Good", "Great"];

export function SleepCard({ sleep, onLog }: { sleep: Sleep | null; onLog: () => void }) {
  const hours = sleep ? sleepHours(sleep.bed, sleep.wake) : null;
  return (
    <section className={card}>
      <CardHeading icon={<Moon size={15} className="text-violet-300" />} label="SLEEP" action={<button onClick={onLog} className="rounded-xl border border-line px-3 py-2 text-xs font-medium text-muted">{sleep ? "Edit" : "Log"}</button>} />
      {sleep && hours !== null ? (
        <>
          <p className="mt-3 text-3xl font-semibold tracking-tight">{formatHours(hours)}</p>
          <p className="mt-1 text-[11px] text-muted">{sleep.bed} → {sleep.wake} · {QUALITY[sleep.quality - 1]}</p>
          <div className="mt-3 flex gap-1">{[1, 2, 3, 4, 5].map((level) => <span key={level} className={`h-1.5 flex-1 rounded-full ${level <= sleep.quality ? "bg-violet-300" : "bg-night"}`} />)}</div>
        </>
      ) : (
        <button onClick={onLog} className="mt-3 w-full rounded-2xl border border-dashed border-line px-4 py-5 text-xs text-muted">How did you sleep? Tap to log last night.</button>
      )}
    </section>
  );
}

export function SleepForm({ initial, previous, busy, error, onSubmit }: { initial: Sleep | null; previous: Sleep | null; busy: boolean; error: string; onSubmit: (sleep: Sleep | null) => void }) {
  const start = initial ?? previous ?? { bed: "23:00", wake: "07:00", quality: 3 };
  const [bed, setBed] = useState(start.bed);
  const [wake, setWake] = useState(start.wake);
  const [quality, setQuality] = useState(initial?.quality ?? 3);
  const hours = bed && wake ? sleepHours(bed, wake) : null;
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit({ bed, wake, quality }); }} className="space-y-4">
      <p className="text-[11px] leading-5 text-muted">Saved under the morning you woke up.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Went to bed"><input type="time" required value={bed} onChange={(e) => setBed(e.target.value)} className="input-dark" /></Field>
        <Field label="Woke up"><input type="time" required value={wake} onChange={(e) => setWake(e.target.value)} className="input-dark" /></Field>
      </div>
      {hours !== null && <p className="rounded-2xl bg-night p-3 text-center text-sm"><b className="text-lg font-semibold">{formatHours(hours)}</b> <span className="text-muted">in bed</span></p>}
      <Field label="How well did you sleep?">
        <div className="grid grid-cols-5 gap-1.5">
          {QUALITY.map((text, index) => (
            <button key={text} type="button" onClick={() => setQuality(index + 1)} className={`rounded-xl border px-1 py-2 text-[11px] font-medium ${quality === index + 1 ? "border-violet-300 bg-violet-300/10 text-violet-300" : "border-line text-muted"}`}>{text}</button>
          ))}
        </div>
      </Field>
      {error && <FormError message={error} />}
      <div className="flex gap-2">
        {initial && <button type="button" disabled={busy} onClick={() => onSubmit(null)} className="button-secondary !text-red-200 disabled:opacity-60"><Trash2 size={14} /> Clear</button>}
        <button disabled={busy} className="button-primary flex-1 disabled:opacity-60">{busy ? "Saving…" : "Save sleep"}</button>
      </div>
    </form>
  );
}

// ---------- steps ----------

export function StepsCard({ steps, target, onSave, onSetTarget }: { steps: number | null; target: number | null; onSave: (steps: number | null) => Promise<unknown>; onSetTarget: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const percent = target && steps ? Math.min(steps / target, 1) * 100 : 0;
  async function save(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.replace(/[,\s]/g, "");
    await onSave(trimmed === "" ? null : Math.round(Number(trimmed)));
    setEditing(false);
  }
  return (
    <section className={card}>
      <CardHeading icon={<Footprints size={15} className="text-sky-300" />} label="STEPS" action={!editing && <button onClick={() => { setValue(steps === null ? "" : String(steps)); setEditing(true); }} className="rounded-xl border border-line px-3 py-2 text-xs font-medium text-muted">{steps === null ? "Add" : "Edit"}</button>} />
      {editing ? (
        <form onSubmit={save} className="mt-3 space-y-2">
          <div className="flex gap-2">
            <input autoFocus type="number" inputMode="numeric" min="0" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 8,450" className="input-dark" aria-label="Steps" />
            <button className="button-primary !px-4">Save</button>
          </div>
          <p className="text-[10px] leading-4 text-muted">Copy today's total from the Fitness app (Summary → Step Count).</p>
        </form>
      ) : (
        <>
          <p className="mt-3"><span className="text-3xl font-semibold tracking-tight">{steps === null ? "—" : formatNumber(steps)}</span> <span className="text-sm text-muted">steps</span></p>
          <p className="mt-1 text-[11px] text-muted">{target ? `${formatNumber(target)} target` : <button onClick={onSetTarget} className="text-sky-300">Set a daily target</button>}</p>
          {target !== null && <div className="mt-3 h-2 overflow-hidden rounded-full bg-night"><div className="h-full rounded-full bg-sky-300" style={{ width: `${percent}%` }} /></div>}
        </>
      )}
    </section>
  );
}

// ---------- habits ----------

const SUGGESTED_HABITS = ["Vitamins", "Stretch 10 min", "10k steps", "No sugar", "Read 20 min", "Meditate"];

export function HabitsCard({ habits, onToggle, onManage, onAdd }: { habits: HabitStatus[]; onToggle: (habit: HabitStatus) => void; onManage: () => void; onAdd: (name: string) => void }) {
  const done = habits.filter((habit) => habit.done).length;
  return (
    <section className={card}>
      <CardHeading
        icon={<ListChecks size={15} className="text-lime" />}
        label={habits.length ? `HABITS · ${done}/${habits.length}` : "HABITS"}
        action={<button onClick={onManage} className="rounded-xl border border-line p-2 text-muted" aria-label="Manage habits"><Settings2 size={14} /></button>}
      />
      {habits.length === 0 ? (
        <div className="mt-3">
          <p className="text-xs text-muted">Track daily habits and supplements. Tap one to start, or add your own.</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {SUGGESTED_HABITS.map((name) => <button key={name} onClick={() => onAdd(name)} className="rounded-full border border-lime/30 px-3 py-1.5 text-[11px] text-lime"><Plus size={11} className="-mt-0.5 mr-1 inline" />{name}</button>)}
            <button onClick={onManage} className="rounded-full border border-line px-3 py-1.5 text-[11px] text-muted">Your own…</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-1.5">
          {habits.map((habit) => (
            <button key={habit.id} onClick={() => onToggle(habit)} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${habit.done ? "border-lime/40 bg-lime/10" : "border-line/70 bg-night/60"}`}>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${habit.done ? "border-lime bg-lime text-night" : "border-zinc-500"}`}>{habit.done && <Check size={13} strokeWidth={3} />}</span>
              <span className={`min-w-0 flex-1 truncate text-sm ${habit.done ? "text-lime" : ""}`}>{habit.name}</span>
              {habit.streak > 1 && <span className="flex shrink-0 items-center gap-1 text-[10px] text-amber-300"><Flame size={12} />{habit.streak}</span>}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function HabitsManager({ habits, busy, error, onAdd, onRemove }: { habits: HabitStatus[]; busy: boolean; error: string; onAdd: (name: string) => void; onRemove: (habit: HabitStatus) => void }) {
  const [name, setName] = useState("");
  return (
    <div className="space-y-4">
      <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) { onAdd(name); setName(""); } }} className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Creatine 5 g" className="input-dark" aria-label="New habit" />
        <button disabled={busy || !name.trim()} className="button-primary !px-4 disabled:opacity-60"><Plus size={15} /> Add</button>
      </form>
      {error && <FormError message={error} />}
      {SUGGESTED_HABITS.some((name) => !habits.some((habit) => habit.name.toLowerCase() === name.toLowerCase())) && (
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED_HABITS.filter((name) => !habits.some((habit) => habit.name.toLowerCase() === name.toLowerCase())).map((name) => (
            <button key={name} type="button" disabled={busy} onClick={() => onAdd(name)} className="rounded-full border border-lime/30 px-3 py-1.5 text-[11px] text-lime disabled:opacity-50"><Plus size={11} className="-mt-0.5 mr-1 inline" />{name}</button>
          ))}
        </div>
      )}
      {habits.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-5 text-center text-xs text-muted">No habits yet.</p>
      ) : (
        <div className="space-y-1.5">
          {habits.map((habit) => (
            <SwipeToDelete key={habit.id} onDelete={() => onRemove(habit)} label="Remove" className="rounded-xl">
              <div className="flex items-center justify-between rounded-xl border border-line/70 bg-night/60 px-3 py-2.5">
                <span className="truncate text-sm">{habit.name}</span>
                <button onClick={() => onRemove(habit)} className="rounded-lg p-1.5 text-muted hover:text-red-300" aria-label={`Remove ${habit.name}`}><X size={14} /></button>
              </div>
            </SwipeToDelete>
          ))}
        </div>
      )}
      <p className="text-[10px] leading-4 text-muted">Removing a habit hides it from your checklist. Past ticks are kept.</p>
    </div>
  );
}

// ---------- cardio ----------

const CARDIO: { type: CardioType; label: string }[] = [
  { type: "run", label: "Run" },
  { type: "walk", label: "Walk" },
  { type: "cycle", label: "Cycle" },
  { type: "swim", label: "Swim" },
  { type: "other", label: "Other" },
];
export const cardioLabel = (type: CardioType) => CARDIO.find((item) => item.type === type)?.label ?? "Cardio";

function CardioIcon({ type, size = 16 }: { type: CardioType; size?: number }) {
  if (type === "cycle") return <Bike size={size} />;
  if (type === "swim") return <Waves size={size} />;
  return <Footprints size={size} />;
}

/** Minutes per km/mi as "5:42". */
function pace(minutes: number, distance: number) {
  const perUnit = minutes / distance;
  const whole = Math.floor(perUnit);
  return `${whole}:${String(Math.round((perUnit - whole) * 60)).padStart(2, "0")}`;
}

export function CardioForm({ initial, date, busy, error, onSubmit, onDelete }: { initial: Cardio | null; date: string; busy: boolean; error: string; onSubmit: (body: Omit<Cardio, "id">) => void; onDelete?: () => void }) {
  const { unit } = usePrefs();
  const dist = distanceUnit(unit);
  const [type, setType] = useState<CardioType>(initial?.type ?? "run");
  const [minutes, setMinutes] = useState(initial ? String(initial.minutes) : "");
  const [distance, setDistance] = useState(initial?.distance_km != null ? String(fromKm(initial.distance_km, unit)) : "");
  const [kcal, setKcal] = useState(initial?.kcal != null ? String(initial.kcal) : "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [day, setDay] = useState(initial?.date ?? date);
  const [validation, setValidation] = useState("");
  const minutesNum = Number(minutes);
  const distanceNum = Number(distance);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!(minutesNum > 0)) { setValidation("Enter how many minutes."); return; }
    if (distance.trim() && !(distanceNum >= 0)) { setValidation("Distance must be a number."); return; }
    setValidation("");
    // Keep the stored km exactly when the distance wasn't changed.
    const unchanged = initial?.distance_km != null && distance === String(fromKm(initial.distance_km, unit));
    onSubmit({
      date: day,
      type,
      minutes: minutesNum,
      distance_km: distance.trim() ? (unchanged ? initial!.distance_km : toKm(distanceNum, unit)) : null,
      kcal: kcal.trim() ? Number(kcal) : null,
      note: note.trim() || null,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-5 gap-1.5">
        {CARDIO.map((item) => (
          <button key={item.type} type="button" onClick={() => setType(item.type)} className={`flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium ${type === item.type ? "border-mint bg-mint/10 text-mint" : "border-line text-muted"}`}>
            <CardioIcon type={item.type} size={15} />{item.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Minutes" required><input type="number" inputMode="numeric" min="1" required value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="e.g. 30" className="input-dark" /></Field>
        <Field label={`Distance · ${dist}`}><input type="number" inputMode="decimal" min="0" step="any" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="Optional" className="input-dark" /></Field>
        <Field label="Calories burned"><input type="number" inputMode="numeric" min="0" value={kcal} onChange={(e) => setKcal(e.target.value)} placeholder="Optional" className="input-dark" /></Field>
        <Field label="Day"><input type="date" value={day} max={localDate()} onChange={(e) => e.target.value && setDay(e.target.value)} className="input-dark" /></Field>
      </div>
      {minutesNum > 0 && distanceNum > 0 && (type === "run" || type === "walk") && (
        <p className="rounded-2xl bg-night p-3 text-center text-sm">Pace <b className="font-semibold">{pace(minutesNum, distanceNum)}</b> <span className="text-muted">min / {dist}</span></p>
      )}
      <Field label="Note"><input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. easy pace, hills" className="input-dark" /></Field>
      {(validation || error) && <FormError message={validation || error} />}
      <div className="flex gap-2">
        {onDelete && <button type="button" disabled={busy} onClick={onDelete} className="button-secondary !text-red-200 disabled:opacity-60"><Trash2 size={14} /> Delete</button>}
        <button disabled={busy} className="button-primary flex-1 disabled:opacity-60">{busy ? "Saving…" : initial ? "Save changes" : "Save session"}</button>
      </div>
    </form>
  );
}

export function CardioCard({ session, onEdit, onDelete }: { session: Cardio; onEdit: () => void; onDelete: () => void }) {
  const { unit } = usePrefs();
  const dist = distanceUnit(unit);
  const distance = session.distance_km != null ? fromKm(session.distance_km, unit) : null;
  const details = [
    `${session.minutes} min`,
    distance != null ? `${formatNumber(distance)} ${dist}` : null,
    distance && (session.type === "run" || session.type === "walk") ? `${pace(session.minutes, distance)} /${dist}` : null,
    session.kcal != null ? `${formatNumber(session.kcal)} kcal` : null,
  ].filter(Boolean).join(" · ");
  return (
    <SwipeToDelete onDelete={onDelete} className="rounded-2xl" contentClassName="">
      <button onClick={onEdit} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-panel p-4 text-left">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-300/10 text-sky-300"><CardioIcon type={session.type} /></div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{cardioLabel(session.type)}{session.note ? <span className="font-normal text-muted"> · {session.note}</span> : null}</p>
          <p className="mt-1 text-[10px] text-muted">{dateLabel(session.date)} · {details}</p>
        </div>
        <Pencil size={14} className="shrink-0 text-muted" />
      </button>
    </SwipeToDelete>
  );
}
