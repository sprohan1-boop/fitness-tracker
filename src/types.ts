export type Targets = {
  calories: number | null;
  protein_g: number | null;
  carbohydrates_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  workouts_per_week: number | null;
  water_ml: number | null;
  steps: number | null;
};

export type Serving = { label: string; grams: number };

export type BackupStatus = { last_backup_at: number | null; has_data: boolean };

/** Times are "HH:MM"; the night is filed under the date you woke up. Quality 1 (poor) to 5 (great). */
export type Sleep = { bed: string; wake: string; quality: number };

export type DayLog = { water_ml: number; note: string; sleep: Sleep | null; steps: number | null; habits_done: number[] };

export type Habit = { id: number; name: string; archived: boolean };
export type HabitStatus = { id: number; name: string; done: boolean; streak: number };

export type CardioType = "run" | "walk" | "cycle" | "swim" | "other";
/** Distance is stored in km. */
export type Cardio = { id: number; date: string; type: CardioType; minutes: number; distance_km: number | null; kcal: number | null; note: string | null };

/** Lengths are stored in cm. */
export type Measurement = { id: number; date: string; waist_cm: number | null; hips_cm: number | null; chest_cm: number | null; arm_cm: number | null; thigh_cm: number | null; body_fat_pct: number | null };
export type MeasureKey = Exclude<keyof Measurement, "id" | "date">;

export type FoodSource = "user-entered" | "open-food-facts" | "recipe" | "usda" | "ai";

export type ActivityLevel = "sedentary" | "light" | "moderate" | "very" | "extra";
export type Goal = "lose" | "lose_slow" | "maintain" | "gain";
export type Profile = { sex: "male" | "female"; birth_year: number; height_cm: number; activity: ActivityLevel; goal: Goal };

/** Times are epoch milliseconds; end is null while the fast is running. */
export type Fast = { id: number; start: number; end: number | null; goal_h: number };

/** Daily calorie burn measured from your own food log and weight trend. */
export type EnergyEstimate =
  | { ready: true; tdee: number; intake_avg: number; kg_per_week: number; days_logged: number; weighins: number; window_days: number }
  | { ready: false; days_logged: number; weighins: number; weigh_span_days: number; window_days: number };

export type BodyWeight = { id: number; date: string; weight_kg: number };

export type TrendDay = {
  date: string;
  calories: number;
  protein_g: number;
  carbohydrates_g: number;
  fat_g: number;
  fiber_g: number;
  workouts: number; // strength + cardio sessions
  logged: boolean; // at least one meal that day
  sleep_h: number | null;
  steps: number | null;
};

export type Trends = {
  days: TrendDay[];
  targets: Targets;
  food_streak: number; // consecutive days with food logged, up to today
  workout_week_streak: number; // consecutive weeks meeting the weekly workout target (or 1+ if none set)
};

export type ExerciseSummary = { name: string; sessions: number; last_date: string };

export type ExercisePoint = { date: string; top_weight_kg: number; reps_at_top: number; volume_kg: number; sets: number; e1rm_kg: number | null };

export type Muscle = "chest" | "back" | "shoulders" | "biceps" | "triceps" | "legs" | "glutes" | "calves" | "core";

/** A planned workout: which weekdays (0 = Monday … 6 = Sunday) and target sets × reps per exercise. */
export type Routine = { id: number; name: string; days: number[]; exercises: { name: string; sets: number; reps: number }[] };

/** Goal values are stored in kg (weight, lift), cm (measurements) or % (body fat). */
export type FitnessGoal = {
  id: number;
  kind: "weight" | "lift" | "measure";
  exercise: string | null; // lift goals
  measure: MeasureKey | null; // measurement goals
  target: number;
  start_value: number;
  start_date: string;
  deadline: string | null;
};

export type GoalStatus = {
  goal: FitnessGoal;
  current: number | null;
  percent: number; // 0–100 of the way from start to target
  per_week: number | null; // trend, in stored units per week
  projected_date: string | null;
  status: "reached" | "on_track" | "behind" | "away" | "no_trend" | "no_data";
};

type WeekNumbers = { calories_avg: number | null; protein_avg: number | null; sessions: number; sleep_avg_h: number | null; steps_avg: number | null; weight_avg: number | null };

export type WeekSummary = {
  start: string;
  end: string;
  has_data: boolean;
  food: { days_logged: number; calories_avg: number | null; protein_avg: number | null; days_on_target: number | null; calorie_target: number | null };
  training: { strength: number; cardio: number; sets: number; cardio_minutes: number; cardio_km: number; target: number | null; new_bests: { exercise: string; weight_kg: number }[] };
  body: { weight_avg: number | null; weight_change: number | null; sleep_avg_h: number | null; nights: number; steps_avg: number | null; water_avg_ml: number | null };
  habits: { done: number; possible: number };
  previous: WeekNumbers;
  current: WeekNumbers;
};

export type MuscleVolume = { muscles: { muscle: Muscle; sets: number }[]; unassigned: { exercise: string; sets: number }[] };

export type Food = {
  id: number;
  servings: Serving[];
  name: string;
  brand: string | null;
  preparation: "raw" | "cooked" | "packaged" | "unspecified";
  calories_per_100g: number;
  protein_g_per_100g: number;
  carbohydrates_g_per_100g: number;
  fat_g_per_100g: number;
  fiber_g_per_100g: number;
  notes: string | null;
  source: string;
  is_verified: boolean;
  // Optional extras (null = unknown). Sodium in mg.
  sugar_g_per_100g?: number | null;
  sat_fat_g_per_100g?: number | null;
  sodium_mg_per_100g?: number | null;
  /** Set when this food is a recipe built from other foods. */
  recipe?: Recipe | null;
};

export type Recipe = { ingredients: { food_id: number; name: string; grams: number }[]; portions: number };

export type Meal = {
  id: number;
  food_id: number;
  food_name: string;
  preparation: string;
  date: string;
  meal_type: string;
  portion_g: number;
  calories: number;
  protein_g: number;
  carbohydrates_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g?: number | null;
  sat_fat_g?: number | null;
  sodium_mg?: number | null;
};

export type WorkoutSet = {
  id?: number;
  exercise_name: string;
  set_number: number;
  reps: number;
  weight_kg: number;
};

export type Workout = {
  id: number;
  name: string;
  date: string;
  notes: string | null;
  sets: WorkoutSet[];
};

export type DashboardData = {
  date: string;
  totals: {
    calories: number;
    protein_g: number;
    carbohydrates_g: number;
    fat_g: number;
    fiber_g: number;
    sugar_g: number;
    sat_fat_g: number;
    sodium_mg: number;
    extras_known: boolean; // at least one meal that day has sugar/sat fat/sodium values
  };
  targets: Targets;
  remaining: Targets;
  workouts_today: Workout[];
  weekly: {
    start: string;
    end: string;
    workout_count: number;
    workout_target: number | null;
    days: { date: string; label: string; calories: number; workouts: number }[];
  };
};
