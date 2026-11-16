// On-device data layer. Everything is stored in this browser's IndexedDB on the phone:
// no server, works offline. Mirrors the calculations the old FastAPI backend did.
import { sleepHours } from "./utils";
import { estimate1RM, guessMuscle } from "./training-logic";
import type { BackupStatus, BodyWeight, Cardio, EnergyEstimate, Fast, FitnessGoal, GoalStatus, Muscle, WeekSummary, MuscleVolume, Profile, Recipe, Routine, CardioType, DayLog, FoodSource, Habit, HabitStatus, Measurement, MeasureKey, Sleep, DashboardData, ExercisePoint, ExerciseSummary, Food, Meal, Targets, TrendDay, Trends, Workout, WorkoutSet } from "./types";

type FoodBody = Omit<Food, "id" | "source" | "is_verified">;
type MealBody = { food_id: number; date: string; meal_type: string; portion_g: number };
type WorkoutBody = {
  name: string;
  date: string;
  notes?: string | null;
  sets: { exercise_name: string; set_number: number; reps: number; weight_kg: number }[];
};
type StoredMeal = Meal & { created_at: number };

type State = {
  version: 1;
  next_id: { food: number; meal: number; workout: number; set: number; weight: number; habit: number; cardio: number; measure: number; fast: number; routine: number; goal: number };
  targets: Targets | null;
  foods: Food[];
  meals: StoredMeal[];
  workouts: Workout[];
  weights: BodyWeight[];
  days: Record<string, Partial<DayLog>>; // water, notes, sleep, steps, habits ticked; keyed by YYYY-MM-DD
  habits: Habit[];
  cardio: Cardio[];
  measurements: Measurement[];
  profile: Profile | null;
  fasts: Fast[];
  routines: Routine[];
  goals: FitnessGoal[];
  /** Week start (YYYY-MM-DD) of the weekly summary card you dismissed. */
  summary_dismissed: string | null;
  /** Your own exercise -> muscle choices (lowercased names); otherwise guessed from the name. */
  exercise_muscles: Record<string, Muscle>;
  last_backup_at: number | null;
};

export type ExportFile = {
  format_version: 1;
  exported_at?: string;
  targets: (Targets & { id?: number }) | null;
  foods: Food[];
  meals: Meal[];
  workouts: Workout[];
  weights?: BodyWeight[]; // absent in backups made before body weight tracking
  days?: Record<string, Partial<DayLog>>; // absent in backups made before water/notes
  habits?: Habit[];
  cardio?: Cardio[];
  measurements?: Measurement[];
  profile?: Profile | null;
  fasts?: Fast[];
  routines?: Routine[];
  exercise_muscles?: Record<string, Muscle>;
  goals?: FitnessGoal[];
};

const DB_NAME = "fitness-tracker";
const STORE = "kv";
const KEY = "state";

function emptyState(): State {
  return { version: 1, next_id: { food: 1, meal: 1, workout: 1, set: 1, weight: 1, habit: 1, cardio: 1, measure: 1, fast: 1, routine: 1, goal: 1 }, targets: null, foods: [], meals: [], workouts: [], weights: [], days: {}, habits: [], cardio: [], measurements: [], profile: null, fasts: [], routines: [], exercise_muscles: {}, goals: [], summary_dismissed: null, last_backup_at: null };
}

// Brings data saved by older versions of the app up to the current shape.
function migrate(state: State): State {
  state.foods = state.foods.map((food) => ({ ...food, servings: food.servings ?? [] }));
  state.last_backup_at ??= null;
  state.weights ??= [];
  state.days ??= {};
  state.habits ??= [];
  state.cardio ??= [];
  state.measurements ??= [];
  const nextAfter = (items: { id: number }[]) => items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
  state.next_id.habit ??= nextAfter(state.habits);
  state.next_id.cardio ??= nextAfter(state.cardio);
  state.next_id.measure ??= nextAfter(state.measurements);
  state.profile ??= null;
  state.fasts ??= [];
  state.next_id.fast ??= nextAfter(state.fasts);
  state.routines ??= [];
  state.exercise_muscles ??= {};
  state.next_id.routine ??= nextAfter(state.routines);
  state.goals ??= [];
  state.summary_dismissed ??= null;
  state.next_id.goal ??= nextAfter(state.goals);
  if (state.targets) {
    state.targets.water_ml ??= null;
    state.targets.steps ??= null;
  }
  state.next_id.weight ??= state.weights.reduce((max, entry) => Math.max(max, entry.id), 0) + 1;
  return state;
}

// ---------- IndexedDB persistence (whole state saved as one record) ----------

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Could not open on-device storage. Private Browsing can block it."));
  });
  return dbPromise;
}

async function readState(): Promise<State> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(migrate((request.result as State | undefined) ?? emptyState()));
    request.onerror = () => reject(new Error("Could not read your saved data."));
  });
}

async function writeState(state: State): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(state, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error("Could not save. Your device storage may be full."));
  });
}

let cache: Promise<State> | null = null;
const load = () => (cache ??= readState());

// Mutations run one at a time so two quick taps can't overwrite each other.
let queue: Promise<unknown> = Promise.resolve();
// State from just before the most recent delete, for Undo. Any other change clears it, so an
// undo can never wipe out something added after the delete.
let undoState: State | null = null;
function mutate<T>(change: (state: State) => T, { undoable = false } = {}): Promise<T> {
  const run = queue.then(async () => {
    const current = await load();
    const draft: State = structuredClone(current);
    const result = change(draft);
    await writeState(draft);
    cache = Promise.resolve(draft);
    undoState = undoable ? current : null;
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

// Ask iOS/Chrome not to evict this data under storage pressure.
void navigator.storage?.persist?.().catch(() => undefined);

// ---------- validation ----------

const PREPARATIONS = ["raw", "cooked", "packaged", "unspecified"] as const;
const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];

function fail(message: string): never {
  throw new Error(message);
}
const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function cleanFood(body: FoodBody): FoodBody {
  const name = String(body.name ?? "").trim();
  if (!name || name.length > 120) fail("Food name must be 1–120 characters.");
  if (!PREPARATIONS.includes(body.preparation)) fail("Choose a preparation state.");
  const values = [body.calories_per_100g, body.protein_g_per_100g, body.carbohydrates_g_per_100g, body.fat_g_per_100g, body.fiber_g_per_100g];
  if (!values.every((value) => isNum(value) && value >= 0)) fail("Nutrition values must be non-negative numbers.");
  const servings = (body.servings ?? []).map((serving) => {
    const label = String(serving.label ?? "").trim();
    if (!label || label.length > 40) fail("Each serving needs a name of up to 40 characters.");
    if (!isNum(serving.grams) || serving.grams <= 0 || serving.grams > 10000) fail("Serving sizes must be between 0 and 10,000 g.");
    return { label, grams: serving.grams };
  });
  if (servings.length > 10) fail("Add up to 10 servings per food.");
  const extra = (value: number | null | undefined) => {
    if (value === null || value === undefined) return null;
    if (!isNum(value) || value < 0) fail("Sugar, saturated fat and sodium must be non-negative numbers, or left blank.");
    return value;
  };
  return {
    ...body, name, brand: body.brand?.trim() || null, notes: body.notes?.trim() || null, servings,
    sugar_g_per_100g: extra(body.sugar_g_per_100g), sat_fat_g_per_100g: extra(body.sat_fat_g_per_100g), sodium_mg_per_100g: extra(body.sodium_mg_per_100g),
  };
}

function cleanWorkout(body: WorkoutBody, nextSetId: () => number): Omit<Workout, "id"> {
  const name = body.name.trim();
  if (!name || name.length > 120) fail("Workout name must be 1–120 characters.");
  if (body.sets.length < 1 || body.sets.length > 200) fail("Add between 1 and 200 sets.");
  const sets: WorkoutSet[] = body.sets.map((set) => {
    const exercise_name = set.exercise_name.trim();
    if (!exercise_name) fail("Exercise name cannot be blank.");
    if (!Number.isInteger(set.reps) || set.reps < 1 || set.reps > 1000) fail("Reps must be a whole number from 1 to 1000.");
    if (!isNum(set.weight_kg) || set.weight_kg < 0 || set.weight_kg > 10000) fail("Weight must be 0–10,000 kg.");
    return { id: nextSetId(), exercise_name, set_number: set.set_number, reps: set.reps, weight_kg: set.weight_kg };
  });
  return { name, date: body.date, notes: body.notes?.trim() || null, sets };
}

function cleanTargets(body: Targets): Targets {
  const out = { ...EMPTY_TARGETS };
  for (const key of Object.keys(out) as (keyof Targets)[]) {
    const value = body[key];
    if (value === null || value === undefined) continue;
    if (!isNum(value) || value <= 0) fail("Targets must be positive numbers, or left blank.");
    out[key] = key === "protein_g" || key === "carbohydrates_g" || key === "fat_g" || key === "fiber_g" ? value : Math.round(value);
  }
  return out;
}

const EMPTY_TARGETS: Targets = { calories: null, protein_g: null, carbohydrates_g: null, fat_g: null, fiber_g: null, workouts_per_week: null, water_ml: null, steps: null };

// ---------- date helpers (YYYY-MM-DD strings, timezone-safe) ----------

const DAY_MS = 86_400_000;
const toUtc = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fullDay(entry: Partial<DayLog> | undefined): DayLog {
  return { water_ml: entry?.water_ml ?? 0, note: entry?.note ?? "", sleep: entry?.sleep ?? null, steps: entry?.steps ?? null, habits_done: entry?.habits_done ?? [] };
}
function editDay(state: State, date: string): DayLog {
  const entry = fullDay(state.days[date]);
  state.days[date] = entry;
  return entry;
}

const CARDIO_TYPES: CardioType[] = ["run", "walk", "cycle", "swim", "other"];
const MEASURE_KEYS: MeasureKey[] = ["waist_cm", "hips_cm", "chest_cm", "arm_cm", "thigh_cm", "body_fat_pct"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Sugar / saturated fat / sodium for a portion; null when the food doesn't have the value. */
function extrasFor(food: Food, factor: number) {
  const scale = (value: number | null | undefined) => (value == null ? null : value * factor);
  return { sugar_g: scale(food.sugar_g_per_100g), sat_fat_g: scale(food.sat_fat_g_per_100g), sodium_mg: scale(food.sodium_mg_per_100g) };
}

const publicMeal = ({ created_at: _created, ...meal }: StoredMeal): Meal => meal;

// ---------- API (same shape the UI used with the server) ----------

export const api = {
  async dashboard(date: string): Promise<DashboardData> {
    const state = await load();
    const dayMeals = state.meals.filter((meal) => meal.date === date);
    const sum = (meals: Meal[], key: "calories" | "protein_g" | "carbohydrates_g" | "fat_g" | "fiber_g") =>
      meals.reduce((total, meal) => total + meal[key], 0);
    const totals = {
      calories: sum(dayMeals, "calories"),
      protein_g: sum(dayMeals, "protein_g"),
      carbohydrates_g: sum(dayMeals, "carbohydrates_g"),
      fat_g: sum(dayMeals, "fat_g"),
      fiber_g: sum(dayMeals, "fiber_g"),
      sugar_g: dayMeals.reduce((total, meal) => total + (meal.sugar_g ?? 0), 0),
      sat_fat_g: dayMeals.reduce((total, meal) => total + (meal.sat_fat_g ?? 0), 0),
      sodium_mg: dayMeals.reduce((total, meal) => total + (meal.sodium_mg ?? 0), 0),
      extras_known: dayMeals.some((meal) => meal.sugar_g != null || meal.sat_fat_g != null || meal.sodium_mg != null),
    };
    const targets = state.targets ?? EMPTY_TARGETS;
    const remaining: Targets = { ...EMPTY_TARGETS };
    for (const key of ["calories", "protein_g", "carbohydrates_g", "fat_g", "fiber_g"] as const) {
      const target = targets[key];
      remaining[key] = target === null ? null : Math.max(target - totals[key], 0);
    }

    const dayMs = toUtc(date);
    const weekStart = dayMs - ((new Date(dayMs).getUTCDay() + 6) % 7) * DAY_MS; // Monday
    const days = Array.from({ length: 7 }, (_, offset) => {
      const ms = weekStart + offset * DAY_MS;
      const iso = fromUtc(ms);
      return {
        date: iso,
        label: WEEKDAYS[new Date(ms).getUTCDay()],
        calories: sum(state.meals.filter((meal) => meal.date === iso), "calories"),
        workouts: state.workouts.filter((workout) => workout.date === iso).length + state.cardio.filter((session) => session.date === iso).length,
      };
    });

    return {
      date,
      totals,
      targets: { ...targets },
      remaining,
      workouts_today: state.workouts.filter((workout) => workout.date === date).sort((a, b) => b.id - a.id),
      weekly: {
        start: fromUtc(weekStart),
        end: fromUtc(weekStart + 6 * DAY_MS),
        workout_count: days.reduce((total, day) => total + day.workouts, 0),
        workout_target: targets.workouts_per_week,
        days,
      },
    };
  },

  async foods(search = ""): Promise<Food[]> {
    const term = search.trim().toLowerCase();
    return (await load()).foods
      .filter((food) => !term || food.name.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async meals(date: string): Promise<Meal[]> {
    return (await load()).meals
      .filter((meal) => meal.date === date)
      .sort((a, b) => b.created_at - a.created_at || b.id - a.id)
      .map(publicMeal);
  },

  async workouts(): Promise<Workout[]> {
    return [...(await load()).workouts]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .slice(0, 50);
  },

  createFood: (body: FoodBody & { source?: FoodSource }) =>
    mutate((state) => {
      const { source, ...rest } = body;
      const food: Food = { ...cleanFood(rest), id: state.next_id.food++, source: source === "open-food-facts" || source === "usda" || source === "ai" ? source : "user-entered", is_verified: false };
      state.foods.push(food);
      return food;
    }),

  updateFood: (id: number, body: FoodBody) =>
    mutate((state) => {
      const index = state.foods.findIndex((food) => food.id === id);
      if (index < 0) fail("Food not found.");
      state.foods[index] = { ...state.foods[index], ...cleanFood(body) };
      return state.foods[index];
    }),

  deleteFood: (id: number) =>
    mutate((state) => {
      if (!state.foods.some((food) => food.id === id)) fail("Food not found.");
      if (state.meals.some((meal) => meal.food_id === id)) fail("This food has meal history and cannot be deleted.");
      state.foods = state.foods.filter((food) => food.id !== id);
    }, { undoable: true }),

  createMeal: (body: MealBody) =>
    mutate((state) => {
      const food = state.foods.find((item) => item.id === body.food_id) ?? fail("Food not found. Refresh and try again.");
      if (!MEAL_TYPES.includes(body.meal_type)) fail("Choose a meal type.");
      if (!isNum(body.portion_g) || body.portion_g <= 0 || body.portion_g > 10000) fail("Enter a portion between 0 and 10,000 g.");
      const factor = body.portion_g / 100;
      // Nutrition is snapshotted so later edits to the food don't rewrite history.
      const meal: StoredMeal = {
        id: state.next_id.meal++,
        food_id: food.id,
        food_name: food.name,
        preparation: food.preparation,
        date: body.date,
        meal_type: body.meal_type,
        portion_g: body.portion_g,
        calories: food.calories_per_100g * factor,
        protein_g: food.protein_g_per_100g * factor,
        carbohydrates_g: food.carbohydrates_g_per_100g * factor,
        fat_g: food.fat_g_per_100g * factor,
        fiber_g: food.fiber_g_per_100g * factor,
        ...extrasFor(food, factor),
        created_at: Date.now(),
      };
      state.meals.push(meal);
      return publicMeal(meal);
    }),

  deleteMeal: (id: number) =>
    mutate((state) => {
      if (!state.meals.some((meal) => meal.id === id)) fail("Meal log not found.");
      state.meals = state.meals.filter((meal) => meal.id !== id);
    }, { undoable: true }),

  createWorkout: (body: WorkoutBody) =>
    mutate((state) => {
      const workout: Workout = { ...cleanWorkout(body, () => state.next_id.set++), id: state.next_id.workout++ };
      state.workouts.push(workout);
      return workout;
    }),

  updateWorkout: (id: number, body: WorkoutBody) =>
    mutate((state) => {
      const index = state.workouts.findIndex((workout) => workout.id === id);
      if (index < 0) fail("Workout not found.");
      state.workouts[index] = { ...cleanWorkout(body, () => state.next_id.set++), id };
      return state.workouts[index];
    }),

  /** Change portion, meal or day. Nutrition is rescaled from the saved snapshot, not the current food values. */
  updateMeal: (id: number, body: { date: string; meal_type: string; portion_g: number }) =>
    mutate((state) => {
      const meal = state.meals.find((item) => item.id === id) ?? fail("Meal log not found.");
      if (!MEAL_TYPES.includes(body.meal_type)) fail("Choose a meal type.");
      if (!isNum(body.portion_g) || body.portion_g <= 0 || body.portion_g > 10000) fail("Enter a portion between 0 and 10,000 g.");
      const ratio = body.portion_g / meal.portion_g;
      for (const key of ["calories", "protein_g", "carbohydrates_g", "fat_g", "fiber_g"] as const) meal[key] *= ratio;
      for (const key of ["sugar_g", "sat_fat_g", "sodium_mg"] as const) if (meal[key] != null) meal[key] = (meal[key] as number) * ratio;
      meal.portion_g = body.portion_g;
      meal.meal_type = body.meal_type;
      meal.date = body.date;
      return publicMeal(meal);
    }),

  /** Food ids most recently logged, newest first. */
  async recentFoodIds(limit = 6): Promise<number[]> {
    const state = await load();
    const ids: number[] = [];
    for (const meal of [...state.meals].sort((a, b) => b.created_at - a.created_at)) {
      if (!ids.includes(meal.food_id) && state.foods.some((food) => food.id === meal.food_id)) ids.push(meal.food_id);
      if (ids.length >= limit) break;
    }
    return ids;
  },

  async backupStatus(): Promise<BackupStatus> {
    const state = await load();
    return { last_backup_at: state.last_backup_at, has_data: state.foods.length + state.meals.length + state.workouts.length + state.weights.length + state.cardio.length + state.measurements.length + Object.keys(state.days).length > 0 };
  },

  markBackedUp: () =>
    mutate((state) => {
      state.last_backup_at = Date.now();
    }),

  deleteWorkout: (id: number) =>
    mutate((state) => {
      if (!state.workouts.some((workout) => workout.id === id)) fail("Workout not found.");
      state.workouts = state.workouts.filter((workout) => workout.id !== id);
    }, { undoable: true }),

  saveTargets: (body: Targets) =>
    mutate((state) => {
      state.targets = cleanTargets(body);
      return state.targets;
    }),

  // ---------- body weight ----------

  async weights(): Promise<BodyWeight[]> {
    return [...(await load()).weights].sort((a, b) => a.date.localeCompare(b.date));
  },

  /** One entry per day: saving again for the same day replaces it. */
  saveWeight: (date: string, weight_kg: number) =>
    mutate((state) => {
      if (!isNum(weight_kg) || weight_kg < 20 || weight_kg > 400) fail("Enter a body weight between 20 and 400 kg.");
      const value = Math.round(weight_kg * 10) / 10;
      const existing = state.weights.find((entry) => entry.date === date);
      if (existing) existing.weight_kg = value;
      else state.weights.push({ id: state.next_id.weight++, date, weight_kg: value });
    }),

  deleteWeight: (id: number) =>
    mutate((state) => {
      state.weights = state.weights.filter((entry) => entry.id !== id);
    }, { undoable: true }),

  /** Restores everything to just before the last delete. */
  undo: () =>
    mutate((state) => {
      if (!undoState) fail("Nothing to undo.");
      Object.assign(state, structuredClone(undoState));
    }),

  // ---------- water and notes ----------

  async day(date: string): Promise<DayLog> {
    return fullDay((await load()).days[date]);
  },

  addWater: (date: string, ml: number) =>
    mutate((state) => {
      const entry = editDay(state, date);
      entry.water_ml = Math.max(0, Math.min(20000, entry.water_ml + Math.round(ml)));
      return entry.water_ml;
    }),

  setNote: (date: string, note: string) =>
    mutate((state) => {
      editDay(state, date).note = note.slice(0, 2000);
    }),

  // ---------- AI coach snapshot ----------

  /** A compact text summary of recent data for the AI coach (sent only when you ask it something). */
  async coachSnapshot(today: string): Promise<string> {
    const state = await load();
    const r = (value: number) => Math.round(value);
    const lines: string[] = [];
    if (state.profile) {
      const p = state.profile;
      lines.push(`Profile: ${p.sex}, age ${new Date().getFullYear() - p.birth_year}, height ${p.height_cm} cm, activity ${p.activity}, goal ${p.goal}.`);
    }
    const t = state.targets;
    if (t) lines.push(`Targets: ${[t.calories && `${t.calories} kcal`, t.protein_g && `${t.protein_g} g protein`, t.carbohydrates_g && `${t.carbohydrates_g} g carbs`, t.fat_g && `${t.fat_g} g fat`, t.fiber_g && `${t.fiber_g} g fiber`, t.workouts_per_week && `${t.workouts_per_week} workouts/week`, t.steps && `${t.steps} steps/day`, t.water_ml && `${t.water_ml} ml water/day`].filter(Boolean).join(", ") || "none set"}.`);

    lines.push("Last 14 days (date: kcal, protein g, carbs g, fat g | sessions | sleep h | steps | water ml):");
    const trend = await api.trends(today, 14);
    for (const day of trend.days) {
      const log = fullDay(state.days[day.date]);
      const food = day.logged ? `${r(day.calories)} kcal, ${r(day.protein_g)}p, ${r(day.carbohydrates_g)}c, ${r(day.fat_g)}f` : "no food logged";
      lines.push(`${day.date}: ${food} | ${day.workouts} | ${day.sleep_h === null ? "-" : day.sleep_h.toFixed(1)} | ${day.steps ?? "-"} | ${log.water_ml || "-"}`);
    }
    lines.push(`Streaks: food logged ${trend.food_streak} days in a row; workout target met ${trend.workout_week_streak} weeks in a row.`);

    const weights = state.weights.filter((entry) => entry.date >= fromUtc(toUtc(today) - 42 * DAY_MS)).sort((a, b) => a.date.localeCompare(b.date));
    if (weights.length) lines.push(`Weigh-ins (last 6 weeks, kg): ${weights.map((entry) => `${entry.date} ${entry.weight_kg}`).join("; ")}.`);
    const energy = await api.energyEstimate(today);
    if (energy.ready) lines.push(`Measured daily burn: about ${energy.tdee} kcal (avg intake ${energy.intake_avg} kcal, weight trend ${energy.kg_per_week} kg/week).`);

    const goals = await api.goals(today);
    for (const g of goals) {
      const what = g.goal.kind === "weight" ? "body weight" : g.goal.kind === "lift" ? `${g.goal.exercise} (top set)` : g.goal.measure;
      lines.push(`Goal: ${what} from ${g.goal.start_value} to ${g.goal.target}${g.goal.deadline ? ` by ${g.goal.deadline}` : ""}; now ${g.current ?? "?"}; status ${g.status}${g.projected_date ? `, projected ${g.projected_date}` : ""}.`);
    }

    const recentWorkouts = [...state.workouts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
    for (const w of recentWorkouts) {
      const tops = new Map<string, { kg: number; reps: number; sets: number }>();
      for (const set of w.sets) {
        const top = tops.get(set.exercise_name) ?? { kg: 0, reps: 0, sets: 0 };
        top.sets++;
        if (set.weight_kg >= top.kg) { top.kg = set.weight_kg; top.reps = set.reps; }
        tops.set(set.exercise_name, top);
      }
      lines.push(`Workout ${w.date} "${w.name}": ${[...tops.entries()].map(([name, top]) => `${name} ${top.sets} sets, top ${top.kg} kg x ${top.reps}`).join("; ")}.`);
    }
    for (const c of [...state.cardio].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)) {
      lines.push(`Cardio ${c.date}: ${c.type} ${c.minutes} min${c.distance_km ? `, ${c.distance_km} km` : ""}.`);
    }
    if (state.routines.length) lines.push(`Plans: ${state.routines.map((p) => `${p.name} (${p.exercises.map((e) => `${e.name} ${e.sets}x${e.reps}`).join(", ")})`).join("; ")}.`);
    const habits = state.habits.filter((habit) => !habit.archived);
    if (habits.length) {
      const week = Array.from({ length: 7 }, (_, i) => fullDay(state.days[fromUtc(toUtc(today) - i * DAY_MS)]));
      lines.push(`Habits (done in last 7 days): ${habits.map((habit) => `${habit.name} ${week.filter((log) => log.habits_done.includes(habit.id)).length}/7`).join(", ")}.`);
    }
    const latestMeasure = [...state.measurements].sort((a, b) => b.date.localeCompare(a.date))[0];
    if (latestMeasure) lines.push(`Latest measurements (${latestMeasure.date}): ${MEASURE_KEYS.filter((key) => latestMeasure[key] != null).map((key) => `${key} ${latestMeasure[key]}`).join(", ")}.`);
    const todayNote = fullDay(state.days[today]).note;
    if (todayNote) lines.push(`Today's note: ${todayNote}`);
    return lines.join("\n");
  },

  // ---------- weekly summary ----------

  /** Summary of the Monday–Sunday week starting `start`, compared with the week before. */
  async weekSummary(start: string): Promise<WeekSummary> {
    const state = await load();
    const startMs = toUtc(start);
    const dates = (from: number) => Array.from({ length: 7 }, (_, i) => fromUtc(from + i * DAY_MS));
    const thisWeek = dates(startMs);
    const lastWeek = dates(startMs - 7 * DAY_MS);
    const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

    const numbers = (days: string[]) => {
      const set = new Set(days);
      const intake = new Map<string, { kcal: number; protein: number }>();
      for (const meal of state.meals) {
        if (!set.has(meal.date)) continue;
        const day = intake.get(meal.date) ?? { kcal: 0, protein: 0 };
        day.kcal += meal.calories;
        day.protein += meal.protein_g;
        intake.set(meal.date, day);
      }
      const logs = days.map((day) => fullDay(state.days[day]));
      return {
        intake,
        logs,
        calories_avg: avg([...intake.values()].map((day) => day.kcal)),
        protein_avg: avg([...intake.values()].map((day) => day.protein)),
        sessions: state.workouts.filter((w) => set.has(w.date)).length + state.cardio.filter((c) => set.has(c.date)).length,
        sleep_avg_h: avg(logs.filter((log) => log.sleep).map((log) => sleepHours(log.sleep!.bed, log.sleep!.wake))),
        steps_avg: avg(logs.filter((log) => log.steps != null).map((log) => log.steps as number)),
        weight_avg: avg(state.weights.filter((entry) => set.has(entry.date)).map((entry) => entry.weight_kg)),
      };
    };
    const current = numbers(thisWeek);
    const previous = numbers(lastWeek);
    const inWeek = new Set(thisWeek);
    const target = state.targets?.calories ?? null;

    // New bests: heaviest set this week beats everything logged before the week.
    const new_bests: { exercise: string; weight_kg: number }[] = [];
    const weekTop = new Map<string, { name: string; kg: number }>();
    for (const workout of state.workouts.filter((w) => inWeek.has(w.date))) {
      for (const set of workout.sets) {
        const key = set.exercise_name.toLowerCase();
        if (set.weight_kg > (weekTop.get(key)?.kg ?? 0)) weekTop.set(key, { name: set.exercise_name, kg: set.weight_kg });
      }
    }
    for (const [key, top] of weekTop) {
      const before = state.workouts.filter((w) => w.date < start).flatMap((w) => w.sets).filter((set) => set.exercise_name.toLowerCase() === key);
      if (before.length && top.kg > Math.max(...before.map((set) => set.weight_kg))) new_bests.push({ exercise: top.name, weight_kg: top.kg });
    }

    const cardio = state.cardio.filter((c) => inWeek.has(c.date));
    const activeHabits = state.habits.filter((habit) => !habit.archived).map((habit) => habit.id);
    const habitDone = current.logs.reduce((sum, log) => sum + log.habits_done.filter((id) => activeHabits.includes(id)).length, 0);
    const water = current.logs.filter((log) => log.water_ml > 0).map((log) => log.water_ml);
    const strength = state.workouts.filter((w) => inWeek.has(w.date));
    const strip = ({ intake: _i, logs: _l, ...rest }: ReturnType<typeof numbers>) => rest;

    return {
      start,
      end: thisWeek[6],
      has_data: current.intake.size > 0 || current.sessions > 0 || current.weight_avg !== null || current.sleep_avg_h !== null,
      food: {
        days_logged: current.intake.size,
        calories_avg: current.calories_avg,
        protein_avg: current.protein_avg,
        days_on_target: target ? [...current.intake.values()].filter((day) => Math.abs(day.kcal - target) <= target * 0.1).length : null,
        calorie_target: target,
      },
      training: {
        strength: strength.length,
        cardio: cardio.length,
        sets: strength.reduce((sum, w) => sum + w.sets.length, 0),
        cardio_minutes: cardio.reduce((sum, c) => sum + c.minutes, 0),
        cardio_km: cardio.reduce((sum, c) => sum + (c.distance_km ?? 0), 0),
        target: state.targets?.workouts_per_week ?? null,
        new_bests,
      },
      body: {
        weight_avg: current.weight_avg,
        weight_change: current.weight_avg !== null && previous.weight_avg !== null ? current.weight_avg - previous.weight_avg : null,
        sleep_avg_h: current.sleep_avg_h,
        nights: current.logs.filter((log) => log.sleep).length,
        steps_avg: current.steps_avg,
        water_avg_ml: avg(water),
      },
      habits: { done: habitDone, possible: activeHabits.length * 7 },
      current: strip(current),
      previous: strip(previous),
    };
  },

  async summaryDismissed(): Promise<string | null> {
    return (await load()).summary_dismissed;
  },

  dismissSummary: (weekStart: string) =>
    mutate((state) => {
      state.summary_dismissed = weekStart;
    }),

  // ---------- goals ----------

  /** Goals with progress and a projection from the recent trend (least-squares over the last 6 weeks). */
  async goals(today: string): Promise<GoalStatus[]> {
    const state = await load();
    const todayMs = toUtc(today);
    return state.goals.map((goal) => {
      // The data series for this goal: [date, value] in stored units.
      let series: [string, number][] = [];
      if (goal.kind === "weight") series = state.weights.map((entry) => [entry.date, entry.weight_kg]);
      else if (goal.kind === "measure" && goal.measure) series = state.measurements.filter((entry) => entry[goal.measure!] != null).map((entry) => [entry.date, entry[goal.measure!] as number]);
      else if (goal.kind === "lift" && goal.exercise) {
        const key = goal.exercise.toLowerCase();
        const best = new Map<string, number>();
        for (const workout of state.workouts) for (const set of workout.sets) if (set.exercise_name.toLowerCase() === key) best.set(workout.date, Math.max(best.get(workout.date) ?? 0, set.weight_kg));
        series = [...best.entries()];
      }
      series.sort((a, b) => a[0].localeCompare(b[0]));
      const up = goal.target >= goal.start_value;
      // Lifts: your best so far counts; body numbers: the latest value.
      const current = !series.length ? null : goal.kind === "lift" ? Math.max(...series.map(([, v]) => v)) : series[series.length - 1][1];
      const span = goal.target - goal.start_value;
      const percent = current === null ? 0 : span === 0 ? 100 : Math.max(0, Math.min(100, ((current - goal.start_value) / span) * 100));
      const base = { goal, current, percent, per_week: null as number | null, projected_date: null as string | null };
      if (current === null) return { ...base, status: "no_data" as const };
      if (up ? current >= goal.target : current <= goal.target) return { ...base, percent: 100, status: "reached" as const };

      const recent = series.filter(([date]) => toUtc(date) >= todayMs - 42 * DAY_MS);
      const days = recent.length >= 2 ? (toUtc(recent[recent.length - 1][0]) - toUtc(recent[0][0])) / DAY_MS : 0;
      if (recent.length < 2 || days < 7) return { ...base, status: "no_trend" as const };
      const xs = recent.map(([date]) => toUtc(date) / DAY_MS);
      const ys = recent.map(([, value]) => value);
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      const denominator = xs.reduce((acc, x) => acc + (x - mx) ** 2, 0);
      const slope = denominator ? xs.reduce((acc, x, i) => acc + (x - mx) * (ys[i] - my), 0) / denominator : 0;
      const per_week = slope * 7;
      if (slope === 0 || (up ? slope < 0 : slope > 0)) return { ...base, per_week, status: "away" as const };
      const daysToGo = Math.ceil((goal.target - current) / slope);
      const projected_date = fromUtc(todayMs + Math.min(daysToGo, 3650) * DAY_MS);
      const status = goal.deadline && projected_date > goal.deadline ? "behind" as const : "on_track" as const;
      return { ...base, per_week, projected_date, status };
    });
  },

  /** New goals record the current value as the starting point. */
  saveGoal: (body: Omit<FitnessGoal, "id" | "start_value" | "start_date">, today: string, id?: number) =>
    mutate((state) => {
      if (!["weight", "lift", "measure"].includes(body.kind)) fail("Choose a goal type.");
      if (body.kind === "lift" && !body.exercise?.trim()) fail("Choose an exercise.");
      if (body.kind === "measure" && !body.measure) fail("Choose a measurement.");
      if (!isNum(body.target) || body.target <= 0) fail("Enter a target value.");
      if (body.deadline && body.deadline <= today) fail("The deadline must be in the future.");
      const clean = { kind: body.kind, exercise: body.kind === "lift" ? body.exercise!.trim() : null, measure: body.kind === "measure" ? body.measure : null, target: Math.round(body.target * 100) / 100, deadline: body.deadline || null };
      if (id !== undefined) {
        const goal = state.goals.find((item) => item.id === id) ?? fail("FitnessGoal not found.");
        Object.assign(goal, clean);
        return;
      }
      let start_value: number | null = null;
      if (clean.kind === "weight") start_value = [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.weight_kg ?? null;
      if (clean.kind === "measure") start_value = [...state.measurements].sort((a, b) => a.date.localeCompare(b.date)).filter((entry) => entry[clean.measure!] != null).at(-1)?.[clean.measure!] ?? null;
      if (clean.kind === "lift") {
        const key = clean.exercise!.toLowerCase();
        const weights = state.workouts.flatMap((w) => w.sets).filter((set) => set.exercise_name.toLowerCase() === key).map((set) => set.weight_kg);
        start_value = weights.length ? Math.max(...weights) : null;
      }
      if (start_value === null) fail(clean.kind === "weight" ? "Log a weigh-in first, so progress has a starting point." : clean.kind === "lift" ? "Log this exercise at least once first." : "Log this measurement at least once first.");
      state.goals.push({ id: state.next_id.goal++, ...clean, start_value, start_date: today });
    }),

  deleteGoal: (id: number) =>
    mutate((state) => {
      state.goals = state.goals.filter((goal) => goal.id !== id);
    }, { undoable: true }),

  // ---------- workout plans ----------

  async routines(): Promise<Routine[]> {
    return [...(await load()).routines].sort((a, b) => (Math.min(...a.days, 7) - Math.min(...b.days, 7)) || a.name.localeCompare(b.name));
  },

  saveRoutine: (body: Omit<Routine, "id">, id?: number) =>
    mutate((state) => {
      const name = body.name.trim();
      if (!name || name.length > 60) fail("Plan names are 1–60 characters.");
      const days = [...new Set(body.days)].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort();
      if (body.exercises.length < 1 || body.exercises.length > 30) fail("Add between 1 and 30 exercises.");
      const exercises = body.exercises.map((exercise) => {
        const exerciseName = exercise.name.trim();
        if (!exerciseName || exerciseName.length > 120) fail("Each exercise needs a name.");
        if (!Number.isInteger(exercise.sets) || exercise.sets < 1 || exercise.sets > 20) fail("Sets must be 1–20.");
        if (!Number.isInteger(exercise.reps) || exercise.reps < 1 || exercise.reps > 100) fail("Reps must be 1–100.");
        return { name: exerciseName, sets: exercise.sets, reps: exercise.reps };
      });
      if (id === undefined) {
        state.routines.push({ id: state.next_id.routine++, name, days, exercises });
        return;
      }
      const index = state.routines.findIndex((routine) => routine.id === id);
      if (index < 0) fail("Plan not found.");
      state.routines[index] = { id, name, days, exercises };
    }),

  deleteRoutine: (id: number) =>
    mutate((state) => {
      state.routines = state.routines.filter((routine) => routine.id !== id);
    }, { undoable: true }),

  // ---------- muscle groups ----------

  async exerciseMuscles(): Promise<Record<string, Muscle>> {
    return { ...(await load()).exercise_muscles };
  },

  /** Your own choice of muscle for an exercise (null = go back to the automatic guess). */
  setExerciseMuscle: (exercise: string, muscle: Muscle | null) =>
    mutate((state) => {
      const key = exercise.trim().toLowerCase();
      if (!key) fail("Exercise name missing.");
      if (muscle === null) delete state.exercise_muscles[key];
      else state.exercise_muscles[key] = muscle;
    }),

  /** Working sets per muscle group over the `days` days ending on `end`. */
  async muscleVolume(end: string, days = 7): Promise<MuscleVolume> {
    const state = await load();
    const startMs = toUtc(end) - (days - 1) * DAY_MS;
    const counts = new Map<Muscle, number>();
    const unassigned = new Map<string, { exercise: string; sets: number }>();
    for (const workout of state.workouts) {
      const ms = toUtc(workout.date);
      if (ms < startMs || ms > toUtc(end)) continue;
      for (const set of workout.sets) {
        const key = set.exercise_name.toLowerCase();
        const muscle = state.exercise_muscles[key] ?? guessMuscle(set.exercise_name);
        if (muscle) counts.set(muscle, (counts.get(muscle) ?? 0) + 1);
        else {
          const entry = unassigned.get(key) ?? { exercise: set.exercise_name, sets: 0 };
          entry.sets++;
          unassigned.set(key, entry);
        }
      }
    }
    return {
      muscles: [...counts.entries()].map(([muscle, sets]) => ({ muscle, sets })).sort((a, b) => b.sets - a.sets),
      unassigned: [...unassigned.values()].sort((a, b) => b.sets - a.sets),
    };
  },

  // ---------- recipes ----------

  /**
   * Saves a recipe as a food: nutrition per 100 g is worked out from the ingredients (using their
   * current values), with a "1 portion" serving. Logging it then works like any other food.
   */
  saveRecipe: (body: { name: string; portions: number; ingredients: { food_id: number; grams: number }[] }, id?: number) =>
    mutate((state) => {
      const name = body.name.trim();
      if (!name || name.length > 120) fail("Recipe name must be 1–120 characters.");
      if (!Number.isInteger(body.portions) || body.portions < 1 || body.portions > 50) fail("Portions must be a whole number from 1 to 50.");
      if (body.ingredients.length < 1 || body.ingredients.length > 40) fail("Add between 1 and 40 ingredients.");
      const parts = body.ingredients.map((item) => {
        if (item.food_id === id) fail("A recipe can't include itself.");
        const food = state.foods.find((candidate) => candidate.id === item.food_id) ?? fail("An ingredient is no longer in your food library.");
        if (!isNum(item.grams) || item.grams <= 0 || item.grams > 20000) fail(`Enter grams for ${food.name}.`);
        return { food, grams: item.grams };
      });
      const total = parts.reduce((sum, part) => sum + part.grams, 0);
      const per100 = (pick: (food: Food) => number) => parts.reduce((sum, part) => sum + pick(part.food) * part.grams / 100, 0) * 100 / total;
      // Extras only when every ingredient has the value, so totals are never silently low.
      const extra = (pick: (food: Food) => number | null | undefined) => (parts.every((part) => pick(part.food) != null) ? per100((food) => pick(food) as number) : null);
      const round = (value: number) => Math.round(value * 10) / 10;
      const recipe: Recipe = { ingredients: parts.map((part) => ({ food_id: part.food.id, name: part.food.name, grams: part.grams })), portions: body.portions };
      const portion = { label: "1 portion", grams: Math.round(total / body.portions) };
      const values = {
        name, brand: null, preparation: "cooked" as const,
        calories_per_100g: round(per100((food) => food.calories_per_100g)),
        protein_g_per_100g: round(per100((food) => food.protein_g_per_100g)),
        carbohydrates_g_per_100g: round(per100((food) => food.carbohydrates_g_per_100g)),
        fat_g_per_100g: round(per100((food) => food.fat_g_per_100g)),
        fiber_g_per_100g: round(per100((food) => food.fiber_g_per_100g)),
        sugar_g_per_100g: (() => { const v = extra((food) => food.sugar_g_per_100g); return v == null ? null : round(v); })(),
        sat_fat_g_per_100g: (() => { const v = extra((food) => food.sat_fat_g_per_100g); return v == null ? null : round(v); })(),
        sodium_mg_per_100g: (() => { const v = extra((food) => food.sodium_mg_per_100g); return v == null ? null : Math.round(v); })(),
        notes: `Recipe · ${parts.length} ingredient${parts.length === 1 ? "" : "s"} · ${Math.round(total)} g total`,
        recipe,
      };
      if (id === undefined) {
        const food: Food = { ...values, id: state.next_id.food++, servings: [portion], source: "recipe", is_verified: false };
        state.foods.push(food);
        return food;
      }
      const index = state.foods.findIndex((food) => food.id === id);
      if (index < 0) fail("Recipe not found.");
      const others = state.foods[index].servings.filter((serving) => serving.label !== "1 portion");
      state.foods[index] = { ...state.foods[index], ...values, servings: [portion, ...others].slice(0, 10) };
      return state.foods[index];
    }),

  /** Copies every meal logged on `from` to `to` (keeping their saved nutrition). Undoable. */
  copyMeals: (from: string, to: string) =>
    mutate((state) => {
      const source = state.meals.filter((meal) => meal.date === from).sort((a, b) => a.created_at - b.created_at);
      if (!source.length) fail("Nothing was logged that day.");
      const now = Date.now();
      source.forEach((meal, index) => state.meals.push({ ...meal, id: state.next_id.meal++, date: to, created_at: now + index }));
      return source.length;
    }, { undoable: true }),

  // ---------- profile (for the target calculator) ----------

  async profile(): Promise<Profile | null> {
    return (await load()).profile;
  },

  saveProfile: (profile: Profile) =>
    mutate((state) => {
      const year = new Date().getFullYear();
      if (!["male", "female"].includes(profile.sex)) fail("Choose a sex for the formula.");
      if (!Number.isInteger(profile.birth_year) || profile.birth_year < year - 100 || profile.birth_year > year - 13) fail("Enter a birth year (age 13–100).");
      if (!isNum(profile.height_cm) || profile.height_cm < 100 || profile.height_cm > 250) fail("Height must be between 100 and 250 cm.");
      state.profile = { ...profile, height_cm: Math.round(profile.height_cm * 10) / 10 };
    }),

  // ---------- fasting ----------

  async fasting(): Promise<{ active: Fast | null; recent: Fast[] }> {
    const fasts = (await load()).fasts;
    return {
      active: fasts.find((fast) => fast.end === null) ?? null,
      recent: fasts.filter((fast) => fast.end !== null).sort((a, b) => (b.end as number) - (a.end as number)).slice(0, 7),
    };
  },

  startFast: (goal_h: number, start = Date.now()) =>
    mutate((state) => {
      if (state.fasts.some((fast) => fast.end === null)) fail("A fast is already running.");
      if (!isNum(goal_h) || goal_h < 1 || goal_h > 72) fail("Choose a goal between 1 and 72 hours.");
      if (start > Date.now() + 60_000 || start < Date.now() - 72 * 3_600_000) fail("The start time must be within the last 3 days.");
      state.fasts.push({ id: state.next_id.fast++, start, end: null, goal_h });
    }),

  /** Change the running fast's start time or goal. */
  adjustFast: (change: { start?: number; goal_h?: number }) =>
    mutate((state) => {
      const fast = state.fasts.find((item) => item.end === null) ?? fail("No fast is running.");
      if (change.start !== undefined) {
        if (change.start > Date.now() || change.start < Date.now() - 72 * 3_600_000) fail("The start time must be within the last 3 days.");
        fast.start = change.start;
      }
      if (change.goal_h !== undefined) fast.goal_h = change.goal_h;
    }),

  endFast: () =>
    mutate((state) => {
      const fast = state.fasts.find((item) => item.end === null) ?? fail("No fast is running.");
      fast.end = Date.now();
    }),

  deleteFast: (id: number) =>
    mutate((state) => {
      state.fasts = state.fasts.filter((fast) => fast.id !== id);
    }, { undoable: true }),

  // ---------- measured calorie burn ----------

  /**
   * Estimates your real daily burn over the 28 days before `today`: average logged intake minus
   * the energy implied by your weight trend (about 7,700 kcal per kg). Needs 14+ logged days and
   * weigh-ins spanning 10+ days. Assumes the days you logged are complete.
   */
  async energyEstimate(today: string): Promise<EnergyEstimate> {
    const state = await load();
    const window_days = 28;
    const endMs = toUtc(today) - DAY_MS; // today is usually still incomplete
    const startMs = endMs - (window_days - 1) * DAY_MS;
    const inWindow = (date: string) => toUtc(date) >= startMs && toUtc(date) <= endMs;
    const intakeByDay = new Map<string, number>();
    for (const meal of state.meals) if (inWindow(meal.date)) intakeByDay.set(meal.date, (intakeByDay.get(meal.date) ?? 0) + meal.calories);
    const weighins = state.weights.filter((entry) => inWindow(entry.date)).sort((a, b) => a.date.localeCompare(b.date));
    const days_logged = intakeByDay.size;
    const span = weighins.length >= 2 ? (toUtc(weighins[weighins.length - 1].date) - toUtc(weighins[0].date)) / DAY_MS : 0;
    if (days_logged < 14 || weighins.length < 2 || span < 10) {
      return { ready: false, days_logged, weighins: weighins.length, weigh_span_days: span, window_days };
    }
    // Weight trend: least-squares slope in kg/day, which smooths out day-to-day water swings.
    const xs = weighins.map((entry) => toUtc(entry.date) / DAY_MS);
    const ys = weighins.map((entry) => entry.weight_kg);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const slope = xs.reduce((acc, x, i) => acc + (x - mx) * (ys[i] - my), 0) / xs.reduce((acc, x) => acc + (x - mx) ** 2, 0);
    const intake_avg = [...intakeByDay.values()].reduce((a, b) => a + b, 0) / days_logged;
    const tdee = intake_avg - slope * 7700;
    return { ready: true, tdee: Math.round(tdee / 10) * 10, intake_avg: Math.round(intake_avg), kg_per_week: Math.round(slope * 7 * 100) / 100, days_logged, weighins: weighins.length, window_days };
  },

  // ---------- sleep and steps ----------

  /** Saves last night's sleep under `date` (the morning you woke up). Pass null to clear. */
  saveSleep: (date: string, sleep: Sleep | null) =>
    mutate((state) => {
      if (sleep) {
        if (!TIME.test(sleep.bed) || !TIME.test(sleep.wake)) fail("Enter bed and wake times.");
        if (!Number.isInteger(sleep.quality) || sleep.quality < 1 || sleep.quality > 5) fail("Rate sleep quality from 1 to 5.");
      }
      editDay(state, date).sleep = sleep;
    }),

  setSteps: (date: string, steps: number | null) =>
    mutate((state) => {
      if (steps !== null && (!Number.isInteger(steps) || steps < 0 || steps > 200000)) fail("Steps must be a whole number up to 200,000.");
      editDay(state, date).steps = steps;
    }),

  // ---------- habits ----------

  /** Active habits with whether they're done on `date`, and each one's streak up to `date`. */
  async habits(date: string): Promise<HabitStatus[]> {
    const state = await load();
    return state.habits.filter((habit) => !habit.archived).map((habit) => {
      const doneOn = (day: string) => fullDay(state.days[day]).habits_done.includes(habit.id);
      // Streak counts back from `date`; if it isn't ticked yet that day, start from the day before.
      let cursor = toUtc(date);
      if (!doneOn(date)) cursor -= DAY_MS;
      let streak = 0;
      while (doneOn(fromUtc(cursor))) { streak++; cursor -= DAY_MS; }
      return { id: habit.id, name: habit.name, done: doneOn(date), streak };
    });
  },

  toggleHabit: (date: string, habitId: number) =>
    mutate((state) => {
      const entry = editDay(state, date);
      entry.habits_done = entry.habits_done.includes(habitId) ? entry.habits_done.filter((id) => id !== habitId) : [...entry.habits_done, habitId];
    }),

  addHabit: (name: string) =>
    mutate((state) => {
      const clean = name.trim();
      if (!clean || clean.length > 60) fail("Habit names are 1–60 characters.");
      const active = state.habits.filter((habit) => !habit.archived);
      if (active.length >= 20) fail("You can track up to 20 habits.");
      if (active.some((habit) => habit.name.toLowerCase() === clean.toLowerCase())) fail("You already have that habit.");
      state.habits.push({ id: state.next_id.habit++, name: clean, archived: false });
    }),

  /** Hides a habit; its history stays in the days it was ticked. */
  removeHabit: (id: number) =>
    mutate((state) => {
      const habit = state.habits.find((item) => item.id === id) ?? fail("Habit not found.");
      habit.archived = true;
    }, { undoable: true }),

  // ---------- cardio ----------

  async cardio(): Promise<Cardio[]> {
    return [...(await load()).cardio].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 100);
  },

  saveCardio: (body: Omit<Cardio, "id">, id?: number) =>
    mutate((state) => {
      if (!CARDIO_TYPES.includes(body.type)) fail("Choose an activity.");
      if (!isNum(body.minutes) || body.minutes <= 0 || body.minutes > 1440) fail("Enter a duration in minutes.");
      if (body.distance_km !== null && (!isNum(body.distance_km) || body.distance_km < 0 || body.distance_km > 1000)) fail("Distance must be 0–1,000 km.");
      if (body.kcal !== null && (!isNum(body.kcal) || body.kcal < 0 || body.kcal > 20000)) fail("Calories must be 0–20,000.");
      const clean: Omit<Cardio, "id"> = { date: body.date, type: body.type, minutes: Math.round(body.minutes), distance_km: body.distance_km, kcal: body.kcal === null ? null : Math.round(body.kcal), note: body.note?.trim().slice(0, 300) || null };
      if (id === undefined) {
        const session: Cardio = { ...clean, id: state.next_id.cardio++ };
        state.cardio.push(session);
        return session;
      }
      const index = state.cardio.findIndex((item) => item.id === id);
      if (index < 0) fail("Session not found.");
      state.cardio[index] = { ...clean, id };
      return state.cardio[index];
    }),

  deleteCardio: (id: number) =>
    mutate((state) => {
      if (!state.cardio.some((item) => item.id === id)) fail("Session not found.");
      state.cardio = state.cardio.filter((item) => item.id !== id);
    }, { undoable: true }),

  // ---------- body measurements ----------

  async measurements(): Promise<Measurement[]> {
    return [...(await load()).measurements].sort((a, b) => a.date.localeCompare(b.date));
  },

  /** One entry per day: saving again for the same day replaces it. */
  saveMeasurement: (date: string, values: Record<MeasureKey, number | null>) =>
    mutate((state) => {
      const clean = {} as Record<MeasureKey, number | null>;
      for (const key of MEASURE_KEYS) {
        const value = values[key];
        if (value === null || value === undefined) { clean[key] = null; continue; }
        const max = key === "body_fat_pct" ? 75 : 300;
        if (!isNum(value) || value <= 0 || value > max) fail(key === "body_fat_pct" ? "Body fat must be between 0 and 75%." : "Measurements must be between 0 and 300 cm.");
        clean[key] = Math.round(value * 10) / 10;
      }
      if (MEASURE_KEYS.every((key) => clean[key] === null)) fail("Enter at least one measurement.");
      const existing = state.measurements.find((entry) => entry.date === date);
      if (existing) Object.assign(existing, clean);
      else state.measurements.push({ id: state.next_id.measure++, date, ...clean });
    }),

  deleteMeasurement: (id: number) =>
    mutate((state) => {
      state.measurements = state.measurements.filter((entry) => entry.id !== id);
    }, { undoable: true }),

  // ---------- trends ----------

  /** Daily totals for the `days` days ending on `end`, plus streaks. */
  async trends(end: string, days: number): Promise<Trends> {
    const state = await load();
    const endMs = toUtc(end);
    const list: TrendDay[] = Array.from({ length: days }, (_, index) => ({
      date: fromUtc(endMs - (days - 1 - index) * DAY_MS),
      calories: 0, protein_g: 0, carbohydrates_g: 0, fat_g: 0, fiber_g: 0, workouts: 0, logged: false, sleep_h: null, steps: null,
    }));
    const byDate = new Map(list.map((day) => [day.date, day]));
    for (const meal of state.meals) {
      const day = byDate.get(meal.date);
      if (!day) continue;
      day.logged = true;
      day.calories += meal.calories;
      day.protein_g += meal.protein_g;
      day.carbohydrates_g += meal.carbohydrates_g;
      day.fat_g += meal.fat_g;
      day.fiber_g += meal.fiber_g;
    }
    for (const session of [...state.workouts, ...state.cardio]) {
      const day = byDate.get(session.date);
      if (day) day.workouts += 1;
    }
    for (const day of list) {
      const entry = state.days[day.date];
      if (entry?.sleep) day.sleep_h = sleepHours(entry.sleep.bed, entry.sleep.wake);
      if (entry?.steps != null) day.steps = entry.steps;
    }

    // Food streak: consecutive days with a meal, ending today (today may still be empty).
    const mealDays = new Set(state.meals.map((meal) => meal.date));
    let cursor = mealDays.has(end) ? endMs : endMs - DAY_MS;
    let food_streak = 0;
    while (mealDays.has(fromUtc(cursor))) { food_streak++; cursor -= DAY_MS; }

    // Workout streak in weeks (Mon–Sun) meeting the weekly target; the current week counts once it's met.
    const target = state.targets?.workouts_per_week ?? 1;
    const weekCount = new Map<number, number>();
    const weekStart = (ms: number) => ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS;
    for (const workout of [...state.workouts, ...state.cardio]) {
      const start = weekStart(toUtc(workout.date));
      weekCount.set(start, (weekCount.get(start) ?? 0) + 1);
    }
    let week = weekStart(endMs);
    if ((weekCount.get(week) ?? 0) < target) week -= 7 * DAY_MS;
    let workout_week_streak = 0;
    while ((weekCount.get(week) ?? 0) >= target) { workout_week_streak++; week -= 7 * DAY_MS; }

    return { days: list, targets: state.targets ?? { ...EMPTY_TARGETS }, food_streak, workout_week_streak };
  },

  // ---------- exercise progress (uses all workouts, not just the recent 50) ----------

  async exercises(): Promise<ExerciseSummary[]> {
    const summaries = new Map<string, ExerciseSummary>();
    for (const workout of (await load()).workouts) {
      const names = new Set(workout.sets.map((set) => set.exercise_name));
      for (const name of names) {
        const key = name.toLowerCase();
        const current = summaries.get(key);
        if (!current) summaries.set(key, { name, sessions: 1, last_date: workout.date });
        else {
          current.sessions++;
          if (workout.date > current.last_date) current.last_date = workout.date;
        }
      }
    }
    return [...summaries.values()].sort((a, b) => b.last_date.localeCompare(a.last_date) || b.sessions - a.sessions);
  },

  /** One point per session (same-day sessions merged), oldest first. */
  async exerciseProgress(name: string): Promise<ExercisePoint[]> {
    const key = name.trim().toLowerCase();
    const byDate = new Map<string, ExercisePoint>();
    for (const workout of (await load()).workouts) {
      for (const set of workout.sets) {
        if (set.exercise_name.toLowerCase() !== key) continue;
        const point = byDate.get(workout.date) ?? { date: workout.date, top_weight_kg: 0, reps_at_top: 0, volume_kg: 0, sets: 0, e1rm_kg: null };
        point.sets++;
        const e1rm = estimate1RM(set.weight_kg, set.reps);
        if (e1rm !== null && (point.e1rm_kg === null || e1rm > point.e1rm_kg)) point.e1rm_kg = Math.round(e1rm * 10) / 10;
        point.volume_kg += set.reps * set.weight_kg;
        if (set.weight_kg > point.top_weight_kg || (set.weight_kg === point.top_weight_kg && set.reps > point.reps_at_top)) {
          point.top_weight_kg = set.weight_kg;
          point.reps_at_top = set.reps;
        }
        byDate.set(workout.date, point);
      }
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  },

  async exportData(): Promise<ExportFile> {
    const state = await load();
    return {
      format_version: 1,
      exported_at: new Date().toISOString(),
      targets: state.targets,
      foods: state.foods,
      meals: [...state.meals].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).map(publicMeal),
      workouts: [...state.workouts].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id),
      weights: [...state.weights].sort((a, b) => a.date.localeCompare(b.date)),
      days: state.days,
      habits: state.habits,
      cardio: [...state.cardio].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id),
      measurements: [...state.measurements].sort((a, b) => a.date.localeCompare(b.date)),
      profile: state.profile,
      fasts: state.fasts,
      routines: state.routines,
      exercise_muscles: state.exercise_muscles,
      goals: state.goals,
    };
  },

  /** Replaces ALL on-device data with the contents of a backup file. */
  importData: (file: unknown) =>
    mutate((state) => {
      const data = file as Partial<ExportFile> | null;
      if (!data || data.format_version !== 1 || !Array.isArray(data.foods) || !Array.isArray(data.meals) || !Array.isArray(data.workouts)) {
        fail("This doesn't look like a Fitness Tracker backup file.");
      }
      const foods = data.foods.map((food) => ({ ...cleanFood(food), id: food.id, source: food.source ?? "user-entered", is_verified: Boolean(food.is_verified) }));
      const meals: StoredMeal[] = data.meals.map((meal, index) => ({ ...meal, created_at: index }));
      const workouts = data.workouts;
      const maxId = (ids: number[]) => ids.reduce((max, id) => Math.max(max, id), 0) + 1;
      state.targets = data.targets ? cleanTargets({ ...EMPTY_TARGETS, ...data.targets }) : null;
      state.foods = foods;
      state.meals = meals;
      state.workouts = workouts;
      state.weights = (Array.isArray(data.weights) ? data.weights : []).filter(
        (entry) => entry && typeof entry.date === "string" && isNum(entry.weight_kg) && isNum(entry.id),
      );
      state.days = {};
      if (data.days && typeof data.days === "object") {
        for (const [date, entry] of Object.entries(data.days)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !entry) continue;
          const sleep = entry.sleep && TIME.test(entry.sleep.bed) && TIME.test(entry.sleep.wake) && isNum(entry.sleep.quality) ? entry.sleep : null;
          state.days[date] = {
            water_ml: isNum(entry.water_ml) ? Math.max(0, entry.water_ml) : 0,
            note: typeof entry.note === "string" ? entry.note.slice(0, 2000) : "",
            sleep,
            steps: isNum(entry.steps) ? Math.max(0, Math.round(entry.steps)) : null,
            habits_done: Array.isArray(entry.habits_done) ? entry.habits_done.filter(isNum) : [],
          };
        }
      }
      state.habits = (Array.isArray(data.habits) ? data.habits : []).filter((habit) => habit && isNum(habit.id) && typeof habit.name === "string").map((habit) => ({ id: habit.id, name: habit.name.slice(0, 60), archived: Boolean(habit.archived) }));
      state.cardio = (Array.isArray(data.cardio) ? data.cardio : []).filter((session) => session && isNum(session.id) && typeof session.date === "string" && isNum(session.minutes) && CARDIO_TYPES.includes(session.type));
      state.measurements = (Array.isArray(data.measurements) ? data.measurements : []).filter((entry) => entry && isNum(entry.id) && typeof entry.date === "string");
      state.profile = data.profile && typeof data.profile === "object" && isNum(data.profile.height_cm) ? data.profile : null;
      state.fasts = (Array.isArray(data.fasts) ? data.fasts : []).filter((fast) => fast && isNum(fast.id) && isNum(fast.start) && isNum(fast.goal_h));
      state.routines = (Array.isArray(data.routines) ? data.routines : []).filter((routine) => routine && isNum(routine.id) && typeof routine.name === "string" && Array.isArray(routine.days) && Array.isArray(routine.exercises));
      state.exercise_muscles = data.exercise_muscles && typeof data.exercise_muscles === "object" ? { ...data.exercise_muscles } : {};
      state.goals = (Array.isArray(data.goals) ? data.goals : []).filter((goal) => goal && isNum(goal.id) && isNum(goal.target) && isNum(goal.start_value));
      state.last_backup_at = Date.now(); // the file just restored from is a backup
      state.next_id = {
        food: maxId(foods.map((food) => food.id)),
        meal: maxId(meals.map((meal) => meal.id)),
        workout: maxId(workouts.map((workout) => workout.id)),
        set: maxId(workouts.flatMap((workout) => workout.sets.map((set) => set.id ?? 0))),
        weight: maxId(state.weights.map((entry) => entry.id)),
        habit: maxId(state.habits.map((habit) => habit.id)),
        cardio: maxId(state.cardio.map((session) => session.id)),
        measure: maxId(state.measurements.map((entry) => entry.id)),
        fast: maxId(state.fasts.map((fast) => fast.id)),
        routine: maxId(state.routines.map((routine) => routine.id)),
        goal: maxId(state.goals.map((goal) => goal.id)),
      };
      return { foods: foods.length, meals: meals.length, workouts: workouts.length };
    }),
};
