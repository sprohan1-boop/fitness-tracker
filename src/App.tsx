import {
  Activity,
  Apple,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  ChefHat,
  Check,
  Database,
  ClipboardList,
  Copy,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Repeat,
  Share,
  Dumbbell,
  Flame,
  Footprints,
  Home,
  Droplet,
  Leaf,
  Loader2,
  ScanBarcode,
  Minus,
  NotebookPen,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Utensils,
  X,
} from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { api } from "./api";
import { addDays, dateLabel, formatNumber, localDate } from "./utils";
import { RestTimer, unlockAudio } from "./RestTimer";
// Chart-heavy views load on demand, keeping the chart library out of the first download.
const ProgressPage = lazy(() => import("./Progress").then((module) => ({ default: module.ProgressPage })));
const WeekChart = lazy(() => import("./WeekChart"));
import { SwipeToDelete } from "./Swipe";
import { AmountInput, Field, FormError, ModalShell, NumberField } from "./ui";
import { FastingCard, RecipeForm, TargetCalculator } from "./Nutrition";
import { RoutineCard, RoutineForm, TodayPlans, weekdayIndex } from "./Training";
import { WeekSummaryCard, weekStartOf } from "./Insights";
import { suggestIncrease } from "./training-logic";
import { CardioCard, CardioForm, HabitsCard, HabitsManager, SleepCard, SleepForm, StepsCard, cardioLabel } from "./Health";
import { BarcodeScanner, lookupBarcode } from "./Barcode";
import { foodFromDb, loadFoodDb, searchFoodDb } from "./foodDb";
import type { DbFood } from "./foodDb";
import { fromKg, setPrefs, toKg, usePrefs } from "./prefs";
import { currentPrefs } from "./prefs";
const prefsUnit = () => currentPrefs().unit;
import type { ThemePref, Unit } from "./prefs";
import type { BackupStatus, Cardio, DashboardData, Routine, WeekSummary, DayLog, EnergyEstimate, Fast, FoodSource, HabitStatus, Profile, Food, Meal, Serving, Targets, Workout } from "./types";

type Page = "dashboard" | "foods" | "workouts" | "progress" | "settings";
type Modal = "food" | "meal" | "editMeal" | "workout" | "targets" | "sleep" | "habits" | "cardio" | "recipe" | "routine" | null;
type WorkoutBody = { name: string; date: string; sets: { exercise_name: string; set_number: number; reps: number; weight_kg: number }[] };

const BACKUP_REMIND_DAYS = 7;

const EMPTY_TARGETS: Targets = {
  calories: null,
  protein_g: null,
  carbohydrates_g: null,
  fat_g: null,
  fiber_g: null,
  workouts_per_week: null,
  water_ml: null,
  steps: null,
};

/** "Today", "Yesterday", or e.g. "Mon, Nov 10". */
function dayName(value: string): string {
  const today = localDate();
  if (value === today) return "Today";
  if (value === addDays(today, -1)) return "Yesterday";
  return dateLabel(value);
}

function defaultMealType(): string {
  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  return hour < 10.5 ? "breakfast" : hour < 15 ? "lunch" : hour < 21 ? "dinner" : "snack";
}

function daysSince(timestamp: number): number {
  return Math.floor((Date.now() - timestamp) / 86_400_000);
}

/** Save a JSON backup: the iOS share sheet when available (Save to Files / iCloud), otherwise a download. */
async function backupNow(): Promise<boolean> {
  const data = await api.exportData();
  const file = new File([JSON.stringify(data, null, 2)], `fitness-tracker-backup-${localDate()}.json`, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Fitness Tracker backup" });
      await api.markBackedUp();
      return true;
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return false; // user closed the sheet
      // Otherwise (e.g. share not allowed) fall through to a plain download.
    }
  }
  const objectUrl = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = file.name;
  anchor.click();
  // Revoking immediately can cancel the download in Safari/iOS.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  await api.markBackedUp();
  return true;
}

const navItems: { key: Page; label: string; icon: typeof Home }[] = [
  { key: "dashboard", label: "Overview", icon: Home },
  { key: "foods", label: "Food library", icon: Apple },
  { key: "workouts", label: "Workouts", icon: Dumbbell },
  { key: "progress", label: "Progress", icon: TrendingUp },
  { key: "settings", label: "Settings", icon: Settings },
];

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [modal, setModal] = useState<Modal>(null);
  const [editingFood, setEditingFood] = useState<Food | null>(null);
  const [foods, setFoods] = useState<Food[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mainRef = useRef<HTMLElement>(null);
  const [selectedDate, setSelectedDate] = useState(localDate());
  const [recentFoodIds, setRecentFoodIds] = useState<number[]>([]);
  const [backup, setBackup] = useState<BackupStatus>({ last_backup_at: null, has_data: false });
  const [dayLog, setDayLog] = useState<DayLog>({ water_ml: 0, note: "", sleep: null, steps: null, habits_done: [] });
  const [habits, setHabits] = useState<HabitStatus[]>([]);
  const [cardio, setCardio] = useState<Cardio[]>([]);
  const [editingCardio, setEditingCardio] = useState<Cardio | null>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [weekCard, setWeekCard] = useState<WeekSummary | null>(null);
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
  /** Target reps per exercise (lowercased) when a workout was started from a plan. */
  const [planTargets, setPlanTargets] = useState<Record<string, number>>({});
  const [fasting, setFasting] = useState<{ active: Fast | null; recent: Fast[] }>({ active: null, recent: [] });
  const [targetContext, setTargetContext] = useState<{ profile: Profile | null; weightKg: number | null; energy: EnergyEstimate | null }>({ profile: null, weightKg: null, energy: null });
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [undoMessage, setUndoMessage] = useState("");
  const [scanOnOpen, setScanOnOpen] = useState(false);
  const [dataVersion, setDataVersion] = useState(0); // bumps after every change, so other views reload
  const [editingWorkout, setEditingWorkout] = useState<Workout | null>(null);
  const [workoutTemplate, setWorkoutTemplate] = useState<Workout | null>(null);

  const refresh = useCallback(async () => {
    const [nextDashboard, nextFoods, nextMeals, nextWorkouts, nextRecent, nextBackup, nextDay] = await Promise.all([
      api.dashboard(selectedDate),
      api.foods(),
      api.meals(selectedDate),
      api.workouts(),
      api.recentFoodIds(),
      api.backupStatus(),
      api.day(selectedDate),
    ]);
    const [nextHabits, nextCardio, nextFasting, nextRoutines] = await Promise.all([api.habits(selectedDate), api.cardio(), api.fasting(), api.routines()]);
    setRoutines(nextRoutines);
    // Last week's summary card, until dismissed.
    const lastWeek = addDays(weekStartOf(localDate()), -7);
    const [summary, dismissed] = await Promise.all([api.weekSummary(lastWeek), api.summaryDismissed()]);
    setWeekCard(summary.has_data && dismissed !== lastWeek ? summary : null);
    setFasting(nextFasting);
    setDayLog(nextDay);
    setHabits(nextHabits);
    setCardio(nextCardio);
    setDashboard(nextDashboard);
    setFoods(nextFoods);
    setMeals(nextMeals);
    setWorkouts(nextWorkouts);
    setRecentFoodIds(nextRecent);
    setBackup(nextBackup);
    return nextDashboard;
  }, [selectedDate]);

  async function runBackup() {
    setError("");
    try {
      if (await backupNow()) {
        setBackup(await api.backupStatus());
        setNotice("Backup saved.");
      }
    } catch {
      setError("The backup couldn't be created.");
    }
  }

  useEffect(() => {
    let mounted = true;
    refresh()
      .catch((cause: unknown) => {
        if (mounted) setError(cause instanceof Error ? cause.message : "Could not load your tracker data.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [refresh]);

  async function runAction(action: () => Promise<unknown>, successMessage?: string, { undoable = false, keepOpen = false } = {}) {
    setBusy(true);
    setError("");
    setNotice("");
    setUndoMessage("");
    try {
      await action();
      await refresh();
      if (!keepOpen) {
        setModal(null);
        setEditingFood(null);
        setEditingMeal(null);
        setEditingWorkout(null);
        setWorkoutTemplate(null);
        setEditingCardio(null);
        setEditingRoutine(null);
        setPlanTargets({});
      }
      if (successMessage) (undoable ? setUndoMessage : setNotice)(successMessage);
      setDataVersion((version) => version + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function openFoodEditor(food: Food | null = null, { scan = false } = {}) {
    setError("");
    setEditingFood(food);
    setScanOnOpen(scan);
    setModal("food");
  }

  function openModal(next: Exclude<Modal, null>) {
    setError("");
    setNotice("");
    setModal(next);
  }

  function openWorkoutEditor({ edit = null, template = null }: { edit?: Workout | null; template?: Workout | null } = {}) {
    setEditingWorkout(edit);
    setWorkoutTemplate(template);
    openModal("workout");
  }

  async function openTargets() {
    const [profile, weights, energy] = await Promise.all([api.profile(), api.weights(), api.energyEstimate(localDate())]);
    setTargetContext({ profile, weightKg: weights.length ? weights[weights.length - 1].weight_kg : null, energy });
    openModal("targets");
  }

  function openRecipeEditor(food: Food | null = null) {
    setEditingFood(food);
    openModal("recipe");
  }

  function openRoutineEditor(routine: Routine | null = null) {
    setEditingRoutine(routine);
    openModal("routine");
  }

  /** Opens the workout form filled from a plan: target reps, and last time's weight (or the suggested increase). */
  function startRoutine(routine: Routine) {
    const stepKg = prefsUnit() === "lb" ? 5 / 2.2046226218 : 2.5;
    const targets: Record<string, number> = {};
    let setId = 0;
    const sets = routine.exercises.flatMap((exercise) => {
      targets[exercise.name.toLowerCase()] = exercise.reps;
      const key = exercise.name.toLowerCase();
      const last = workouts.find((workout) => workout.sets.some((set) => set.exercise_name.toLowerCase() === key));
      const lastWeight = last ? Math.max(...last.sets.filter((set) => set.exercise_name.toLowerCase() === key).map((set) => set.weight_kg)) : 0;
      const increase = suggestIncrease(exercise.name, workouts, exercise.reps, stepKg);
      const weight = increase?.toKg ?? lastWeight;
      return Array.from({ length: exercise.sets }, (_, index) => ({ id: --setId, exercise_name: exercise.name, set_number: index + 1, reps: exercise.reps, weight_kg: weight }));
    });
    setPlanTargets(targets);
    openWorkoutEditor({ template: { id: -routine.id, name: routine.name, date: selectedDate, notes: null, sets } });

  }

  function openCardioEditor(session: Cardio | null = null) {
    setEditingCardio(session);
    openModal("cardio");
  }

  /** Tick or untick instantly, then save and refresh streaks. */
  function toggleHabit(habit: HabitStatus) {
    setHabits((current) => current.map((item) => (item.id === habit.id ? { ...item, done: !item.done } : item)));
    void api.toggleHabit(selectedDate, habit.id)
      .then(() => api.habits(selectedDate))
      .then(setHabits)
      .catch(() => setError("Couldn't save that habit."));
  }

  function openMealEditor(meal: Meal) {
    setEditingMeal(meal);
    openModal("editMeal");
  }

  function closeModal() {
    setModal(null);
    setEditingFood(null);
    setEditingMeal(null);
    setEditingWorkout(null);
    setWorkoutTemplate(null);
    setEditingCardio(null);
    setEditingRoutine(null);
    setPlanTargets({});
  }

  const dayLabel = dayName(selectedDate);

  const pageHeading = navItems.find((item) => item.key === page)?.label ?? "Overview";

  // Each tab starts at the top, like a native tab bar.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [page]);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-night text-white">
      <aside className="hidden w-[248px] shrink-0 overflow-y-auto border-r border-line/80 px-5 py-7 lg:flex lg:flex-col">
        <Brand />
        <div className="mt-12">
          <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.2em] text-muted">Workspace</p>
          <Navigation page={page} onSelect={setPage} />
        </div>
        <div className="mt-auto rounded-2xl border border-line bg-panel p-4">
          <div className="flex items-center gap-2 text-lime"><ShieldCheck size={15} /><span className="text-xs font-semibold">Local-first</span></div>
          <p className="mt-2 text-xs leading-5 text-muted">Your entries are stored on this device only. No account or cloud sync.</p>
        </div>
      </aside>

      {/* App shell: header and tab bar stay put; only <main> scrolls (no whole-page bounce on iPhone). */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-header z-30 shrink-0 border-b border-line/70 pt-[env(safe-area-inset-top)]">
          <div className="flex h-14 items-center justify-between px-4 sm:h-[72px] sm:px-7 lg:px-10">
            <div>
              <p className="hidden text-[10px] font-semibold uppercase tracking-[.18em] text-muted sm:block">Fitness tracker</p>
              <h1 className="text-lg font-semibold text-white sm:mt-0.5 sm:text-base">{pageHeading}</h1>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="hidden items-center gap-2 rounded-full border border-line bg-panel px-3 py-2 text-xs text-muted sm:flex">
                <CalendarDays size={13} className="text-lime" /> {dateLabel(selectedDate)}
              </div>
              <button onClick={() => openWorkoutEditor()} className="button-secondary !min-h-10 !px-3 sm:hidden" aria-label="Log a workout">
                <Dumbbell size={16} />
              </button>
              <button onClick={() => openModal("meal")} className="button-primary !min-h-10 !px-3 sm:!px-4">
                <Plus size={16} /><span className="hidden sm:inline">Log food</span><span className="sm:hidden">Food</span>
              </button>
            </div>
          </div>
        </header>

        {/* `relative` keeps absolutely positioned children (sr-only labels, chart tooltips) inside this
            scroll box; otherwise they stretch the document and iOS lets the whole page scroll. */}
        <main ref={mainRef} className="relative flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-6 pt-4 sm:px-7 sm:pt-8 lg:px-10 lg:pb-10">
            {loading ? (
              <LoadingState />
            ) : page === "dashboard" ? (
              <DashboardPage
                data={dashboard}
                meals={meals}
                foodsCount={foods.length}
                date={selectedDate}
                onDateChange={setSelectedDate}
                backup={backup}
                onBackup={() => void runBackup()}
                dayLog={dayLog}
                habits={habits}
                cardioToday={cardio.filter((session) => session.date === selectedDate)}
                weekSummary={selectedDate === localDate() ? weekCard : null}
                onOpenSummary={() => setPage("progress")}
                onDismissSummary={(start) => { setWeekCard(null); void api.dismissSummary(start); }}
                plansToday={routines.filter((routine) => routine.days.includes(weekdayIndex(selectedDate)))}
                onStartPlan={startRoutine}
                onLogSleep={() => openModal("sleep")}
                onSaveSteps={(steps) => api.setSteps(selectedDate, steps).then(() => setDayLog((current) => ({ ...current, steps }))).catch(() => setError("Couldn't save steps."))}
                onToggleHabit={toggleHabit}
                onManageHabits={() => openModal("habits")}
                onAddHabit={(name) => void runAction(() => api.addHabit(name), undefined, { keepOpen: true })}
                onEditCardio={(session) => openCardioEditor(session)}
                fasting={fasting}
                onStartFast={(goal, start) => void runAction(() => api.startFast(goal, start), "Fast started.")}
                onEndFast={() => void runAction(() => api.endFast(), "Fast ended.")}
                onAdjustFast={(change) => void runAction(() => api.adjustFast(change))}
                onCopyPrevious={() => void runAction(() => api.copyMeals(addDays(selectedDate, -1), selectedDate), `Copied meals from ${dayName(addDays(selectedDate, -1)).replace(/^(Yesterday|Today)$/, (word) => word.toLowerCase())}.`, { undoable: true })}
                onAddWater={(ml) => void api.addWater(selectedDate, ml).then((water_ml) => setDayLog((current) => ({ ...current, water_ml }))).catch(() => setError("Couldn't save water."))}
                onSaveNote={(note) => api.setNote(selectedDate, note).catch(() => setError("Couldn't save your note."))}
                onLogMeal={() => openModal("meal")}
                onLogWorkout={() => openWorkoutEditor()}
                onEditWorkout={(workout) => openWorkoutEditor({ edit: workout })}
                onSetTargets={() => void openTargets()}
                onNavigate={setPage}
                onEditMeal={openMealEditor}
                onDeleteMeal={(meal) => runAction(() => api.deleteMeal(meal.id), `${meal.food_name} removed.`, { undoable: true })}
              />
            ) : page === "foods" ? (
              <FoodLibrary
                foods={foods}
                onAdd={() => openFoodEditor()}
                onScan={() => openFoodEditor(null, { scan: true })}
                onEdit={(food) => (food.recipe ? openRecipeEditor(food) : openFoodEditor(food))}
                onRecipe={() => openRecipeEditor()}
                onDelete={(food) => void runAction(() => api.deleteFood(food.id), `"${food.name}" deleted.`, { undoable: true })}
              />
            ) : page === "workouts" ? (
              <WorkoutsPage
                workouts={workouts}
                cardio={cardio}
                onAddCardio={() => openCardioEditor()}
                onEditCardio={(session) => openCardioEditor(session)}
                routines={routines}
                onAddRoutine={() => openRoutineEditor()}
                onEditRoutine={(routine) => openRoutineEditor(routine)}
                onStartRoutine={startRoutine}
                onDeleteRoutine={(routine) => void runAction(() => api.deleteRoutine(routine.id), `"${routine.name}" deleted.`, { undoable: true })}
                onDeleteCardio={(session) => void runAction(() => api.deleteCardio(session.id), `${cardioLabel(session.type)} deleted.`, { undoable: true })}
                onAdd={() => openWorkoutEditor()}
                onEdit={(workout) => openWorkoutEditor({ edit: workout })}
                onRepeat={(workout) => openWorkoutEditor({ template: workout })}
                onDelete={(workout) => void runAction(() => api.deleteWorkout(workout.id), `"${workout.name}" deleted.`, { undoable: true })}
              />
            ) : page === "progress" ? (
              <Suspense fallback={<LoadingState />}><ProgressPage version={dataVersion} onError={setError} onUndoableDelete={(action, message) => runAction(action, message, { undoable: true })} /></Suspense>
            ) : (
              <SettingsPage
                targets={dashboard?.targets ?? EMPTY_TARGETS}
                onEditTargets={() => void openTargets()}
                backup={backup}
                onBackup={() => void runBackup()}
                onImport={(backup) => runAction(() => api.importData(backup), "Backup restored.")}
              />
            )}
        </main>

        {/* Toasts float just above the tab bar instead of pushing content down. */}
        <div className="relative z-40 h-0">
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center gap-2 px-4">
            {error && <Toast tone="error" message={error} onDismiss={() => setError("")} />}
            {notice && <Toast tone="ok" message={notice} onDismiss={() => setNotice("")} />}
            {undoMessage && <Toast tone="ok" message={undoMessage} onDismiss={() => setUndoMessage("")} action={{ label: "Undo", onClick: () => void runAction(() => api.undo(), "Restored.") }} />}
          </div>
        </div>

        <nav className="z-30 shrink-0 border-t border-line bg-panel px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 lg:hidden">
        <div className="mx-auto flex max-w-lg justify-around">
          {navItems.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setPage(key)} className={`flex min-w-[60px] flex-col items-center gap-1 rounded-xl px-1.5 py-1.5 ${page === key ? "text-lime" : "text-muted"}`}>
              <Icon size={19} strokeWidth={page === key ? 2.3 : 1.7} />
              <span className="text-[10px] font-medium">{label === "Overview" ? "Home" : label === "Food library" ? "Food" : label}</span>
            </button>
          ))}
        </div>
      </nav>
      </div>

      {modal === "food" && (
        <ModalShell title={editingFood ? "Edit food" : "Add a food"} eyebrow="FOOD LIBRARY" onClose={closeModal}>
          <FoodForm
            key={editingFood?.id ?? "new"}
            initialFood={editingFood}
            existingFoods={foods}
            autoScan={scanOnOpen}
            busy={busy}
            error={error}
            onSubmit={(body) => runAction(
              () => editingFood ? api.updateFood(editingFood.id, body) : api.createFood(body),
              editingFood ? "Food details updated." : `${body.name} added to your library.`,
            )}
          />
        </ModalShell>
      )}
      {modal === "meal" && (
        <ModalShell title="Log a meal" eyebrow={dayLabel.toUpperCase()} onClose={closeModal}>
          <MealForm
            foods={foods}
            recentFoodIds={recentFoodIds}
            busy={busy}
            error={error}
            date={selectedDate}
            dayLabel={dayLabel}
            onAddFood={() => openFoodEditor()}
            onAddFromDb={async (item) => {
              try {
                const food = await api.createFood(foodFromDb(item));
                setFoods(await api.foods());
                return food;
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Couldn't add that food.");
                return null;
              }
            }}
            onSubmit={(body) => runAction(() => api.createMeal(body), `Meal added to ${dayLabel.toLowerCase() === "today" ? "today's" : `${dayLabel}'s`} log.`)}
          />
        </ModalShell>
      )}
      {modal === "editMeal" && editingMeal && (
        <ModalShell title="Edit meal" eyebrow={editingMeal.food_name.toUpperCase()} onClose={closeModal}>
          <MealEditForm
            meal={editingMeal}
            servings={foods.find((food) => food.id === editingMeal.food_id)?.servings ?? []}
            busy={busy}
            error={error}
            onSubmit={(body) => runAction(() => api.updateMeal(editingMeal.id, body), "Meal updated.")}
            onDelete={() => runAction(() => api.deleteMeal(editingMeal.id), `${editingMeal.food_name} removed.`, { undoable: true })}
          />
        </ModalShell>
      )}
      {modal === "workout" && (
        <ModalShell title={editingWorkout ? "Edit workout" : "Log a workout"} eyebrow={editingWorkout ? "TRAINING LOG" : dayLabel.toUpperCase()} onClose={closeModal}>
          <WorkoutForm
            key={editingWorkout?.id ?? workoutTemplate?.id ?? "new"}
            initial={editingWorkout ?? workoutTemplate}
            isEdit={Boolean(editingWorkout)}
            history={workouts}
            planTargets={planTargets}
            busy={busy}
            error={error}
            date={editingWorkout?.date ?? selectedDate}
            onSubmit={(body) => runAction(
              () => editingWorkout ? api.updateWorkout(editingWorkout.id, body) : api.createWorkout(body),
              editingWorkout ? "Workout updated." : "Workout saved.",
            )}
          />
        </ModalShell>
      )}
      {modal === "sleep" && (
        <ModalShell title="Log sleep" eyebrow={`NIGHT BEFORE ${dayLabel.toUpperCase()}`} onClose={closeModal}>
          <SleepForm initial={dayLog.sleep} previous={null} busy={busy} error={error} onSubmit={(sleep) => runAction(() => api.saveSleep(selectedDate, sleep), sleep ? "Sleep saved." : "Sleep cleared.")} />
        </ModalShell>
      )}
      {modal === "habits" && (
        <ModalShell title="Your habits" eyebrow="DAILY CHECKLIST" onClose={closeModal}>
          <HabitsManager
            habits={habits}
            busy={busy}
            error={error}
            onAdd={(name) => void runAction(() => api.addHabit(name), undefined, { keepOpen: true })}
            onRemove={(habit) => void runAction(() => api.removeHabit(habit.id), `"${habit.name}" removed.`, { undoable: true, keepOpen: true })}
          />
        </ModalShell>
      )}
      {modal === "cardio" && (
        <ModalShell title={editingCardio ? "Edit cardio" : "Log cardio"} eyebrow={editingCardio ? "TRAINING LOG" : dayLabel.toUpperCase()} onClose={closeModal}>
          <CardioForm
            key={editingCardio?.id ?? "new"}
            initial={editingCardio}
            date={selectedDate}
            busy={busy}
            error={error}
            onSubmit={(body) => runAction(() => api.saveCardio(body, editingCardio?.id), editingCardio ? "Session updated." : `${cardioLabel(body.type)} saved.`)}
            onDelete={editingCardio ? () => runAction(() => api.deleteCardio(editingCardio.id), `${cardioLabel(editingCardio.type)} deleted.`, { undoable: true }) : undefined}
          />
        </ModalShell>
      )}
      {modal === "recipe" && (
        <ModalShell title={editingFood ? "Edit recipe" : "New recipe"} eyebrow="FOOD LIBRARY" onClose={closeModal}>
          <RecipeForm
            key={editingFood?.id ?? "new"}
            foods={foods}
            initial={editingFood}
            busy={busy}
            error={error}
            onSubmit={(body) => runAction(() => api.saveRecipe(body, editingFood?.id), editingFood ? "Recipe updated." : `${body.name} added to your library.`)}
          />
        </ModalShell>
      )}
      {modal === "routine" && (
        <ModalShell title={editingRoutine ? "Edit plan" : "New plan"} eyebrow="WORKOUT PLANS" onClose={closeModal}>
          <RoutineForm
            key={editingRoutine?.id ?? "new"}
            initial={editingRoutine}
            exerciseNames={[...new Set(workouts.flatMap((workout) => workout.sets.map((set) => set.exercise_name)))]}
            busy={busy}
            error={error}
            onSubmit={(body) => runAction(() => api.saveRoutine(body, editingRoutine?.id), editingRoutine ? "Plan updated." : `${body.name} plan created.`)}
            onDelete={editingRoutine ? () => runAction(() => api.deleteRoutine(editingRoutine.id), `"${editingRoutine.name}" deleted.`, { undoable: true }) : undefined}
          />
        </ModalShell>
      )}
      {modal === "targets" && (
        <ModalShell title="Set your targets" eyebrow="YOUR SETTINGS" onClose={closeModal}>
          <TargetsForm
            context={targetContext}
            onSaveProfile={async (profile) => {
              try { await api.saveProfile(profile); return true; } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save your details."); return false; }
            }}
            targets={dashboard?.targets ?? EMPTY_TARGETS}
            busy={busy}
            error={error}
            onSubmit={(body) => runAction(() => api.saveTargets(body), "Targets updated.")}
          />
        </ModalShell>
      )}
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-lime text-night shadow-glow">
        <Activity size={21} strokeWidth={2.5} />
      </div>
      <div>
        <p className="text-sm font-bold tracking-tight">FITNESS</p>
        <p className="text-[10px] font-medium tracking-[.24em] text-muted">TRACKER</p>
      </div>
    </div>
  );
}

function Navigation({ page, onSelect }: { page: Page; onSelect: (page: Page) => void }) {
  return (
    <div className="space-y-1">
      {navItems.map(({ key, label, icon: Icon }) => (
        <button key={key} onClick={() => onSelect(key)} className={`nav-item w-full ${page === key ? "nav-item-active" : ""}`}>
          <Icon size={17} strokeWidth={page === key ? 2.2 : 1.7} />
          <span>{label}</span>
          {page === key && <ChevronRight className="ml-auto" size={14} />}
        </button>
      ))}
    </div>
  );
}

function DashboardPage({
  data,
  meals,
  foodsCount,
  date,
  onDateChange,
  backup,
  onBackup,
  dayLog,
  habits,
  cardioToday,
  weekSummary,
  onOpenSummary,
  onDismissSummary,
  plansToday,
  onStartPlan,
  onLogSleep,
  onSaveSteps,
  onToggleHabit,
  onManageHabits,
  onAddHabit,
  onEditCardio,
  fasting,
  onStartFast,
  onEndFast,
  onAdjustFast,
  onCopyPrevious,
  onAddWater,
  onSaveNote,
  onLogMeal,
  onLogWorkout,
  onEditWorkout,
  onSetTargets,
  onNavigate,
  onEditMeal,
  onDeleteMeal,
}: {
  data: DashboardData | null;
  meals: Meal[];
  foodsCount: number;
  date: string;
  onDateChange: (date: string) => void;
  backup: BackupStatus;
  onBackup: () => void;
  dayLog: DayLog;
  habits: HabitStatus[];
  cardioToday: Cardio[];
  weekSummary: WeekSummary | null;
  onOpenSummary: () => void;
  onDismissSummary: (weekStart: string) => void;
  plansToday: Routine[];
  onStartPlan: (routine: Routine) => void;
  onLogSleep: () => void;
  onSaveSteps: (steps: number | null) => Promise<unknown>;
  onToggleHabit: (habit: HabitStatus) => void;
  onManageHabits: () => void;
  onAddHabit: (name: string) => void;
  onEditCardio: (session: Cardio) => void;
  fasting: { active: Fast | null; recent: Fast[] };
  onStartFast: (goalH: number, start?: number) => void;
  onEndFast: () => void;
  onAdjustFast: (change: { start?: number; goal_h?: number }) => void;
  onCopyPrevious: () => void;
  onAddWater: (ml: number) => void;
  onSaveNote: (note: string) => Promise<unknown>;
  onLogMeal: () => void;
  onLogWorkout: () => void;
  onEditWorkout: (workout: Workout) => void;
  onSetTargets: () => void;
  onNavigate: (page: Page) => void;
  onEditMeal: (meal: Meal) => void;
  onDeleteMeal: (meal: Meal) => void;
}) {
  const day = dayName(date);
  const isToday = day === "Today";
  if (!data) return <Alert message="Dashboard data is not available. Close and reopen the app, then try again." />;
  const totals = data.totals;
  const targetMetrics = [
    { key: "protein_g" as const, label: "Protein", short: "PRO", color: "bg-sky-300", unit: "g" },
    { key: "carbohydrates_g" as const, label: "Carbs", short: "CARB", color: "bg-amber-300", unit: "g" },
    { key: "fat_g" as const, label: "Fat", short: "FAT", color: "bg-violet-300", unit: "g" },
    { key: "fiber_g" as const, label: "Fiber", short: "FIBER", color: "bg-mint", unit: "g" },
  ];
  const calorieTarget = data.targets.calories;
  const remaining = data.remaining.calories;
  const workoutTarget = data.weekly.workout_target;
  const workoutProgress = workoutTarget ? Math.min(data.weekly.workout_count / workoutTarget, 1) : 0;

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="mb-7 hidden flex-wrap items-end justify-between gap-4 sm:flex">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted"><Sparkles size={14} className="text-lime" /> YOUR DAILY CHECK-IN</div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Build a rhythm that lasts.</h2>
          <p className="mt-2 text-sm text-muted">Small choices. Useful data. Your pace.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onLogWorkout} className="button-secondary"><Dumbbell size={15} /> Workout</button>
          <button onClick={onLogMeal} className="button-primary"><Plus size={16} /> Log food</button>
        </div>
      </div>

      <DateSwitcher date={date} onChange={onDateChange} />
      <BackupBanner backup={backup} onBackup={onBackup} onOpenSettings={() => onNavigate("settings")} />
      {weekSummary && <WeekSummaryCard summary={weekSummary} onOpen={onOpenSummary} onDismiss={() => onDismissSummary(weekSummary.start)} />}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-3xl border border-line bg-panel p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-muted"><Flame size={15} className="text-lime" /> DAILY ENERGY</div>
              <div className="mt-5 flex items-baseline gap-2">
                <span className="text-4xl font-semibold tracking-tight">{formatNumber(totals.calories)}</span>
                <span className="text-sm text-muted">kcal eaten</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {calorieTarget === null ? "Set a personal target to see your remaining calories." : `${formatNumber(remaining ?? 0)} kcal remaining of ${formatNumber(calorieTarget)} kcal`}
              </p>
            </div>
            <button onClick={onSetTargets} className="rounded-xl border border-line px-3 py-2 text-xs font-medium text-muted transition hover:border-lime/40 hover:text-white">
              {calorieTarget === null ? "Set targets" : "Edit goals"}
            </button>
          </div>
          <div className="mt-6 h-2 overflow-hidden rounded-full bg-night">
            <div className="h-full rounded-full bg-lime transition-all" style={{ width: `${calorieTarget ? Math.min(totals.calories / calorieTarget * 100, 100) : 0}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-muted">
            <span>0 kcal</span><span>{calorieTarget === null ? "No target set" : `${Math.round(totals.calories / calorieTarget * 100)}% of target`}</span>
          </div>
        </section>

        <section className="rounded-3xl border border-line bg-panel p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-muted"><Target size={15} className="text-mint" /> WEEKLY MOVEMENT</div>
            <span className="rounded-full bg-night px-2.5 py-1 text-[10px] text-muted">MON – SUN</span>
          </div>
          <div className="mt-5 flex items-end justify-between">
            <div><span className="text-4xl font-semibold tracking-tight">{data.weekly.workout_count}</span><span className="ml-2 text-sm text-muted">sessions</span></div>
            <p className="pb-1 text-xs text-muted">{workoutTarget === null ? "Add a weekly target in Settings" : `of ${workoutTarget} planned`}</p>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-night">
            <div className="h-full rounded-full bg-mint transition-all" style={{ width: `${workoutTarget ? workoutProgress * 100 : 0}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-muted"><span>{data.workouts_today.length} {isToday ? "today" : `on ${day}`}</span><button onClick={onLogWorkout} className="text-mint hover:text-white">Log training +</button></div>
        </section>
      </div>

      <section className="mt-4 rounded-3xl border border-line bg-panel p-4 sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <div><h3 className="font-semibold">Nutrition breakdown</h3><p className="mt-1 text-xs text-muted">Logged food compared with your personal targets</p></div>
          <button onClick={onSetTargets} className="text-xs font-medium text-lime hover:text-white">{Object.values(data.targets).every((value) => value === null) ? "Set targets" : "Edit targets"}</button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {targetMetrics.map(({ key, label, short, color, unit }) => {
            const target = data.targets[key];
            const value = totals[key];
            const width = target ? Math.min(value / target * 100, 100) : 0;
            return (
              <div key={key} className="rounded-2xl border border-line/80 bg-night/70 p-4">
                <div className="flex items-center justify-between"><span className="text-[10px] font-bold tracking-[.13em] text-muted">{short}</span><span className={`h-2 w-2 rounded-full ${color}`} /></div>
                <div className="mt-4 flex items-baseline gap-1.5"><span className="text-2xl font-semibold">{formatNumber(value)}</span><span className="text-xs text-muted">{unit}</span></div>
                <div className="mt-1 text-[11px] text-muted">{target === null ? "No target set" : `${formatNumber(data.remaining[key] ?? 0)} ${unit} left · ${formatNumber(target)} ${unit} target`}</div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel"><div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} /></div>
                <span className="sr-only">{label}</span>
              </div>
            );
          })}
        </div>
        {totals.extras_known && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-2xl bg-night/70 px-4 py-2.5 text-[11px] text-muted">
            <span>Sugar <b className="font-semibold text-white">{formatNumber(totals.sugar_g)} g</b></span>
            <span>Sat. fat <b className="font-semibold text-white">{formatNumber(totals.sat_fat_g)} g</b></span>
            <span>Sodium <b className="font-semibold text-white">{formatNumber(Math.round(totals.sodium_mg))} mg</b></span>
            <span className="w-full text-[10px]">From foods that list these values.</span>
          </div>
        )}
        <p className="mt-4 flex items-start gap-2 text-[10px] leading-4 text-muted"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-mint" /> Nutrition totals are calculated from the values you entered in your food library. They are not independently verified.</p>
      </section>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SleepCard sleep={dayLog.sleep} onLog={onLogSleep} />
        <StepsCard key={date} steps={dayLog.steps} target={data.targets.steps} onSave={onSaveSteps} onSetTarget={onSetTargets} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FastingCard key={fasting.active?.id ?? "idle"} active={fasting.active} recent={fasting.recent} onStart={onStartFast} onEnd={onEndFast} onAdjust={onAdjustFast} />
        <HabitsCard habits={habits} onToggle={onToggleHabit} onManage={onManageHabits} onAdd={onAddHabit} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.4fr]">
        <WaterCard water={dayLog.water_ml} target={data.targets.water_ml} onAdd={onAddWater} onSetTarget={onSetTargets} />
        <NoteCard key={date} date={date} initial={dayLog.note} onSave={onSaveNote} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-3xl border border-line bg-panel p-4 sm:p-6">
          <div className="mb-5 flex items-center justify-between">
            <div><h3 className="font-semibold">This week</h3><p className="mt-1 text-xs text-muted">Food and training at a glance</p></div>
            <BarChart3 size={17} className="text-muted" />
          </div>
          <div className="h-[230px] w-full">
            <Suspense fallback={null}><WeekChart days={data.weekly.days} /></Suspense>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-muted"><span className="h-2 w-2 rounded-sm bg-lime" />Calories logged per day <span className="ml-auto">{data.weekly.days.reduce((sum, day) => sum + day.workouts, 0)} workout sessions</span></div>
        </section>

        <section className="rounded-3xl border border-line bg-panel p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div><h3 className="font-semibold">{isToday ? "Today's" : `${day}'s`} training</h3><p className="mt-1 text-xs text-muted">Tap a session to edit it</p></div>
            <button onClick={onLogWorkout} className="rounded-lg border border-line p-2 text-muted transition hover:border-mint/50 hover:text-mint" aria-label="Log a workout"><Plus size={16} /></button>
          </div>
          <TodayPlans routines={plansToday} loggedNames={data.workouts_today.map((workout) => workout.name)} onStart={onStartPlan} />
          {data.workouts_today.length === 0 && cardioToday.length === 0 ? (
            plansToday.length ? null :
            <EmptyState icon={Dumbbell} title="No workout logged yet" detail="Your training log will appear here." action="Log a workout" onClick={onLogWorkout} />
          ) : (
            <div className="space-y-3">
              {data.workouts_today.slice(0, 4).map((workout) => (
                <button key={workout.id} onClick={() => onEditWorkout(workout)} className="flex w-full items-center gap-3 rounded-2xl border border-line/80 bg-night/70 p-3.5 text-left transition hover:border-mint/40">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-mint/10 text-mint"><Dumbbell size={16} /></div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{workout.name}</p><p className="mt-1 text-[10px] text-muted">{workout.sets.length} recorded sets</p></div>
                  <Pencil size={14} className="text-muted" />
                </button>
              ))}
              {cardioToday.map((session) => (
                <button key={`cardio-${session.id}`} onClick={() => onEditCardio(session)} className="flex w-full items-center gap-3 rounded-2xl border border-line/80 bg-night/70 p-3.5 text-left transition hover:border-sky-300/40">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-300/10 text-sky-300"><Footprints size={16} /></div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{cardioLabel(session.type)}</p><p className="mt-1 text-[10px] text-muted">{session.minutes} min{session.kcal != null ? ` · ${formatNumber(session.kcal)} kcal` : ""}</p></div>
                  <Pencil size={14} className="text-muted" />
                </button>
              ))}
            </div>
          )}
          <button onClick={() => onNavigate("workouts")} className="mt-4 flex w-full items-center justify-between border-t border-line pt-4 text-xs text-muted transition hover:text-white">
            <span>View workout history</span><ChevronRight size={14} />
          </button>
        </section>
      </div>

      <section className="mt-4 rounded-3xl border border-line bg-panel p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <div><h3 className="font-semibold">{isToday ? "Today's" : `${day}'s`} food</h3><p className="mt-1 text-xs text-muted">Tap an entry to change its portion</p></div>
          <div className="flex shrink-0 gap-1.5">
            <button onClick={onCopyPrevious} className="button-secondary !min-h-9 !px-2.5" title="Copy the previous day's meals"><Copy size={14} /> {isToday ? "Yesterday" : "Day before"}</button>
            <button onClick={onLogMeal} className="button-secondary !min-h-9 !px-3"><Plus size={14} /> Add</button>
          </div>
        </div>
        {meals.length === 0 ? (
          <EmptyState
            icon={Utensils}
            title={foodsCount ? (isToday ? "Start today's food log" : `Nothing logged for ${day}`) : "Add your first food"}
            detail={foodsCount ? "Pick a food and portion to calculate your nutrition." : "Create your own food entry with nutrition values from a source you trust."}
            action={foodsCount ? "Log a meal" : "Open food library"}
            onClick={foodsCount ? onLogMeal : () => onNavigate("foods")}
          />
        ) : (
          <div className="divide-y divide-line">
            {meals.map((meal) => <MealRow key={meal.id} meal={meal} onEdit={() => onEditMeal(meal)} onDelete={() => onDeleteMeal(meal)} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function MealRow({ meal, onEdit, onDelete }: { meal: Meal; onEdit?: () => void; onDelete?: () => void }) {
  return (
    <SwipeToDelete onDelete={onDelete ?? (() => undefined)} className="rounded-xl">
    <div className="flex items-center gap-1 py-2">
      <button onClick={onEdit} disabled={!onEdit} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1.5 text-left transition hover:bg-panel-raised/40" aria-label={`Edit ${meal.food_name}`}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-200/10 text-amber-200"><Leaf size={16} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium">{meal.food_name}</p><span className="rounded-full bg-panel-raised px-2 py-0.5 text-[9px] capitalize text-muted">{meal.preparation}</span></div>
          <p className="mt-1 text-[10px] capitalize text-muted">{meal.meal_type} · {formatNumber(meal.portion_g)} g · {formatNumber(meal.protein_g)} g protein</p>
        </div>
        <div className="text-right"><p className="text-sm font-semibold">{formatNumber(meal.calories)}</p><p className="text-[9px] text-muted">kcal</p></div>
      </button>
      {onDelete && <button onClick={onDelete} className="hidden rounded-lg p-2 text-muted transition hover:bg-red-400/10 hover:text-red-300 lg:block" aria-label={`Remove ${meal.food_name}`}><Trash2 size={14} /></button>}
    </div>
    </SwipeToDelete>
  );
}

const GLASS_ML = 250;
/** 750 -> "0.75", 1500 -> "1.5" (no rounding a glass away). */
const litres = (ml: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(ml / 1000);
const BOTTLE_ML = 500;

function WaterCard({ water, target, onAdd, onSetTarget }: { water: number; target: number | null; onAdd: (ml: number) => void; onSetTarget: () => void }) {
  const glasses = water / GLASS_ML;
  const percent = target ? Math.min(water / target, 1) * 100 : 0;
  return (
    <section className="rounded-3xl border border-line bg-panel p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-muted"><Droplet size={15} className="text-sky-300" /> WATER</div>
          <p className="mt-3"><span className="text-3xl font-semibold tracking-tight">{litres(water)}</span> <span className="text-sm text-muted">L</span></p>
          <p className="mt-1 text-[11px] text-muted">{formatNumber(glasses)} {glasses === 1 ? "glass" : "glasses"}{target ? ` · ${litres(target)} L target` : ""}</p>
        </div>
        {!target && <button onClick={onSetTarget} className="rounded-xl border border-line px-3 py-2 text-xs font-medium text-muted">Set target</button>}
      </div>
      {target !== null && <div className="mt-4 h-2 overflow-hidden rounded-full bg-night"><div className="h-full rounded-full bg-sky-300 transition-all" style={{ width: `${percent}%` }} /></div>}
      <div className="mt-4 flex gap-2">
        <button onClick={() => onAdd(-GLASS_ML)} disabled={water <= 0} className="button-secondary !px-3 disabled:opacity-40" aria-label="Remove a glass"><Minus size={15} /></button>
        <button onClick={() => onAdd(GLASS_ML)} className="button-secondary flex-1"><Plus size={15} /> Glass · 250 ml</button>
        <button onClick={() => onAdd(BOTTLE_ML)} className="button-secondary flex-1"><Plus size={15} /> Bottle · 500 ml</button>
      </div>
    </section>
  );
}

/** Saves a moment after you stop typing, and when you leave the box. */
function NoteCard({ date, initial, onSave }: { date: string; initial: string; onSave: (note: string) => Promise<unknown> }) {
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saved = useRef(initial);
  // Take in a reloaded note, but never overwrite unsaved typing.
  useEffect(() => {
    setText((current) => (current === saved.current ? initial : current));
    saved.current = initial;
  }, [initial]);
  useEffect(() => {
    if (text === saved.current) return;
    const id = window.setTimeout(() => void save(), 800);
    return () => window.clearTimeout(id);
  });
  async function save() {
    if (text === saved.current) return;
    setStatus("saving");
    saved.current = text;
    await onSave(text);
    setStatus("saved");
  }
  return (
    <section className="rounded-3xl border border-line bg-panel p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-muted"><NotebookPen size={15} className="text-amber-300" /> NOTES · {dayName(date).toUpperCase()}</div>
        <span className="text-[10px] text-muted">{status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}</span>
      </div>
      <textarea
        value={text}
        onChange={(event) => { setText(event.target.value); setStatus("idle"); }}
        onBlur={() => void save()}
        rows={3}
        maxLength={2000}
        placeholder="Sleep, energy, how training felt…"
        className="input-dark mt-3 resize-none py-2.5 leading-5"
      />
    </section>
  );
}

function DateSwitcher({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  const today = localDate();
  const isToday = date === today;
  return (
    <div className="mb-4 flex items-center justify-between gap-2 rounded-2xl border border-line bg-panel p-1.5">
      <button onClick={() => onChange(addDays(date, -1))} className="rounded-xl p-2.5 text-muted transition hover:bg-panel-raised hover:text-white" aria-label="Previous day"><ChevronLeft size={18} /></button>
      <label className="relative flex flex-1 cursor-pointer flex-col items-center">
        <span className="text-sm font-semibold">{dayName(date)}</span>
        <span className="text-[10px] text-muted">{isToday ? dateLabel(date) : "Tap to pick a date"}</span>
        {/* Invisible native date picker over the label: tapping opens the iOS wheel. */}
        <input type="date" value={date} max={today} onChange={(event) => event.target.value && onChange(event.target.value)} className="absolute inset-0 opacity-0" aria-label="Pick a date" />
      </label>
      {isToday ? (
        <span className="w-[42px]" />
      ) : (
        <button onClick={() => onChange(addDays(date, 1) > today ? today : addDays(date, 1))} className="rounded-xl p-2.5 text-muted transition hover:bg-panel-raised hover:text-white" aria-label="Next day"><ChevronRight size={18} /></button>
      )}
      {!isToday && <button onClick={() => onChange(today)} className="rounded-xl bg-lime/10 px-3 py-2 text-[11px] font-semibold text-lime">Today</button>}
    </div>
  );
}

function BackupBanner({ backup, onBackup, onOpenSettings }: { backup: BackupStatus; onBackup: () => void; onOpenSettings: () => void }) {
  if (!backup.has_data) return null;
  const age = backup.last_backup_at === null ? null : daysSince(backup.last_backup_at);
  if (age !== null && age < BACKUP_REMIND_DAYS) return null;
  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-amber-200/20 bg-amber-200/5 px-4 py-3">
      <Share size={16} className="shrink-0 text-amber-200" />
      <button onClick={onOpenSettings} className="min-w-0 flex-1 text-left text-xs leading-5 text-amber-100/90">
        {age === null ? "You haven't backed up yet." : `Last backup was ${age} days ago.`} Your data is only on this phone.
      </button>
      <button onClick={onBackup} className="shrink-0 rounded-xl bg-amber-200/15 px-3 py-2 text-[11px] font-semibold text-amber-100">Back up</button>
    </div>
  );
}

function FoodLibrary({ foods, onAdd, onScan, onRecipe, onEdit, onDelete }: { foods: Food[]; onAdd: () => void; onScan: () => void; onRecipe: () => void; onEdit: (food: Food) => void; onDelete: (food: Food) => void }) {
  const [search, setSearch] = useState("");
  const visibleFoods = useMemo(() => foods.filter((food) => `${food.name} ${food.brand ?? ""}`.toLowerCase().includes(search.toLowerCase())), [foods, search]);
  return (
    <div className="mx-auto max-w-[1050px]">
      <PageIntro eyebrow="YOUR FOODS" title="Food library" detail="Your foods with nutrition per 100 g. Scan a packet's barcode or enter values from the label." action={<div className="flex shrink-0 gap-1.5"><button onClick={onScan} className="button-secondary !px-2.5" aria-label="Scan barcode"><ScanBarcode size={16} /></button><button onClick={onRecipe} className="button-secondary !px-2.5"><ChefHat size={16} /> Recipe</button><button onClick={onAdd} className="button-primary !px-2.5"><Plus size={16} /> Add</button></div>} />
      <div className="mb-5 flex items-center gap-3 rounded-2xl border border-line bg-panel px-4">
        <Search size={16} className="shrink-0 text-muted" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted" placeholder="Search foods or brands" />
        <span className="shrink-0 text-[10px] text-muted">{visibleFoods.length} foods</span>
      </div>
      {visibleFoods.length === 0 ? (
        <EmptyState icon={Apple} title={foods.length ? "No matching foods" : "Your library starts here"} detail={foods.length ? "Try a different search term." : "No pre-filled nutrition data. Add food details using a label or source you trust."} action={foods.length ? undefined : "Add a food"} onClick={onAdd} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {visibleFoods.map((food) => (
            <SwipeToDelete key={food.id} onDelete={() => onDelete(food)} className="min-w-0 rounded-2xl" contentClassName="">
            <article className="min-w-0 rounded-2xl border border-line bg-panel p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lime/10 text-lime"><Apple size={17} /></div>
                  <div className="min-w-0"><h3 className="truncate text-sm font-semibold">{food.name}</h3><p className="mt-1 truncate text-[10px] text-muted">{food.brand || "No brand"}</p></div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => onEdit(food)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-medium text-muted transition hover:bg-panel-raised hover:text-white">Edit</button>
                  <button onClick={() => onDelete(food)} className="rounded-lg p-1.5 text-muted transition hover:bg-red-400/10 hover:text-red-300" aria-label={`Delete ${food.name}`}><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                <div><p className="text-lg font-semibold">{formatNumber(food.calories_per_100g)} <span className="text-[10px] font-normal text-muted">kcal</span></p><p className="mt-0.5 text-[9px] text-muted">per 100 g</p></div>
                <div className="flex min-w-0 flex-wrap justify-end gap-x-3 gap-y-1 text-[10px] text-muted">
                  <span><b className="font-medium text-white">{formatNumber(food.protein_g_per_100g)}g</b> protein</span>
                  <span><b className="font-medium text-white">{formatNumber(food.carbohydrates_g_per_100g)}g</b> carbs</span>
                  <span><b className="font-medium text-white">{formatNumber(food.fat_g_per_100g)}g</b> fat</span>
                  <span><b className="font-medium text-white">{formatNumber(food.fiber_g_per_100g)}g</b> fiber</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[9px] text-muted"><span className="rounded-full bg-panel-raised px-2 py-1 capitalize">{food.preparation}</span>{food.servings.map((serving) => <span key={serving.label} className="rounded-full bg-lime/10 px-2 py-1 text-lime">{serving.label} · {formatNumber(serving.grams)} g</span>)}<span>{food.source === "open-food-facts" ? "From Open Food Facts · check against the label" : food.source === "recipe" ? "Recipe · from your ingredients" : food.source === "usda" ? "From the USDA food database" : "Manually entered · not independently verified"}</span></div>
              {food.notes && <p className="mt-2 text-[10px] leading-4 text-muted">{food.notes}</p>}
            </article>
            </SwipeToDelete>
          ))}
        </div>
      )}
      <p className="mt-6 flex items-start gap-2 text-[10px] leading-4 text-muted"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-mint" /> Nutrition is calculated from your own entries. Values are not validated against a nutrition database.</p>
    </div>
  );
}

type FoodBody = Omit<Food, "id" | "source" | "is_verified">;

function FoodForm({ initialFood, existingFoods, autoScan, busy, error, onSubmit }: { initialFood: Food | null; existingFoods: Food[]; autoScan: boolean; busy: boolean; error: string; onSubmit: (body: FoodBody & { source?: FoodSource }) => void }) {
  const [form, setForm] = useState({
    name: initialFood?.name ?? "",
    brand: initialFood?.brand ?? "",
    preparation: String(initialFood?.preparation ?? "unspecified"),
    calories_per_100g: initialFood ? String(initialFood.calories_per_100g) : "",
    protein_g_per_100g: initialFood ? String(initialFood.protein_g_per_100g) : "",
    carbohydrates_g_per_100g: initialFood ? String(initialFood.carbohydrates_g_per_100g) : "",
    fat_g_per_100g: initialFood ? String(initialFood.fat_g_per_100g) : "",
    fiber_g_per_100g: initialFood ? String(initialFood.fiber_g_per_100g) : "",
    notes: initialFood?.notes ?? "",
    sugar_g_per_100g: initialFood?.sugar_g_per_100g != null ? String(initialFood.sugar_g_per_100g) : "",
    sat_fat_g_per_100g: initialFood?.sat_fat_g_per_100g != null ? String(initialFood.sat_fat_g_per_100g) : "",
    sodium_mg_per_100g: initialFood?.sodium_mg_per_100g != null ? String(initialFood.sodium_mg_per_100g) : "",
  });
  const [servings, setServings] = useState((initialFood?.servings ?? []).map((serving) => ({ label: serving.label, grams: String(serving.grams) })));
  // Barcode scanning (new foods only)
  const [scanning, setScanning] = useState(autoScan && !initialFood);
  const [lookingUp, setLookingUp] = useState(false);
  const [scanInfo, setScanInfo] = useState("");
  const [source, setSource] = useState<FoodSource>("user-entered");
  const [dbOpen, setDbOpen] = useState(false);
  const [dbQuery, setDbQuery] = useState("");
  const dbResults = useFoodDbSearch(dbOpen ? dbQuery : "");

  function fillFromDb(item: DbFood) {
    const entry = foodFromDb(item);
    const text = (value: number | null | undefined) => (value == null ? "" : String(value));
    setForm((current) => ({
      ...current,
      name: entry.name,
      brand: "",
      preparation: entry.preparation,
      calories_per_100g: text(entry.calories_per_100g),
      protein_g_per_100g: text(entry.protein_g_per_100g),
      carbohydrates_g_per_100g: text(entry.carbohydrates_g_per_100g),
      fat_g_per_100g: text(entry.fat_g_per_100g),
      fiber_g_per_100g: text(entry.fiber_g_per_100g),
      sugar_g_per_100g: text(entry.sugar_g_per_100g),
      sat_fat_g_per_100g: text(entry.sat_fat_g_per_100g),
      sodium_mg_per_100g: text(entry.sodium_mg_per_100g),
      notes: entry.notes ?? "",
    }));
    setServings(entry.servings.map((serving) => ({ label: serving.label, grams: String(serving.grams) })));
    setSource("usda");
    setDbOpen(false);
    setScanInfo("Filled in from the USDA food database. You can rename it (e.g. \"Chicken breast, cooked\") and adjust anything before saving.");
  }

  const handleBarcode = useCallback(async (barcode: string) => {
    setScanning(false);
    setScanInfo("");
    const existing = existingFoods.find((food) => food.notes?.includes(`Barcode ${barcode}`));
    if (existing) {
      setScanInfo(`You already have this product: "${existing.name}".`);
      return;
    }
    setLookingUp(true);
    try {
      const found = await lookupBarcode(barcode);
      if (!found) {
        setForm((current) => ({ ...current, preparation: "packaged", notes: `Barcode ${barcode}` }));
        setScanInfo(`Barcode ${barcode} isn't in Open Food Facts yet. Enter the values from the label.`);
        return;
      }
      const text = (value: number | null) => (value === null ? "" : String(value));
      setForm((current) => ({
        ...current,
        name: found.name || current.name,
        brand: found.brand ?? "",
        preparation: "packaged",
        calories_per_100g: text(found.calories),
        protein_g_per_100g: text(found.protein),
        carbohydrates_g_per_100g: text(found.carbs),
        fat_g_per_100g: text(found.fat),
        fiber_g_per_100g: text(found.fiber),
        sugar_g_per_100g: text(found.sugar),
        sat_fat_g_per_100g: text(found.satFat),
        sodium_mg_per_100g: text(found.sodiumMg),
        notes: `Barcode ${barcode} · from Open Food Facts`,
      }));
      if (found.serving) setServings([{ label: found.serving.label, grams: String(found.serving.grams) }]);
      setSource("open-food-facts");
      const missing = [["name", found.name ? 1 : null], ["calories", found.calories], ["protein", found.protein], ["carbs", found.carbs], ["fat", found.fat], ["fiber", found.fiber]]
        .filter(([, value]) => value === null).map(([label]) => label);
      setScanInfo(`Filled in from Open Food Facts. Check it against the label before saving.${missing.length ? ` Missing: ${missing.join(", ")}, please add from the label.` : ""}`);
    } catch (cause) {
      setScanInfo(cause instanceof Error ? cause.message : "Lookup failed. Check your connection.");
    } finally {
      setLookingUp(false);
    }
  }, [existingFoods]);
  const [validation, setValidation] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const values = [form.calories_per_100g, form.protein_g_per_100g, form.carbohydrates_g_per_100g, form.fat_g_per_100g, form.fiber_g_per_100g];
    if (!form.name.trim() || values.some((value) => value.trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0)) {
      setValidation("Add a food name and a valid non-negative value for every nutrition field. Enter 0 only when you know the value is zero.");
      return;
    }
    const filledServings = servings.filter((serving) => serving.label.trim() || serving.grams.trim());
    if (filledServings.some((serving) => !serving.label.trim() || !(Number(serving.grams) > 0))) {
      setValidation("Each serving needs a name and a size in grams, e.g. \"1 bowl\" and 80.");
      return;
    }
    setValidation("");
    onSubmit({
      name: form.name.trim(),
      brand: form.brand.trim() || null,
      preparation: form.preparation as FoodBody["preparation"],
      calories_per_100g: Number(form.calories_per_100g),
      protein_g_per_100g: Number(form.protein_g_per_100g),
      carbohydrates_g_per_100g: Number(form.carbohydrates_g_per_100g),
      fat_g_per_100g: Number(form.fat_g_per_100g),
      fiber_g_per_100g: Number(form.fiber_g_per_100g),
      notes: form.notes.trim() || null,
      sugar_g_per_100g: form.sugar_g_per_100g.trim() ? Number(form.sugar_g_per_100g) : null,
      sat_fat_g_per_100g: form.sat_fat_g_per_100g.trim() ? Number(form.sat_fat_g_per_100g) : null,
      sodium_mg_per_100g: form.sodium_mg_per_100g.trim() ? Number(form.sodium_mg_per_100g) : null,
      servings: filledServings.map((serving) => ({ label: serving.label.trim(), grams: Number(serving.grams) })),
      ...(initialFood ? {} : { source }),
    });
  }
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const updateServing = (index: number, key: "label" | "grams", value: string) =>
    setServings((current) => current.map((serving, i) => (i === index ? { ...serving, [key]: value } : serving)));
  return (
    <form onSubmit={submit} className="space-y-4">
      {scanning && <BarcodeScanner onDetected={handleBarcode} onClose={() => setScanning(false)} />}
      {!initialFood && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setScanning(true)} disabled={lookingUp} className="button-secondary">
            {lookingUp ? <><Loader2 size={15} className="animate-spin" /> Looking up…</> : <><ScanBarcode size={16} /> Scan barcode</>}
          </button>
          <button type="button" onClick={() => setDbOpen((open) => !open)} className={`button-secondary ${dbOpen ? "!border-lime/50 !text-lime" : ""}`}><Database size={15} /> Food database</button>
        </div>
      )}
      {dbOpen && (
        <div className="space-y-2 rounded-2xl bg-night p-3">
          <div className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3">
            <Search size={15} className="shrink-0 text-muted" />
            <input autoFocus value={dbQuery} onChange={(e) => setDbQuery(e.target.value)} placeholder="e.g. chicken breast cooked" className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted" aria-label="Search food database" />
          </div>
          {dbQuery.trim().length >= 2 && <DbResults results={dbResults} adding={null} onPick={fillFromDb} />}
        </div>
      )}
      {scanInfo ? (
        <p className="rounded-xl border border-mint/20 bg-mint/5 p-3 text-[11px] leading-5 text-zinc-300">{scanInfo}</p>
      ) : (
        <p className="rounded-xl border border-amber-200/10 bg-amber-200/5 p-3 text-[11px] leading-5 text-muted">Use the nutrition values from your own label or source. These values will be marked as user-entered, not verified.</p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Food name" required><input required maxLength={120} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Rolled oats" className="input-dark" /></Field>
        <Field label="Brand (optional)"><input maxLength={120} value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder="Brand or source note" className="input-dark" /></Field>
      </div>
      <Field label="Preparation state">
        <select value={form.preparation} onChange={(e) => set("preparation", e.target.value)} className="input-dark">
          <option value="unspecified">Unspecified</option><option value="raw">Raw</option><option value="cooked">Cooked</option><option value="packaged">Packaged</option>
        </select>
      </Field>
      <div>
        <p className="mb-2 text-xs font-medium text-zinc-300">Nutrition per 100 g <span className="text-red-300">*</span></p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberField label="Calories · kcal" value={form.calories_per_100g} onChange={(v) => set("calories_per_100g", v)} required />
          <NumberField label="Protein · g" value={form.protein_g_per_100g} onChange={(v) => set("protein_g_per_100g", v)} required />
          <NumberField label="Carbohydrates · g" value={form.carbohydrates_g_per_100g} onChange={(v) => set("carbohydrates_g_per_100g", v)} required />
          <NumberField label="Fat · g" value={form.fat_g_per_100g} onChange={(v) => set("fat_g_per_100g", v)} required />
          <NumberField label="Fiber · g" value={form.fiber_g_per_100g} onChange={(v) => set("fiber_g_per_100g", v)} required />
        </div>
        <p className="mb-2 mt-4 text-xs font-medium text-zinc-300">Optional, per 100 g</p>
        <div className="grid grid-cols-3 gap-3">
          <NumberField label="Sugar · g" value={form.sugar_g_per_100g} onChange={(v) => set("sugar_g_per_100g", v)} />
          <NumberField label="Sat. fat · g" value={form.sat_fat_g_per_100g} onChange={(v) => set("sat_fat_g_per_100g", v)} />
          <NumberField label="Sodium · mg" value={form.sodium_mg_per_100g} onChange={(v) => set("sodium_mg_per_100g", v)} />
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-zinc-300">Servings (optional)</p>
        <p className="mb-2 text-[10px] text-muted">Name portions you eat often, like "1 bowl" = 80 g, so you can log them with one tap.</p>
        <div className="space-y-2">
          {servings.map((serving, index) => (
            <div key={index} className="grid grid-cols-[minmax(0,1fr)_90px_30px] items-center gap-2">
              <input value={serving.label} maxLength={40} onChange={(e) => updateServing(index, "label", e.target.value)} placeholder="e.g. 1 bowl" className="input-dark" aria-label="Serving name" />
              <input type="number" min="0" step="any" inputMode="decimal" value={serving.grams} onChange={(e) => updateServing(index, "grams", e.target.value)} placeholder="grams" className="input-dark text-center" aria-label="Serving grams" />
              <button type="button" onClick={() => setServings((current) => current.filter((_, i) => i !== index))} aria-label="Remove serving" className="rounded-lg p-2 text-muted hover:text-red-300"><X size={14} /></button>
            </div>
          ))}
        </div>
        {servings.length < 10 && <button type="button" onClick={() => setServings((current) => [...current, { label: "", grams: "" }])} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-lime hover:text-white"><Plus size={14} /> Add serving</button>}
      </div>
      <Field label="Notes (optional)"><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder="Add a note about the source or preparation." className="input-dark resize-none" /></Field>
      {(validation || error) && <FormError message={validation || error} />}
      <button disabled={busy} className="button-primary w-full disabled:cursor-wait disabled:opacity-60">{busy ? "Saving…" : initialFood ? "Save food changes" : "Add to food library"}</button>
    </form>
  );
}

const MEAL_TYPE_OPTIONS = ["breakfast", "lunch", "dinner", "snack"];

function MealTypePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {MEAL_TYPE_OPTIONS.map((type) => (
        <button key={type} type="button" onClick={() => onChange(type)} className={`rounded-xl border px-1 py-2 text-[11px] font-medium capitalize transition ${value === type ? "border-lime bg-lime/10 text-lime" : "border-line text-muted hover:text-white"}`}>
          {type}
        </button>
      ))}
    </div>
  );
}

/** Quantity × serving (or grams). Remounted per food via `key`, so it starts from that food's servings. */
function PortionPicker({ grams, onChange, servings }: { grams: string; onChange: (grams: string) => void; servings: Serving[] }) {
  return <AmountInput grams={grams} servings={servings} onChange={onChange} label="Portion" />;
}

function NutritionPreview({ calories, protein, carbs, fat, fiber, grams }: { calories: number; protein: number; carbs: number; fat: number; fiber: number; grams: number }) {
  return (
    <div className="rounded-2xl border border-line bg-night p-4">
      <p className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted"><Sparkles size={12} className="text-lime" /> Calculated from your food values</p>
      <div className="grid grid-cols-3 gap-3">
        <PreviewMetric label="Calories" value={`${formatNumber(calories)} kcal`} />
        <PreviewMetric label="Protein" value={`${formatNumber(protein)} g`} />
        <PreviewMetric label="Carbs" value={`${formatNumber(carbs)} g`} />
        <PreviewMetric label="Fat" value={`${formatNumber(fat)} g`} />
        <PreviewMetric label="Fiber" value={`${formatNumber(fiber)} g`} />
        <PreviewMetric label="Portion" value={`${formatNumber(grams)} g`} />
      </div>
    </div>
  );
}

function FoodChoice({ food, selected, onSelect }: { food: Food; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${selected ? "border-lime bg-lime/10" : "border-line/70 bg-night/60 hover:border-zinc-500"}`}>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${selected ? "text-lime" : ""}`}>{food.name}</p>
        <p className="mt-0.5 truncate text-[10px] capitalize text-muted">{food.preparation}{food.brand ? ` · ${food.brand}` : ""}</p>
      </div>
      <span className="shrink-0 text-[10px] text-muted">{formatNumber(food.calories_per_100g)} kcal/100 g</span>
      {selected && <Check size={15} className="shrink-0 text-lime" />}
    </button>
  );
}

function MealForm({ foods, recentFoodIds, busy, error, date, dayLabel, onAddFood, onAddFromDb, onSubmit }: { foods: Food[]; recentFoodIds: number[]; busy: boolean; error: string; date: string; dayLabel: string; onAddFood: () => void; onAddFromDb: (item: DbFood) => Promise<Food | null>; onSubmit: (body: { food_id: number; date: string; meal_type: string; portion_g: number }) => void }) {
  const recent = recentFoodIds.map((id) => foods.find((food) => food.id === id)).filter((food): food is Food => Boolean(food));
  const firstFood = recent[0] ?? (foods.length === 1 ? foods[0] : undefined);
  const [search, setSearch] = useState("");
  const [foodId, setFoodId] = useState<number | null>(firstFood?.id ?? null);
  const [mealType, setMealType] = useState(defaultMealType);
  const [portion, setPortion] = useState(firstFood?.servings[0] ? String(firstFood.servings[0].grams) : "100");
  const [validation, setValidation] = useState("");
  const selectedFood = foods.find((food) => food.id === foodId);
  const term = search.trim().toLowerCase();
  const matches = term ? foods.filter((food) => `${food.name} ${food.brand ?? ""}`.toLowerCase().includes(term)) : foods;
  const grams = Number(portion);
  const multiplier = Number.isFinite(grams) && grams > 0 ? grams / 100 : 0;
  const dbResults = useFoodDbSearch(term);
  const [adding, setAdding] = useState<string | null>(null);

  /** Adds a database food to the library (or reuses one with the same name) and selects it. */
  async function chooseFromDb(item: DbFood) {
    const existing = foods.find((food) => food.name.toLowerCase() === item.name.toLowerCase());
    if (existing) { choose(existing); return; }
    setAdding(item.name);
    const food = await onAddFromDb(item);
    setAdding(null);
    if (food) choose(food);
  }

  function choose(food: Food) {
    setFoodId(food.id);
    setPortion(food.servings[0] ? String(food.servings[0].grams) : "100");
    setValidation("");
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedFood || !Number.isFinite(grams) || grams <= 0) {
      setValidation(selectedFood ? "Enter a portion greater than 0 g." : "Pick a food first.");
      return;
    }
    setValidation("");
    onSubmit({ food_id: selectedFood.id, date, meal_type: mealType, portion_g: grams });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center gap-2 rounded-xl border border-line bg-night px-3">
        <Search size={15} className="shrink-0 text-muted" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search foods, e.g. chicken breast cooked" className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted" aria-label="Search foods" />
        {search && <button type="button" onClick={() => setSearch("")} className="text-muted" aria-label="Clear search"><X size={14} /></button>}
      </div>

      {!term && recent.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Recent</p>
          <div className="space-y-1.5">{recent.map((food) => <FoodChoice key={food.id} food={food} selected={food.id === foodId} onSelect={() => choose(food)} />)}</div>
        </div>
      )}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">{term ? `${matches.length} found` : "All foods"}</p>
        {matches.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-4 text-center text-xs text-muted">
            {foods.length === 0 ? "Your library is empty. Search above to use the food database," : `None of your foods match "${search}".`}
            <button type="button" onClick={onAddFood} className="ml-1 font-semibold text-lime">{foods.length === 0 ? "or add your own" : "Add your own"}</button>
          </div>
        ) : (
          <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">{matches.map((food) => <FoodChoice key={food.id} food={food} selected={food.id === foodId} onSelect={() => choose(food)} />)}</div>
        )}
      </div>
      {term.length >= 2 && <DbResults results={dbResults} adding={adding} onPick={(item) => void chooseFromDb(item)} />}

      {selectedFood && (
        <>
          <Field label="Meal"><MealTypePicker value={mealType} onChange={setMealType} /></Field>
          <Field label="Portion"><PortionPicker key={selectedFood.id} grams={portion} onChange={setPortion} servings={selectedFood.servings} /></Field>
          {multiplier > 0 && (
            <NutritionPreview
              calories={selectedFood.calories_per_100g * multiplier}
              protein={selectedFood.protein_g_per_100g * multiplier}
              carbs={selectedFood.carbohydrates_g_per_100g * multiplier}
              fat={selectedFood.fat_g_per_100g * multiplier}
              fiber={selectedFood.fiber_g_per_100g * multiplier}
              grams={grams}
            />
          )}
        </>
      )}
      {(validation || error) && <FormError message={validation || error} />}
      <button disabled={busy || !selectedFood} className="button-primary w-full disabled:opacity-60">{busy ? "Saving…" : `Add to ${dayLabel === "Today" ? "today" : dayLabel}`}</button>
    </form>
  );
}

/** Searches the built-in food database as you type (downloaded on first use). */
function useFoodDbSearch(term: string) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "error"; results: DbFood[] }>({ status: "idle", results: [] });
  useEffect(() => {
    if (term.trim().length < 2) { setState({ status: "idle", results: [] }); return; }
    let live = true;
    setState((current) => ({ ...current, status: "loading" }));
    const id = window.setTimeout(() => {
      loadFoodDb()
        .then((db) => { if (live) setState({ status: "ready", results: searchFoodDb(db, term) }); })
        .catch(() => { if (live) setState({ status: "error", results: [] }); });
    }, 200);
    return () => { live = false; window.clearTimeout(id); };
  }, [term]);
  return state;
}

function DbResults({ results, adding, onPick }: { results: ReturnType<typeof useFoodDbSearch>; adding: string | null; onPick: (item: DbFood) => void }) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted"><Database size={11} /> Food database (USDA)</p>
      {results.status === "loading" && <p className="text-xs text-muted"><Loader2 size={13} className="mr-1.5 inline animate-spin" />Searching…</p>}
      {results.status === "error" && <p className="text-xs text-red-200">Couldn't load the food database. Check your connection; it works offline after the first time.</p>}
      {results.status === "ready" && results.results.length === 0 && <p className="text-xs text-muted">No matches. Try simpler words, e.g. "chicken breast", "rice cooked", "lentils".</p>}
      <div className="space-y-1.5">
        {results.results.map((item) => (
          <button key={item.name} type="button" disabled={adding !== null} onClick={() => onPick(item)} className="flex w-full items-center gap-3 rounded-xl border border-dashed border-line px-3 py-2.5 text-left transition hover:border-lime/40 disabled:opacity-60">
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[13px] leading-5">{item.name}</p>
              <p className="mt-0.5 text-[10px] text-muted">{formatNumber(item.kcal)} kcal · {formatNumber(item.protein)} g protein per 100 g{item.portions[0] ? ` · ${item.portions[0].label} = ${formatNumber(item.portions[0].grams)} g` : ""}</p>
            </div>
            {adding === item.name ? <Loader2 size={15} className="shrink-0 animate-spin text-lime" /> : <Plus size={15} className="shrink-0 text-lime" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function MealEditForm({ meal, servings, busy, error, onSubmit, onDelete }: { meal: Meal; servings: Serving[]; busy: boolean; error: string; onSubmit: (body: { date: string; meal_type: string; portion_g: number }) => void; onDelete: () => void }) {
  const [mealType, setMealType] = useState(meal.meal_type);
  const [portion, setPortion] = useState(String(meal.portion_g));
  const [date, setDate] = useState(meal.date);
  const [validation, setValidation] = useState("");
  const grams = Number(portion);
  const ratio = Number.isFinite(grams) && grams > 0 ? grams / meal.portion_g : 0;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!Number.isFinite(grams) || grams <= 0) { setValidation("Enter a portion greater than 0 g."); return; }
    setValidation("");
    onSubmit({ date, meal_type: mealType, portion_g: grams });
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Meal"><MealTypePicker value={mealType} onChange={setMealType} /></Field>
      <Field label="Portion"><PortionPicker grams={portion} onChange={setPortion} servings={servings} /></Field>
      <Field label="Day"><input type="date" value={date} max={localDate()} onChange={(e) => e.target.value && setDate(e.target.value)} className="input-dark" /></Field>
      {ratio > 0 && (
        <NutritionPreview calories={meal.calories * ratio} protein={meal.protein_g * ratio} carbs={meal.carbohydrates_g * ratio} fat={meal.fat_g * ratio} fiber={meal.fiber_g * ratio} grams={grams} />
      )}
      {(validation || error) && <FormError message={validation || error} />}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={onDelete} className="button-secondary !border-red-300/20 !text-red-200 disabled:opacity-60"><Trash2 size={14} /> Delete</button>
        <button disabled={busy} className="button-primary flex-1 disabled:opacity-60">{busy ? "Saving…" : "Save changes"}</button>
      </div>
    </form>
  );
}

/** `weight` is in the display unit; `kg`/`shown` remember the stored value so unchanged sets keep it exactly. */
type SetDraft = { exercise_name: string; reps: string; weight: string; kg?: number; shown?: string };

const toDrafts = (workout: Workout, unit: Unit): SetDraft[] =>
  workout.sets.map((set) => {
    const shown = String(fromKg(set.weight_kg, unit));
    return { exercise_name: set.exercise_name, reps: String(set.reps), weight: shown, kg: set.weight_kg, shown };
  });

function WorkoutForm({ initial, isEdit, history, planTargets, busy, error, date, onSubmit }: { initial: Workout | null; isEdit: boolean; history: Workout[]; planTargets: Record<string, number>; busy: boolean; error: string; date: string; onSubmit: (body: WorkoutBody) => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const { unit } = usePrefs();
  const [sets, setSets] = useState<SetDraft[]>(initial ? toDrafts(initial, unit) : [{ exercise_name: "", reps: "", weight: "" }]);
  const [validation, setValidation] = useState("");
  const [restKick, setRestKick] = useState(0);

  // Sessions up to this workout's day (newest first), excluding the one being edited.
  const past = useMemo(
    () => history
      .filter((workout) => workout.date <= date && !(isEdit && workout.id === initial?.id))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
    [history, initial, isEdit, date],
  );
  const exerciseNames = useMemo(() => [...new Set(past.flatMap((workout) => workout.sets.map((set) => set.exercise_name)))], [past]);
  const recentWorkouts = useMemo(() => {
    const seen = new Set<string>();
    return past.filter((workout) => {
      const key = workout.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 4);
  }, [past]);

  function lastTime(exercise: string) {
    const key = exercise.trim().toLowerCase();
    if (!key) return null;
    for (const workout of past) {
      const matching = workout.sets.filter((set) => set.exercise_name.toLowerCase() === key);
      if (matching.length) return { date: workout.date, sets: matching };
    }
    return null;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setValidation("Add a workout name."); return; }
    if (sets.some((set) => !set.exercise_name.trim() || !Number.isInteger(Number(set.reps)) || Number(set.reps) < 1 || set.weight.trim() === "" || !Number.isFinite(Number(set.weight)) || Number(set.weight) < 0)) {
      setValidation(`Each set needs an exercise, reps, and a non-negative weight. Use 0 ${unit} for bodyweight sets.`);
      return;
    }
    const counts: Record<string, number> = {};
    const normalized = sets.map((set) => {
      const exercise_name = set.exercise_name.trim();
      counts[exercise_name] = (counts[exercise_name] ?? 0) + 1;
      const weight_kg = set.kg !== undefined && set.weight === set.shown ? set.kg : toKg(Number(set.weight), unit);
      return { exercise_name, set_number: counts[exercise_name], reps: Number(set.reps), weight_kg };
    });
    setValidation("");
    onSubmit({ name: name.trim(), date, sets: normalized });
  }
  function updateSet(index: number, key: "exercise_name" | "reps" | "weight", value: string) {
    setSets((current) => current.map((set, i) => (i === index ? { ...set, [key]: value } : set)));
  }
  function addSet() {
    unlockAudio(); // must happen inside the tap for iOS to allow the end-of-rest chime
    setRestKick((count) => count + 1);
    // Copy the previous set so the next one is usually just one tap away.
    setSets((current) => {
      const last = current[current.length - 1];
      return [...current, last ? { ...last } : { exercise_name: "", reps: "", weight: "" }];
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {!initial && recentWorkouts.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted"><Repeat size={12} /> Repeat a previous workout</p>
          <div className="flex flex-wrap gap-1.5">
            {recentWorkouts.map((workout) => (
              <button key={workout.id} type="button" onClick={() => { setName(workout.name); setSets(toDrafts(workout, unit)); }} className="rounded-full border border-mint/30 px-3 py-1.5 text-[11px] font-medium text-mint transition hover:bg-mint/10">
                {workout.name} <span className="text-muted">· {dateLabel(workout.date)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <Field label="Workout name"><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Upper body" className="input-dark" /></Field>
      <div>
        <div className="mb-2 flex items-center justify-between"><p className="text-xs font-medium text-zinc-300">Sets</p><span className="text-[10px] text-muted">Weight in {unit}</span></div>
        <datalist id="exercise-names">{exerciseNames.map((exercise) => <option key={exercise} value={exercise} />)}</datalist>
        <div className="space-y-2">
          {sets.map((set, index) => {
            // Show "last time" once, above the first set of each exercise.
            const startsExercise = index === 0 || set.exercise_name.trim().toLowerCase() !== sets[index - 1].exercise_name.trim().toLowerCase();
            const previous = startsExercise ? lastTime(set.exercise_name) : null;
            const increase = startsExercise ? suggestIncrease(set.exercise_name, past, planTargets[set.exercise_name.trim().toLowerCase()] ?? null, unit === "lb" ? 5 / 2.2046226218 : 2.5) : null;
            const suggested = increase ? String(fromKg(increase.toKg, unit)) : "";
            const exerciseKey = set.exercise_name.trim().toLowerCase();
            const alreadyUsed = increase !== null && sets.filter((item) => item.exercise_name.trim().toLowerCase() === exerciseKey).every((item) => item.weight === suggested);
            return (
              <div key={index}>
                {previous && (
                  <p className="mb-1 rounded-lg bg-mint/5 px-2.5 py-1.5 text-[10px] text-mint">
                    Last time ({dateLabel(previous.date)}): {previous.sets.map((item) => `${item.reps} × ${formatNumber(fromKg(item.weight_kg, unit))} ${unit}`).join(" · ")}
                  </p>
                )}
                {increase && (
                  <div className="mb-1 flex items-center justify-between gap-2 rounded-lg bg-lime/10 px-2.5 py-1.5 text-[10px] text-lime">
                    <span>You hit {increase.reps}+ reps at {formatNumber(fromKg(increase.fromKg, unit))} {unit} twice. {alreadyUsed ? "Filled in" : "Try"} {formatNumber(fromKg(increase.toKg, unit))} {unit}.</span>
                    {!alreadyUsed && (
                      <button type="button" onClick={() => setSets((current) => current.map((item) => (item.exercise_name.trim().toLowerCase() === exerciseKey ? { ...item, weight: suggested, kg: undefined, shown: undefined } : item)))} className="shrink-0 rounded-md bg-lime/20 px-2 py-1 font-semibold">Use</button>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-[minmax(0,1fr)_60px_72px_30px] items-end gap-2">
                  <Field label={index === 0 ? "Exercise" : " "}><input value={set.exercise_name} list="exercise-names" onChange={(e) => updateSet(index, "exercise_name", e.target.value)} placeholder="Exercise name" className="input-dark !px-2.5" /></Field>
                  <Field label={index === 0 ? "Reps" : " "}><input type="number" inputMode="numeric" min="1" value={set.reps} onChange={(e) => updateSet(index, "reps", e.target.value)} placeholder="0" className="input-dark !px-2 text-center" /></Field>
                  <Field label={index === 0 ? "Weight" : " "}><input type="number" inputMode="decimal" min="0" step="any" value={set.weight} onChange={(e) => updateSet(index, "weight", e.target.value)} placeholder="0" className="input-dark !px-2 text-center" /></Field>
                  <button type="button" onClick={() => setSets((current) => (current.length > 1 ? current.filter((_, i) => i !== index) : current))} aria-label="Remove set" className="mb-1 rounded-lg p-2 text-muted hover:text-red-300"><X size={14} /></button>
                </div>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={addSet} className="mt-3 flex items-center gap-1.5 text-xs font-medium text-mint hover:text-white"><Plus size={14} /> Add set</button>
      </div>
      {(validation || error) && <FormError message={validation || error} />}
      <button disabled={busy} className="button-primary w-full disabled:opacity-60">{busy ? "Saving…" : isEdit ? "Save changes" : "Save workout"}</button>
      {!isEdit && <RestTimer kick={restKick} />}
    </form>
  );
}

function TargetsForm({ context, onSaveProfile, targets, busy, error, onSubmit }: { context: { profile: Profile | null; weightKg: number | null; energy: EnergyEstimate | null }; onSaveProfile: (profile: Profile) => Promise<boolean>; targets: Targets; busy: boolean; error: string; onSubmit: (body: Targets) => void }) {
  const [form, setForm] = useState({
    calories: targets.calories == null ? "" : String(targets.calories),
    protein_g: targets.protein_g == null ? "" : String(targets.protein_g),
    carbohydrates_g: targets.carbohydrates_g == null ? "" : String(targets.carbohydrates_g),
    fat_g: targets.fat_g == null ? "" : String(targets.fat_g),
    fiber_g: targets.fiber_g == null ? "" : String(targets.fiber_g),
    workouts_per_week: targets.workouts_per_week == null ? "" : String(targets.workouts_per_week),
    water_ml: targets.water_ml == null ? "" : String(targets.water_ml),
    steps: targets.steps == null ? "" : String(targets.steps),
  });
  const [validation, setValidation] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const fields = Object.entries(form);
    const invalid = fields.some(([, value]) => value.trim() !== "" && (!Number.isFinite(Number(value)) || Number(value) <= 0));
    if (invalid) { setValidation("Targets must be positive numbers, or left blank."); return; }
    setValidation("");
    onSubmit({
      calories: form.calories.trim() ? Number(form.calories) : null,
      protein_g: form.protein_g.trim() ? Number(form.protein_g) : null,
      carbohydrates_g: form.carbohydrates_g.trim() ? Number(form.carbohydrates_g) : null,
      fat_g: form.fat_g.trim() ? Number(form.fat_g) : null,
      fiber_g: form.fiber_g.trim() ? Number(form.fiber_g) : null,
      workouts_per_week: form.workouts_per_week.trim() ? Number(form.workouts_per_week) : null,
      water_ml: form.water_ml.trim() ? Number(form.water_ml) : null,
      steps: form.steps.trim() ? Number(form.steps) : null,
    });
  }
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="space-y-4">
    {/* Outside the targets <form>: the calculator has a form of its own. */}
    <TargetCalculator
      profile={context.profile}
      latestWeightKg={context.weightKg}
      energy={context.energy}
      onSaveProfile={onSaveProfile}
      onApply={(values) => setForm((current) => ({ ...current, ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value == null ? "" : String(value)])) }))}
    />
    <form onSubmit={submit} className="space-y-4">
      <p className="rounded-xl border border-line bg-night p-3 text-[11px] leading-5 text-muted">Targets are optional and personal. Leave any field blank if you don't use that target. Review, then tap Save targets.</p>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Calories · kcal" value={form.calories} onChange={(v) => update("calories", v)} />
        <NumberField label="Protein · g" value={form.protein_g} onChange={(v) => update("protein_g", v)} />
        <NumberField label="Carbohydrates · g" value={form.carbohydrates_g} onChange={(v) => update("carbohydrates_g", v)} />
        <NumberField label="Fat · g" value={form.fat_g} onChange={(v) => update("fat_g", v)} />
        <NumberField label="Fiber · g" value={form.fiber_g} onChange={(v) => update("fiber_g", v)} />
        <NumberField label="Workouts · / week" value={form.workouts_per_week} onChange={(v) => update("workouts_per_week", v)} />
        <NumberField label="Water · ml / day" value={form.water_ml} onChange={(v) => update("water_ml", v)} />
        <NumberField label="Steps · / day" value={form.steps} onChange={(v) => update("steps", v)} />
      </div>
      {(validation || error) && <FormError message={validation || error} />}
      <button disabled={busy} className="button-primary w-full disabled:opacity-60">{busy ? "Saving…" : "Save targets"}</button>
    </form>
    </div>
  );
}

function WorkoutsPage({ workouts, cardio, routines, onAdd, onEdit, onRepeat, onDelete, onAddCardio, onEditCardio, onDeleteCardio, onAddRoutine, onEditRoutine, onStartRoutine, onDeleteRoutine }: { workouts: Workout[]; cardio: Cardio[]; routines: Routine[]; onAdd: () => void; onEdit: (workout: Workout) => void; onRepeat: (workout: Workout) => void; onDelete: (workout: Workout) => void; onAddCardio: () => void; onEditCardio: (session: Cardio) => void; onDeleteCardio: (session: Cardio) => void; onAddRoutine: () => void; onEditRoutine: (routine: Routine) => void; onStartRoutine: (routine: Routine) => void; onDeleteRoutine: (routine: Routine) => void }) {
  const { unit } = usePrefs();
  const [view, setView] = useState<"strength" | "cardio" | "plans">("strength");
  const personalRecords = useMemo(() => {
    const records = new Map<string, number>();
    workouts.forEach((workout) => workout.sets.forEach((set) => records.set(set.exercise_name, Math.max(records.get(set.exercise_name) ?? 0, set.weight_kg))));
    return [...records.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [workouts]);
  return (
    <div className="mx-auto max-w-[1050px]">
      <PageIntro eyebrow="TRAINING JOURNAL" title="Workouts" detail="Strength sets and cardio sessions. Both count toward your weekly target." action={<button onClick={view === "strength" ? onAdd : view === "cardio" ? onAddCardio : onAddRoutine} className="button-primary !px-3"><Plus size={16} /> {view === "strength" ? "Workout" : view === "cardio" ? "Cardio" : "Plan"}</button>} />
      <div className="mb-4 flex rounded-xl border border-line bg-panel p-1">
        {(["strength", "cardio", "plans"] as const).map((option) => (
          <button key={option} onClick={() => setView(option)} className={`flex-1 rounded-lg py-2 text-xs font-medium capitalize transition ${view === option ? "bg-mint text-night" : "text-muted"}`}>
            {option} · {option === "strength" ? workouts.length : option === "cardio" ? cardio.length : routines.length}
          </button>
        ))}
      </div>
      {view === "plans" ? (
        routines.length === 0 ? <EmptyState icon={ClipboardList} title="No plans yet" detail="Set up routines like Push / Pull / Legs with days and target sets × reps. Start one in a tap and it fills in last time's weights." action="Create a plan" onClick={onAddRoutine} /> : (
          <div className="space-y-3">{routines.map((routine) => <RoutineCard key={routine.id} routine={routine} onEdit={() => onEditRoutine(routine)} onStart={() => onStartRoutine(routine)} onDelete={() => onDeleteRoutine(routine)} />)}</div>
        )
      ) : view === "cardio" ? (
        cardio.length === 0 ? <EmptyState icon={Footprints} title="No cardio yet" detail="Log runs, walks, rides or swims with time, distance and calories." action="Log cardio" onClick={onAddCardio} /> : (
          <div className="space-y-3">{cardio.map((session) => <CardioCard key={session.id} session={session} onEdit={() => onEditCardio(session)} onDelete={() => onDeleteCardio(session)} />)}</div>
        )
      ) : (<>
      {personalRecords.length > 0 && (
        <section className="mb-5 rounded-3xl border border-line bg-panel p-5">
          <div className="mb-4 flex items-center gap-2"><Target size={15} className="text-lime" /><h3 className="text-sm font-semibold">Top recorded weights</h3><span className="text-[10px] text-muted">from your logged sets</span></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{personalRecords.map(([exercise, weight]) => <div key={exercise} className="rounded-xl bg-night p-3"><p className="truncate text-xs font-medium">{exercise}</p><p className="mt-2 text-lg font-semibold">{formatNumber(fromKg(weight, unit))} <span className="text-[10px] font-normal text-muted">{unit}</span></p></div>)}</div>
        </section>
      )}
      {workouts.length === 0 ? <EmptyState icon={Dumbbell} title="Your training log is ready" detail="Add a workout with exercises, reps, and weights to start building your history." action="Log a workout" onClick={onAdd} /> : (
        <div className="space-y-3">
          {workouts.map((workout) => <WorkoutCard key={workout.id} workout={workout} onEdit={() => onEdit(workout)} onRepeat={() => onRepeat(workout)} onDelete={() => onDelete(workout)} />)}
        </div>
      )}
      </>)}
    </div>
  );
}

function WorkoutCard({ workout, onEdit, onRepeat, onDelete }: { workout: Workout; onEdit: () => void; onRepeat: () => void; onDelete: () => void }) {
  const { unit } = usePrefs();
  const grouped = useMemo(() => {
    const map = new Map<string, typeof workout.sets>();
    workout.sets.forEach((set) => map.set(set.exercise_name, [...(map.get(set.exercise_name) ?? []), set]));
    return [...map.entries()];
  }, [workout.sets]);
  return (
    <SwipeToDelete onDelete={onDelete} className="rounded-2xl" contentClassName="">
    <article className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <button onClick={onEdit} className="flex min-w-0 items-center gap-3 text-left">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-mint/10 text-mint"><Dumbbell size={17} /></div>
          <div className="min-w-0"><h3 className="truncate text-sm font-semibold">{workout.name}</h3><p className="mt-1 text-[10px] text-muted">{dateLabel(workout.date)} · {workout.sets.length} sets</p></div>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <button onClick={onRepeat} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-medium text-mint transition hover:bg-mint/10" aria-label={`Repeat ${workout.name}`}><Repeat size={13} /> Repeat</button>
          <button onClick={onEdit} className="rounded-lg p-2 text-muted transition hover:bg-panel-raised hover:text-white" aria-label={`Edit ${workout.name}`}><Pencil size={14} /></button>
          <button onClick={onDelete} className="rounded-lg p-2 text-muted transition hover:bg-red-400/10 hover:text-red-300" aria-label={`Delete ${workout.name}`}><Trash2 size={14} /></button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {grouped.map(([exercise, sets]) => (
          <div key={exercise} className="rounded-xl bg-night px-3 py-2.5">
            <p className="text-xs font-medium">{exercise}</p>
            <p className="mt-1 text-[10px] text-muted">{sets.map((set) => `${set.reps} × ${formatNumber(fromKg(set.weight_kg, unit))} ${unit}`).join("  ·  ")}</p>
          </div>
        ))}
      </div>
      {workout.notes && <p className="mt-3 text-xs text-muted">{workout.notes}</p>}
    </article>
    </SwipeToDelete>
  );
}

function SettingsPage({ targets, onEditTargets, backup, onBackup, onImport }: { targets: Targets; onEditTargets: () => void; backup: BackupStatus; onBackup: () => void; onImport: (backup: unknown) => void }) {
  const age = backup.last_backup_at === null ? null : daysSince(backup.last_backup_at);
  const lastBackup = age === null ? "Never" : age === 0 ? "Today" : age === 1 ? "Yesterday" : `${age} days ago`;
  const prefs = usePrefs();
  function importData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!window.confirm("Restoring a backup replaces ALL data currently on this device. Continue?")) return;
    void file.text()
      .then((text) => onImport(JSON.parse(text)))
      .catch(() => window.alert("That file couldn't be read as a backup."));
  }
  const targetRows = [
    ["Calories", targets.calories == null ? "Not set" : `${formatNumber(targets.calories)} kcal`],
    ["Protein", targets.protein_g == null ? "Not set" : `${formatNumber(targets.protein_g)} g`],
    ["Carbohydrates", targets.carbohydrates_g == null ? "Not set" : `${formatNumber(targets.carbohydrates_g)} g`],
    ["Fat", targets.fat_g == null ? "Not set" : `${formatNumber(targets.fat_g)} g`],
    ["Fiber", targets.fiber_g == null ? "Not set" : `${formatNumber(targets.fiber_g)} g`],
    ["Workouts", targets.workouts_per_week == null ? "Not set" : `${targets.workouts_per_week} / week`],
    ["Water", targets.water_ml == null ? "Not set" : `${formatNumber(targets.water_ml)} ml / day`],
    ["Steps", targets.steps == null ? "Not set" : `${formatNumber(targets.steps)} / day`],
  ];
  return (
    <div className="mx-auto max-w-[850px]">
      <PageIntro eyebrow="PREFERENCES" title="Settings" detail="Choose the targets and units that fit how you track." />
      <section className="rounded-3xl border border-line bg-panel p-4 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><div className="flex items-center gap-2"><Target size={16} className="text-lime" /><h3 className="font-semibold">Daily and weekly targets</h3></div><p className="mt-2 text-xs text-muted">Targets are optional and editable whenever you need.</p></div>
          <button onClick={onEditTargets} className="button-secondary !min-h-9 !px-3">Edit targets</button>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">{targetRows.map(([label, value]) => <div key={label} className="flex items-center justify-between rounded-xl bg-night px-3.5 py-3"><span className="text-xs text-muted">{label}</span><span className="text-xs font-medium">{value}</span></div>)}</div>
      </section>
      <section className="mt-4 rounded-3xl border border-line bg-panel p-4 sm:p-6">
        <div className="flex items-center gap-2"><Settings size={16} className="text-mint" /><h3 className="font-semibold">Display</h3></div>
        <SettingToggle label="Body weight and lifts" value={prefs.unit} options={[["kg", "kg"], ["lb", "lb"]]} onChange={(unit) => setPrefs({ unit })} />
        <div className="mt-2 flex items-center justify-between rounded-xl bg-night px-3.5 py-3"><span className="text-xs text-muted">Food portions</span><span className="text-[11px] text-zinc-300">grams</span></div>
        <SettingToggle label="Appearance" value={prefs.theme} options={[["system", "Auto"], ["dark", "Dark"], ["light", "Light"]]} onChange={(theme: ThemePref) => setPrefs({ theme })} />
        <div className="mt-2 flex items-center justify-between rounded-xl bg-night px-3.5 py-3"><span className="text-xs text-muted">App version</span><span className="text-[11px] tabular-nums text-zinc-300">{__APP_VERSION__}</span></div>
      </section>
      <section className="mt-4 rounded-3xl border border-line bg-panel p-4 sm:p-6">
        <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-lime" /><h3 className="font-semibold">Your data</h3></div>
        <p className="mt-2 max-w-xl text-xs leading-5 text-muted">Everything is stored on this device only. There is no account, cloud sync, or third-party nutrition service. Back up regularly: tap Back up, then choose <b className="font-medium text-zinc-300">Save to Files</b> (iCloud Drive). Deleting the app from your Home Screen deletes its data.</p>
        <div className={`mt-4 flex items-center justify-between rounded-xl px-3.5 py-3 ${age === null || age >= BACKUP_REMIND_DAYS ? "bg-amber-200/5" : "bg-night"}`}>
          <span className="text-xs text-muted">Last backup</span>
          <span className={`text-xs font-medium ${age === null || age >= BACKUP_REMIND_DAYS ? "text-amber-200" : ""}`}>{lastBackup}</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={onBackup} className="button-primary"><Share size={15} /> Back up now</button>
          <label className="button-secondary cursor-pointer"><ArrowUpRight size={15} /> Restore backup<input type="file" accept="application/json,.json" onChange={importData} className="hidden" /></label>
        </div>
      </section>
    </div>
  );
}

function SettingToggle<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-night px-3.5 py-2">
      <span className="text-xs text-muted">{label}</span>
      <div className="flex rounded-lg border border-line bg-panel p-0.5">
        {options.map(([option, text]) => (
          <button key={option} onClick={() => onChange(option)} className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition ${value === option ? "bg-mint text-night" : "text-muted"}`}>{text}</button>
        ))}
      </div>
    </div>
  );
}

function PageIntro({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return (
    // On phones the header already shows the page title, so only the short description and action remain.
    <div className="mb-4 flex items-center justify-between gap-3 sm:mb-7 sm:flex-wrap sm:items-end sm:gap-4">
      <div className="min-w-0"><p className="mb-2 hidden text-[10px] font-bold tracking-[.2em] text-lime sm:block">{eyebrow}</p><h2 className="hidden text-2xl font-semibold tracking-tight sm:block sm:text-3xl">{title}</h2><p className="max-w-xl text-xs leading-5 text-muted sm:mt-2 sm:text-sm sm:leading-6">{detail}</p></div>
      {action}
    </div>
  );
}

function EmptyState({ icon: Icon, title, detail, action, onClick }: { icon: typeof Apple; title: string; detail: string; action?: string; onClick?: () => void }) {
  return (
    <div className="flex min-h-[190px] flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-panel/50 px-5 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-panel-raised text-muted"><Icon size={18} /></div>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-sm text-xs leading-5 text-muted">{detail}</p>
      {action && onClick && <button onClick={onClick} className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-lime hover:text-white"><Plus size={14} /> {action}</button>}
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[9px] text-muted">{label}</p><p className="mt-1 text-xs font-semibold">{value}</p></div>;
}

function Alert({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return <div role="alert" className="mb-5 flex items-start justify-between gap-3 rounded-2xl border border-red-300/20 bg-red-400/5 px-4 py-3 text-xs leading-5 text-red-200"><span>{message}</span>{onDismiss && <button onClick={onDismiss} className="shrink-0 text-red-200/70 hover:text-red-100" aria-label="Dismiss"><X size={14} /></button>}</div>;
}

function Toast({ tone, message, onDismiss, action }: { tone: "ok" | "error"; message: string; onDismiss: () => void; action?: { label: string; onClick: () => void } }) {
  // Auto-hide: confirmations quickly, Undo and errors after giving time to react.
  useEffect(() => {
    const id = window.setTimeout(onDismiss, action || tone === "error" ? 6000 : 2200);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only for a new message
  }, [message, tone]);
  const styles = tone === "ok" ? "border-mint/30 text-mint" : "border-red-300/30 text-red-200";
  return (
    <div role={tone === "ok" ? "status" : "alert"} className={`toast-in pointer-events-auto flex max-w-md items-center gap-2.5 rounded-2xl border bg-panel-raised px-4 py-2.5 text-xs shadow-2xl ${styles}`}>
      {tone === "ok" ? <Check size={14} className="shrink-0" /> : <X size={14} className="shrink-0" />}
      <span className="leading-5">{message}</span>
      {action && <button onClick={() => { onDismiss(); action.onClick(); }} className="ml-1 shrink-0 rounded-lg bg-mint/15 px-2.5 py-1 font-semibold">{action.label}</button>}
      <button onClick={onDismiss} className="ml-1 shrink-0 opacity-60" aria-label="Dismiss"><X size={13} /></button>
    </div>
  );
}

function LoadingState() {
  return <div className="mx-auto flex min-h-[55vh] max-w-[1180px] items-center justify-center"><div className="flex items-center gap-3 text-sm text-muted"><span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-lime" /> Loading your local tracker…</div></div>;
}
