// On-device data layer. Everything is stored in this browser's IndexedDB on the phone:
// no server, works offline. Mirrors the calculations the old FastAPI backend did.
import type { BackupStatus, BodyWeight, DashboardData, ExercisePoint, ExerciseSummary, Food, Meal, Targets, TrendDay, Trends, Workout, WorkoutSet } from "./types";

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
  next_id: { food: number; meal: number; workout: number; set: number; weight: number };
  targets: Targets | null;
  foods: Food[];
  meals: StoredMeal[];
  workouts: Workout[];
  weights: BodyWeight[];
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
};

const DB_NAME = "fitness-tracker";
const STORE = "kv";
const KEY = "state";

function emptyState(): State {
  return { version: 1, next_id: { food: 1, meal: 1, workout: 1, set: 1, weight: 1 }, targets: null, foods: [], meals: [], workouts: [], weights: [], last_backup_at: null };
}

// Brings data saved by older versions of the app up to the current shape.
function migrate(state: State): State {
  state.foods = state.foods.map((food) => ({ ...food, servings: food.servings ?? [] }));
  state.last_backup_at ??= null;
  state.weights ??= [];
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
function mutate<T>(change: (state: State) => T): Promise<T> {
  const run = queue.then(async () => {
    const current = await load();
    const draft: State = structuredClone(current);
    const result = change(draft);
    await writeState(draft);
    cache = Promise.resolve(draft);
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
  return { ...body, name, brand: body.brand?.trim() || null, notes: body.notes?.trim() || null, servings };
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
    out[key] = key === "calories" || key === "workouts_per_week" ? Math.round(value) : value;
  }
  return out;
}

const EMPTY_TARGETS: Targets = { calories: null, protein_g: null, carbohydrates_g: null, fat_g: null, fiber_g: null, workouts_per_week: null };

// ---------- date helpers (YYYY-MM-DD strings, timezone-safe) ----------

const DAY_MS = 86_400_000;
const toUtc = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
        workouts: state.workouts.filter((workout) => workout.date === iso).length,
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

  createFood: (body: FoodBody) =>
    mutate((state) => {
      const food: Food = { ...cleanFood(body), id: state.next_id.food++, source: "user-entered", is_verified: false };
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
    }),

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
        created_at: Date.now(),
      };
      state.meals.push(meal);
      return publicMeal(meal);
    }),

  deleteMeal: (id: number) =>
    mutate((state) => {
      if (!state.meals.some((meal) => meal.id === id)) fail("Meal log not found.");
      state.meals = state.meals.filter((meal) => meal.id !== id);
    }),

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
    return { last_backup_at: state.last_backup_at, has_data: state.foods.length + state.meals.length + state.workouts.length + state.weights.length > 0 };
  },

  markBackedUp: () =>
    mutate((state) => {
      state.last_backup_at = Date.now();
    }),

  deleteWorkout: (id: number) =>
    mutate((state) => {
      if (!state.workouts.some((workout) => workout.id === id)) fail("Workout not found.");
      state.workouts = state.workouts.filter((workout) => workout.id !== id);
    }),

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
    }),

  // ---------- trends ----------

  /** Daily totals for the `days` days ending on `end`, plus streaks. */
  async trends(end: string, days: number): Promise<Trends> {
    const state = await load();
    const endMs = toUtc(end);
    const list: TrendDay[] = Array.from({ length: days }, (_, index) => ({
      date: fromUtc(endMs - (days - 1 - index) * DAY_MS),
      calories: 0, protein_g: 0, carbohydrates_g: 0, fat_g: 0, fiber_g: 0, workouts: 0, logged: false,
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
    for (const workout of state.workouts) {
      const day = byDate.get(workout.date);
      if (day) day.workouts += 1;
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
    for (const workout of state.workouts) {
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
        const point = byDate.get(workout.date) ?? { date: workout.date, top_weight_kg: 0, reps_at_top: 0, volume_kg: 0, sets: 0 };
        point.sets++;
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
      state.last_backup_at = Date.now(); // the file just restored from is a backup
      state.next_id = {
        food: maxId(foods.map((food) => food.id)),
        meal: maxId(meals.map((meal) => meal.id)),
        workout: maxId(workouts.map((workout) => workout.id)),
        set: maxId(workouts.flatMap((workout) => workout.sets.map((set) => set.id ?? 0))),
        weight: maxId(state.weights.map((entry) => entry.id)),
      };
      return { foods: foods.length, meals: meals.length, workouts: workouts.length };
    }),
};
