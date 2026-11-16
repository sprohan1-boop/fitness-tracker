// Pure training helpers (no UI): muscle groups, estimated 1RM and add-weight suggestions.
import type { Muscle, Workout } from "./types";

export const MUSCLES: { key: Muscle; label: string }[] = [
  { key: "chest", label: "Chest" },
  { key: "back", label: "Back" },
  { key: "shoulders", label: "Shoulders" },
  { key: "biceps", label: "Biceps" },
  { key: "triceps", label: "Triceps" },
  { key: "legs", label: "Legs" },
  { key: "glutes", label: "Glutes" },
  { key: "calves", label: "Calves" },
  { key: "core", label: "Core" },
];
export const muscleLabel = (muscle: Muscle) => MUSCLES.find((item) => item.key === muscle)?.label ?? muscle;

// Order matters: more specific patterns first (e.g. "leg curl" before "curl", "leg press" before "press").
const RULES: [RegExp, Muscle][] = [
  [/calf|calves/, "calves"],
  [/hip thrust|glute|bridge|kickback|abduct/, "glutes"],
  [/leg curl|leg ext|leg press|squat|lunge|romanian|\brdl\b|hack|step.?up|split|good morning|hamstring|quad/, "legs"],
  [/plank|crunch|sit.?up|\babs?\b|core|leg raise|russian twist|ab wheel|hollow|dead ?bug/, "core"],
  [/tricep|pushdown|push.?down|skull|\bdips?\b|close.?grip|french press/, "triceps"],
  [/curl/, "biceps"],
  [/bench|chest|fly|flye|push.?up|pec|incline press|decline press/, "chest"],
  [/overhead|\bohp\b|shoulder|lateral raise|side raise|front raise|military|arnold|face pull|rear delt|upright row|shrug/, "shoulders"],
  [/pull.?up|chin.?up|\blat\b|lats|row|pulldown|pull.?down|deadlift|back ext|hyperext/, "back"],
];

/** Best guess at the main muscle group from an exercise name; null when unsure. */
export function guessMuscle(exercise: string): Muscle | null {
  const name = exercise.toLowerCase();
  for (const [pattern, muscle] of RULES) if (pattern.test(name)) return muscle;
  return null;
}

/** Estimated one-rep max (Epley). Unreliable above ~12 reps, so those sets are ignored. */
export function estimate1RM(weightKg: number, reps: number): number | null {
  if (reps < 1 || reps > 12 || weightKg <= 0) return null;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

/**
 * Suggests adding weight when the last two sessions of an exercise both had every set at the
 * same top weight with at least `targetReps` reps (or, without a target, as many reps as the
 * session before). Returns the suggested weight in kg, or null.
 */
export function suggestIncrease(exercise: string, history: Workout[], targetReps: number | null, stepKg: number): { fromKg: number; toKg: number; reps: number } | null {
  const key = exercise.trim().toLowerCase();
  if (!key) return null;
  const sessions = history
    .map((workout) => ({ date: workout.date, id: workout.id, sets: workout.sets.filter((set) => set.exercise_name.toLowerCase() === key) }))
    .filter((session) => session.sets.length)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice(0, 2);
  if (sessions.length < 2) return null;
  const top = sessions.map((session) => Math.max(...session.sets.map((set) => set.weight_kg)));
  if (top[0] <= 0 || top[0] !== top[1]) return null;
  // Every set of both sessions was done at the top weight…
  if (!sessions.every((session, i) => session.sets.every((set) => set.weight_kg === top[i]))) return null;
  // …and hit the rep target.
  const needed = targetReps ?? Math.min(...sessions[1].sets.map((set) => set.reps));
  const minReps = Math.min(...sessions.flatMap((session) => session.sets.map((set) => set.reps)));
  if (minReps < needed) return null;
  return { fromKg: top[0], toKg: Math.round((top[0] + stepKg) * 100) / 100, reps: needed };
}
