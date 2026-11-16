// Batch B: recipes, the target calculator and the fasting timer.
import { Calculator, Hourglass, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { fromCm, lengthUnit, toCm, usePrefs } from "./prefs";
import type { ActivityLevel, EnergyEstimate, Fast, Food, Goal, Profile, Targets } from "./types";
import { AmountInput, Field, FormError } from "./ui";
import { formatHours, formatNumber } from "./utils";

// ---------- recipes ----------

type Row = { food_id: string; grams: string };

export function RecipeForm({ foods, initial, busy, error, onSubmit }: {
  foods: Food[];
  initial: Food | null;
  busy: boolean;
  error: string;
  onSubmit: (body: { name: string; portions: number; ingredients: { food_id: number; grams: number }[] }) => void;
}) {
  const choices = foods.filter((food) => food.id !== initial?.id).sort((a, b) => a.name.localeCompare(b.name));
  const [name, setName] = useState(initial?.name ?? "");
  const [portions, setPortions] = useState(String(initial?.recipe?.portions ?? 1));
  const [rows, setRows] = useState<Row[]>(
    initial?.recipe?.ingredients.map((item) => ({ food_id: String(item.food_id), grams: String(item.grams) })) ?? [{ food_id: "", grams: "" }],
  );
  const [validation, setValidation] = useState("");

  const parts = rows
    .map((row) => ({ food: choices.find((food) => String(food.id) === row.food_id), grams: Number(row.grams) }))
    .filter((part): part is { food: Food; grams: number } => Boolean(part.food) && part.grams > 0);
  const total = (pick: (food: Food) => number) => parts.reduce((sum, part) => sum + (pick(part.food) * part.grams) / 100, 0);
  const totalGrams = parts.reduce((sum, part) => sum + part.grams, 0);
  const count = Math.max(1, Math.round(Number(portions)) || 1);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setValidation("Give the recipe a name."); return; }
    if (!parts.length || parts.length !== rows.filter((row) => row.food_id || row.grams).length) {
      setValidation("Each ingredient needs a food and an amount in grams.");
      return;
    }
    setValidation("");
    onSubmit({ name: name.trim(), portions: count, ingredients: parts.map((part) => ({ food_id: part.food.id, grams: part.grams })) });
  }
  const update = (index: number, key: keyof Row, value: string) => setRows((current) => current.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  if (choices.length === 0) {
    return <p className="rounded-2xl border border-dashed border-line p-5 text-center text-xs text-muted">Add the ingredients to your food library first, then build the recipe from them.</p>;
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-[11px] leading-5 text-muted">Combine foods from your library. The recipe becomes a food with a "1 portion" serving, so you can log it in one tap.</p>
      <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
        <Field label="Recipe name" required><input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Morning tea + biscuits" className="input-dark" /></Field>
        <Field label="Portions"><input type="number" inputMode="numeric" min="1" max="50" value={portions} onChange={(e) => setPortions(e.target.value)} className="input-dark text-center" /></Field>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium text-zinc-300">Ingredients</p>
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="space-y-1.5 rounded-xl border border-line/70 p-2">
              <div className="grid grid-cols-[minmax(0,1fr)_30px] items-center gap-2">
                <select
                  value={row.food_id}
                  onChange={(e) => {
                    // Default to one serving of the chosen food (or 100 g).
                    const food = choices.find((item) => String(item.id) === e.target.value);
                    setRows((current) => current.map((item, i) => (i === index ? { food_id: e.target.value, grams: food?.servings[0] ? String(food.servings[0].grams) : "100" } : item)));
                  }}
                  className="input-dark !px-2.5"
                  aria-label="Ingredient"
                >
                  <option value="">Choose a food…</option>
                  {choices.map((food) => <option key={food.id} value={food.id}>{food.name}</option>)}
                </select>
                <button type="button" onClick={() => setRows((current) => (current.length > 1 ? current.filter((_, i) => i !== index) : current))} className="rounded-lg p-2 text-muted hover:text-red-300" aria-label="Remove ingredient"><X size={14} /></button>
              </div>
              {row.food_id && (
                <AmountInput
                  key={row.food_id}
                  grams={row.grams}
                  servings={choices.find((food) => String(food.id) === row.food_id)?.servings ?? []}
                  onChange={(grams) => update(index, "grams", grams)}
                  label="Ingredient amount"
                />
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setRows((current) => [...current, { food_id: "", grams: "" }])} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-lime"><Plus size={14} /> Add ingredient</button>
      </div>
      {parts.length > 0 && (
        <div className="rounded-2xl bg-night p-4 text-xs">
          <p className="text-muted">Whole recipe: <b className="text-white">{formatNumber(totalGrams)} g</b> · <b className="text-white">{formatNumber(Math.round(total((food) => food.calories_per_100g)))} kcal</b></p>
          <p className="mt-2 text-sm">
            <b className="font-semibold">1 portion</b> <span className="text-muted">({formatNumber(Math.round(totalGrams / count))} g)</span>: {formatNumber(Math.round(total((food) => food.calories_per_100g) / count))} kcal · {formatNumber(total((food) => food.protein_g_per_100g) / count)} g protein · {formatNumber(total((food) => food.carbohydrates_g_per_100g) / count)} g carbs · {formatNumber(total((food) => food.fat_g_per_100g) / count)} g fat
          </p>
        </div>
      )}
      {(validation || error) && <FormError message={validation || error} />}
      <button disabled={busy} className="button-primary w-full disabled:opacity-60">{busy ? "Saving…" : initial ? "Save recipe" : "Create recipe"}</button>
    </form>
  );
}

// ---------- target calculator ----------

const ACTIVITY: { key: ActivityLevel; label: string; factor: number }[] = [
  { key: "sedentary", label: "Mostly sitting", factor: 1.2 },
  { key: "light", label: "Light: 1–3 workouts/wk", factor: 1.375 },
  { key: "moderate", label: "Moderate: 3–5/wk", factor: 1.55 },
  { key: "very", label: "Very active: 6–7/wk", factor: 1.725 },
  { key: "extra", label: "Physical job + training", factor: 1.9 },
];
const GOALS: { key: Goal; label: string; delta: number }[] = [
  { key: "lose", label: "Lose ~0.5 kg/week", delta: -500 },
  { key: "lose_slow", label: "Lose slowly", delta: -250 },
  { key: "maintain", label: "Maintain", delta: 0 },
  { key: "gain", label: "Gain slowly", delta: 250 },
];

/** Mifflin–St Jeor BMR × activity, adjusted for the goal; protein by body weight, fat ~27% of calories. */
export function suggestTargets(profile: Profile, weightKg: number, measuredBurn: number | null) {
  const age = new Date().getFullYear() - profile.birth_year;
  const bmr = 10 * weightKg + 6.25 * profile.height_cm - 5 * age + (profile.sex === "male" ? 5 : -161);
  const formulaBurn = bmr * (ACTIVITY.find((item) => item.key === profile.activity)?.factor ?? 1.375);
  const burn = measuredBurn ?? formulaBurn;
  const goal = GOALS.find((item) => item.key === profile.goal) ?? GOALS[2];
  const floor = profile.sex === "male" ? 1500 : 1200; // don't suggest very low intakes
  const calories = Math.round(Math.max(burn + goal.delta, floor) / 10) * 10;
  const protein = Math.round(weightKg * (profile.goal.startsWith("lose") ? 1.8 : 1.6));
  const fat = Math.round((calories * 0.27) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  const fiber = Math.round((calories / 1000) * 14);
  return { bmr: Math.round(bmr), burn: Math.round(burn), formulaBurn: Math.round(formulaBurn), calories, protein, fat, carbs, fiber };
}

export function TargetCalculator({ profile, latestWeightKg, energy, onSaveProfile, onApply }: {
  profile: Profile | null;
  latestWeightKg: number | null;
  energy: EnergyEstimate | null;
  onSaveProfile: (profile: Profile) => Promise<boolean>;
  onApply: (targets: Partial<Targets>) => void;
}) {
  const { unit } = usePrefs();
  const len = lengthUnit(unit);
  const [open, setOpen] = useState(false);
  const [sex, setSex] = useState<Profile["sex"]>(profile?.sex ?? "male");
  const [birthYear, setBirthYear] = useState(profile ? String(profile.birth_year) : "");
  const [height, setHeight] = useState(profile ? String(fromCm(profile.height_cm, unit)) : "");
  const [weight, setWeight] = useState(latestWeightKg ? String(unit === "lb" ? Math.round(latestWeightKg * 2.20462 * 10) / 10 : latestWeightKg) : "");
  const [activity, setActivity] = useState<ActivityLevel>(profile?.activity ?? "light");
  const [goal, setGoal] = useState<Goal>(profile?.goal ?? "maintain");
  const [useMeasured, setUseMeasured] = useState(Boolean(energy?.ready));
  const [result, setResult] = useState<ReturnType<typeof suggestTargets> | null>(null);

  async function calculate(event: FormEvent) {
    event.preventDefault();
    const next: Profile = { sex, birth_year: Number(birthYear), height_cm: toCm(Number(height), unit), activity, goal };
    const weightKg = unit === "lb" ? Number(weight) / 2.20462 : Number(weight);
    if (!(weightKg > 20)) return;
    if (!(await onSaveProfile(next))) return;
    setResult(suggestTargets(next, weightKg, useMeasured && energy?.ready ? energy.tdee : null));
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3 rounded-2xl border border-lime/30 bg-lime/5 p-3 text-left">
        <Calculator size={18} className="shrink-0 text-lime" />
        <span className="text-xs"><b className="font-semibold text-lime">Suggest targets for me</b><br /><span className="text-muted">From your age, height, weight, activity and goal.</span></span>
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-lime/30 bg-lime/5 p-3">
      <form onSubmit={calculate} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Sex (for the formula)">
            <select value={sex} onChange={(e) => setSex(e.target.value as Profile["sex"])} className="input-dark"><option value="male">Male</option><option value="female">Female</option></select>
          </Field>
          <Field label="Birth year"><input type="number" inputMode="numeric" required value={birthYear} onChange={(e) => setBirthYear(e.target.value)} placeholder="e.g. 1995" className="input-dark" /></Field>
          <Field label={`Height · ${len}`}><input type="number" inputMode="decimal" required step="any" value={height} onChange={(e) => setHeight(e.target.value)} placeholder={len === "cm" ? "e.g. 175" : "e.g. 69"} className="input-dark" /></Field>
          <Field label={`Weight · ${unit}`}><input type="number" inputMode="decimal" required step="any" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Current weight" className="input-dark" /></Field>
        </div>
        <Field label="Activity">
          <select value={activity} onChange={(e) => setActivity(e.target.value as ActivityLevel)} className="input-dark">{ACTIVITY.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
        </Field>
        <Field label="Goal">
          <select value={goal} onChange={(e) => setGoal(e.target.value as Goal)} className="input-dark">{GOALS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
        </Field>
        {energy?.ready && (
          <label className="flex items-start gap-2 text-[11px] leading-4 text-zinc-300">
            <input type="checkbox" checked={useMeasured} onChange={(e) => setUseMeasured(e.target.checked)} className="mt-0.5 accent-[#8BE0B0]" />
            Use your measured burn ({formatNumber(energy.tdee)} kcal/day, from your last {energy.window_days} days) instead of the formula
          </label>
        )}
        <button className="button-secondary w-full"><Calculator size={15} /> Calculate</button>
      </form>
      {result && (
        <div className="rounded-xl bg-night p-3 text-xs">
          <p className="text-muted">Daily burn ≈ <b className="text-white">{formatNumber(result.burn)} kcal</b>{useMeasured && energy?.ready ? " (measured)" : ` (formula; resting ${formatNumber(result.bmr)})`}</p>
          <p className="mt-2 text-sm leading-6">
            <b className="font-semibold">{formatNumber(result.calories)} kcal</b> · {result.protein} g protein · {result.carbs} g carbs · {result.fat} g fat · {result.fiber} g fiber
          </p>
          <button type="button" onClick={() => onApply({ calories: result.calories, protein_g: result.protein, carbohydrates_g: result.carbs, fat_g: result.fat, fiber_g: result.fiber })} className="button-primary mt-3 w-full">Use these numbers</button>
          <p className="mt-2 text-[10px] leading-4 text-muted">A starting point from a standard formula, not medical advice. Adjust after a few weeks based on your weight trend.</p>
        </div>
      )}
    </div>
  );
}

// ---------- fasting ----------

const FAST_GOALS = [12, 14, 16, 18, 20];
const clockTime = (ms: number) => {
  const time = new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const days = Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  return days === 1 ? `${time} tomorrow` : days === -1 ? `${time} yesterday` : time;
};

export function FastingCard({ active, recent, onStart, onEnd, onAdjust }: {
  active: Fast | null;
  recent: Fast[];
  onStart: (goalH: number, start?: number) => void;
  onEnd: () => void;
  onAdjust: (change: { start?: number; goal_h?: number }) => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [goal, setGoal] = useState(active?.goal_h ?? recent[0]?.goal_h ?? 16);
  const [editingStart, setEditingStart] = useState(false);
  const [earlier, setEarlier] = useState<string | null>(null); // "HH:MM" when starting a fast that began earlier
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    tick();
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [active]);

  /** "HH:MM" today, or yesterday if that would be in the future. */
  function timeToMs(value: string) {
    const [h, m] = value.split(":").map(Number);
    const date = new Date();
    date.setHours(h, m, 0, 0);
    if (date.getTime() > Date.now()) date.setDate(date.getDate() - 1);
    return date.getTime();
  }

  const last = recent[0];
  return (
    <section className="rounded-3xl border border-line bg-panel p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-medium text-muted"><Hourglass size={15} className="text-amber-300" /> FASTING</div>
        {last && !active && <span className="text-[10px] text-muted">Last: {formatHours((last.end! - last.start) / 3_600_000)}{(last.end! - last.start) / 3_600_000 >= last.goal_h ? " ✓" : ""}</span>}
      </div>
      {active ? (() => {
        const hours = (now - active.start) / 3_600_000;
        const percent = Math.min(hours / active.goal_h, 1) * 100;
        const done = hours >= active.goal_h;
        return (
          <div className="mt-3">
            <p><span className="text-3xl font-semibold tracking-tight tabular-nums">{formatHours(Math.floor(hours * 60) / 60)}</span> <span className="text-sm text-muted">of {active.goal_h}h</span></p>
            <p className="mt-1 text-[11px] text-muted">
              Started {clockTime(active.start)} · {done ? <b className="font-semibold text-lime">Goal reached</b> : <>goal at {clockTime(active.start + active.goal_h * 3_600_000)}</>}
              {" · "}<button onClick={() => setEditingStart((open) => !open)} className="text-amber-300">edit</button>
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-night"><div className={`h-full rounded-full ${done ? "bg-lime" : "bg-amber-300"}`} style={{ width: `${percent}%` }} /></div>
            {editingStart && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Field label="Started at"><input type="time" defaultValue={new Date(active.start).toTimeString().slice(0, 5)} onChange={(e) => e.target.value && onAdjust({ start: timeToMs(e.target.value) })} className="input-dark" /></Field>
                <Field label="Goal"><select value={active.goal_h} onChange={(e) => onAdjust({ goal_h: Number(e.target.value) })} className="input-dark">{FAST_GOALS.map((h) => <option key={h} value={h}>{h} hours</option>)}</select></Field>
              </div>
            )}
            <button onClick={onEnd} className={`${done ? "button-primary" : "button-secondary"} mt-3 w-full`}>End fast</button>
          </div>
        );
      })() : (
        <div className="mt-3">
          <div className="flex flex-wrap gap-1.5">
            {FAST_GOALS.map((h) => <button key={h} onClick={() => setGoal(h)} className={`rounded-full border px-3 py-1.5 text-[11px] font-medium ${goal === h ? "border-amber-300 bg-amber-300/10 text-amber-300" : "border-line text-muted"}`}>{h}h</button>)}
          </div>
          {earlier === null ? (
            <div className="mt-3 flex gap-2">
              <button onClick={() => onStart(goal)} className="button-primary flex-1">Start {goal}h fast now</button>
              <button onClick={() => setEarlier(new Date(Date.now() - 60 * 60_000).toTimeString().slice(0, 5))} className="button-secondary !px-3 text-[11px]">Started earlier</button>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
              <Field label="Last ate at"><input type="time" value={earlier} onChange={(e) => setEarlier(e.target.value)} className="input-dark" /></Field>
              <button onClick={() => { if (earlier) onStart(goal, timeToMs(earlier)); setEarlier(null); }} className="button-primary">Start</button>
            </div>
          )}
          {recent.length > 1 && <p className="mt-3 text-[10px] text-muted">Recent: {recent.slice(0, 5).map((fast) => formatHours(Math.round(((fast.end as number) - fast.start) / 60_000) / 60)).join(" · ")}</p>}
        </div>
      )}
    </section>
  );
}
