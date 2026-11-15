export type Targets = {
  calories: number | null;
  protein_g: number | null;
  carbohydrates_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  workouts_per_week: number | null;
};

export type Serving = { label: string; grams: number };

export type BackupStatus = { last_backup_at: number | null; has_data: boolean };

export type BodyWeight = { id: number; date: string; weight_kg: number };

export type TrendDay = {
  date: string;
  calories: number;
  protein_g: number;
  carbohydrates_g: number;
  fat_g: number;
  fiber_g: number;
  workouts: number;
  logged: boolean; // at least one meal that day
};

export type Trends = {
  days: TrendDay[];
  targets: Targets;
  food_streak: number; // consecutive days with food logged, up to today
  workout_week_streak: number; // consecutive weeks meeting the weekly workout target (or 1+ if none set)
};

export type ExerciseSummary = { name: string; sessions: number; last_date: string };

export type ExercisePoint = { date: string; top_weight_kg: number; reps_at_top: number; volume_kg: number; sets: number };

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
};

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
