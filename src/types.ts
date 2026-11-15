export type Targets = {
  calories: number | null;
  protein_g: number | null;
  carbohydrates_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  workouts_per_week: number | null;
};

export type Food = {
  id: number;
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
