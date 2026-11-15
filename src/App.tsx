import {
  Activity,
  Apple,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Repeat,
  Share,
  Dumbbell,
  Flame,
  Home,
  Leaf,
  Menu,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Utensils,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { api } from "./api";
import type { BackupStatus, DashboardData, Food, Meal, Serving, Targets, Workout } from "./types";

type Page = "dashboard" | "foods" | "workouts" | "settings";
type Modal = "food" | "meal" | "editMeal" | "workout" | "targets" | null;
type WorkoutBody = { name: string; date: string; sets: { exercise_name: string; set_number: number; reps: number; weight_kg: number }[] };

const BACKUP_REMIND_DAYS = 7;

const EMPTY_TARGETS: Targets = {
  calories: null,
  protein_g: null,
  carbohydrates_g: null,
  fat_g: null,
  fiber_g: null,
  workouts_per_week: null,
};

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function dateLabel(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

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

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

const navItems: { key: Page; label: string; icon: typeof Home }[] = [
  { key: "dashboard", label: "Overview", icon: Home },
  { key: "foods", label: "Food library", icon: Apple },
  { key: "workouts", label: "Workouts", icon: Dumbbell },
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(localDate());
  const [recentFoodIds, setRecentFoodIds] = useState<number[]>([]);
  const [backup, setBackup] = useState<BackupStatus>({ last_backup_at: null, has_data: false });
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [editingWorkout, setEditingWorkout] = useState<Workout | null>(null);
  const [workoutTemplate, setWorkoutTemplate] = useState<Workout | null>(null);

  const refresh = useCallback(async () => {
    const [nextDashboard, nextFoods, nextMeals, nextWorkouts, nextRecent, nextBackup] = await Promise.all([
      api.dashboard(selectedDate),
      api.foods(),
      api.meals(selectedDate),
      api.workouts(),
      api.recentFoodIds(),
      api.backupStatus(),
    ]);
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

  async function runAction(action: () => Promise<unknown>, successMessage?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
      setModal(null);
      setEditingFood(null);
      setEditingMeal(null);
      setEditingWorkout(null);
      setWorkoutTemplate(null);
      if (successMessage) setNotice(successMessage);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function openFoodEditor(food: Food | null = null) {
    setError("");
    setEditingFood(food);
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
  }

  const dayLabel = dayName(selectedDate);

  const pageHeading = navItems.find((item) => item.key === page)?.label ?? "Overview";

  return (
    <div className="min-h-screen bg-night text-white">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="hidden w-[248px] shrink-0 border-r border-line/80 px-5 py-7 lg:flex lg:flex-col">
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

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-line/70 bg-night/90 px-4 backdrop-blur-xl sm:px-7 lg:px-10">
            <div className="flex items-center gap-3">
              <button
                className="rounded-xl border border-line p-2 text-muted lg:hidden"
                onClick={() => setMobileMenuOpen((open) => !open)}
                aria-label="Toggle menu"
              >
                <Menu size={18} />
              </button>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-muted">Fitness tracker</p>
                <h1 className="mt-0.5 text-sm font-semibold text-white sm:text-base">{pageHeading}</h1>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="hidden items-center gap-2 rounded-full border border-line bg-panel px-3 py-2 text-xs text-muted sm:flex">
                <CalendarDays size={13} className="text-lime" /> {dateLabel(selectedDate)}
              </div>
              <button onClick={() => openModal("meal")} className="button-primary !min-h-10 !px-3 sm:!px-4">
                <Plus size={16} /><span className="hidden sm:inline">Log food</span><span className="sm:hidden">Log</span>
              </button>
            </div>
          </header>

          {mobileMenuOpen && (
            <div className="absolute left-0 right-0 top-[72px] z-40 border-b border-line bg-panel p-3 lg:hidden">
              <Navigation page={page} onSelect={(next) => { setPage(next); setMobileMenuOpen(false); }} />
            </div>
          )}

          <main className="flex-1 px-4 pb-28 pt-6 sm:px-7 sm:pt-8 lg:px-10 lg:pb-10">
            {error && <Alert message={error} onDismiss={() => setError("")} />}
            {notice && <Notice message={notice} onDismiss={() => setNotice("")} />}
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
                onLogMeal={() => openModal("meal")}
                onLogWorkout={() => openWorkoutEditor()}
                onEditWorkout={(workout) => openWorkoutEditor({ edit: workout })}
                onSetTargets={() => openModal("targets")}
                onNavigate={setPage}
                onEditMeal={openMealEditor}
                onDeleteMeal={(meal) => runAction(() => api.deleteMeal(meal.id), "Meal entry removed.")}
              />
            ) : page === "foods" ? (
              <FoodLibrary
                foods={foods}
                onAdd={() => openFoodEditor()}
                onEdit={openFoodEditor}
                onDelete={(food) => {
                  if (window.confirm(`Delete "${food.name}" from your food library?`)) {
                    void runAction(() => api.deleteFood(food.id), "Food deleted.");
                  }
                }}
              />
            ) : page === "workouts" ? (
              <WorkoutsPage
                workouts={workouts}
                onAdd={() => openWorkoutEditor()}
                onEdit={(workout) => openWorkoutEditor({ edit: workout })}
                onRepeat={(workout) => openWorkoutEditor({ template: workout })}
                onDelete={(workout) => {
                  if (window.confirm(`Delete "${workout.name}" and its sets?`)) {
                    void runAction(() => api.deleteWorkout(workout.id), "Workout deleted.");
                  }
                }}
              />
            ) : (
              <SettingsPage
                targets={dashboard?.targets ?? EMPTY_TARGETS}
                onEditTargets={() => openModal("targets")}
                backup={backup}
                onBackup={() => void runBackup()}
                onImport={(backup) => runAction(() => api.importData(backup), "Backup restored.")}
              />
            )}
          </main>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-lg justify-around">
          {navItems.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setPage(key)} className={`flex min-w-[68px] flex-col items-center gap-1 rounded-xl px-2 py-1.5 ${page === key ? "text-lime" : "text-muted"}`}>
              <Icon size={19} strokeWidth={page === key ? 2.3 : 1.7} />
              <span className="text-[10px] font-medium">{label === "Overview" ? "Home" : label === "Food library" ? "Food" : label}</span>
            </button>
          ))}
        </div>
      </nav>

      {modal === "food" && (
        <ModalShell title={editingFood ? "Edit food" : "Add a food"} eyebrow="FOOD LIBRARY" onClose={closeModal}>
          <FoodForm
            key={editingFood?.id ?? "new"}
            initialFood={editingFood}
            busy={busy}
            error={error}
            onSubmit={(body) => runAction(
              () => editingFood ? api.updateFood(editingFood.id, body) : api.createFood(body),
              editingFood ? "Food details updated." : "Food added to your library.",
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
            onDelete={() => runAction(() => api.deleteMeal(editingMeal.id), "Meal entry removed.")}
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
      {modal === "targets" && (
        <ModalShell title="Set your targets" eyebrow="YOUR SETTINGS" onClose={closeModal}>
          <TargetsForm
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
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
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

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-3xl border border-line bg-panel p-5 sm:p-6">
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

        <section className="rounded-3xl border border-line bg-panel p-5 sm:p-6">
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

      <section className="mt-4 rounded-3xl border border-line bg-panel p-5 sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <div><h3 className="font-semibold">Nutrition breakdown</h3><p className="mt-1 text-xs text-muted">Logged food compared with your personal targets</p></div>
          <button onClick={onSetTargets} className="text-xs font-medium text-lime hover:text-white">{Object.values(data.targets).every((value) => value === null) ? "Set targets" : "Edit targets"}</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
        <p className="mt-4 flex items-start gap-2 text-[10px] leading-4 text-muted"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-mint" /> Nutrition totals are calculated from the values you entered in your food library. They are not independently verified.</p>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-3xl border border-line bg-panel p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between">
            <div><h3 className="font-semibold">This week</h3><p className="mt-1 text-xs text-muted">Food and training at a glance</p></div>
            <BarChart3 size={17} className="text-muted" />
          </div>
          <div className="h-[230px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.weekly.days} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#2C3530" strokeDasharray="3 5" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#87938C", fontSize: 11 }} dy={9} />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,.025)" }}
                  contentStyle={{ background: "#202824", border: "1px solid #35413A", borderRadius: 12, color: "#F5F7F2", fontSize: 12 }}
                  formatter={(value, name) => [String(name) === "calories" ? `${formatNumber(Number(value))} kcal` : `${value} sessions`, String(name) === "calories" ? "Food" : "Workouts"]}
                  labelStyle={{ color: "#B7C0BA", marginBottom: 4 }}
                />
                <Bar dataKey="calories" fill="#C4F36A" radius={[5, 5, 0, 0]} maxBarSize={23} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-muted"><span className="h-2 w-2 rounded-sm bg-lime" />Calories logged per day <span className="ml-auto">{data.weekly.days.reduce((sum, day) => sum + day.workouts, 0)} workout sessions</span></div>
        </section>

        <section className="rounded-3xl border border-line bg-panel p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div><h3 className="font-semibold">{isToday ? "Today's" : `${day}'s`} training</h3><p className="mt-1 text-xs text-muted">Tap a session to edit it</p></div>
            <button onClick={onLogWorkout} className="rounded-lg border border-line p-2 text-muted transition hover:border-mint/50 hover:text-mint" aria-label="Log a workout"><Plus size={16} /></button>
          </div>
          {data.workouts_today.length === 0 ? (
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
            </div>
          )}
          <button onClick={() => onNavigate("workouts")} className="mt-4 flex w-full items-center justify-between border-t border-line pt-4 text-xs text-muted transition hover:text-white">
            <span>View workout history</span><ChevronRight size={14} />
          </button>
        </section>
      </div>

      <section className="mt-4 rounded-3xl border border-line bg-panel p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <div><h3 className="font-semibold">{isToday ? "Today's" : `${day}'s`} food</h3><p className="mt-1 text-xs text-muted">Tap an entry to change its portion</p></div>
          <button onClick={onLogMeal} className="button-secondary !min-h-9 !px-3"><Plus size={14} /> Add meal</button>
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
    <div className="flex items-center gap-1 py-2 first:pt-0 last:pb-0">
      <button onClick={onEdit} disabled={!onEdit} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1.5 text-left transition hover:bg-panel-raised/40" aria-label={`Edit ${meal.food_name}`}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-200/10 text-amber-200"><Leaf size={16} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium">{meal.food_name}</p><span className="rounded-full bg-panel-raised px-2 py-0.5 text-[9px] capitalize text-muted">{meal.preparation}</span></div>
          <p className="mt-1 text-[10px] capitalize text-muted">{meal.meal_type} · {formatNumber(meal.portion_g)} g · {formatNumber(meal.protein_g)} g protein</p>
        </div>
        <div className="text-right"><p className="text-sm font-semibold">{formatNumber(meal.calories)}</p><p className="text-[9px] text-muted">kcal</p></div>
      </button>
      {onDelete && <button onClick={onDelete} className="rounded-lg p-2 text-muted transition hover:bg-red-400/10 hover:text-red-300" aria-label={`Remove ${meal.food_name}`}><Trash2 size={14} /></button>}
    </div>
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

function FoodLibrary({ foods, onAdd, onEdit, onDelete }: { foods: Food[]; onAdd: () => void; onEdit: (food: Food) => void; onDelete: (food: Food) => void }) {
  const [search, setSearch] = useState("");
  const visibleFoods = useMemo(() => foods.filter((food) => `${food.name} ${food.brand ?? ""}`.toLowerCase().includes(search.toLowerCase())), [foods, search]);
  return (
    <div className="mx-auto max-w-[1050px]">
      <PageIntro eyebrow="YOUR FOODS" title="Food library" detail="Keep nutrition values you enter, with preparation state and portions clearly separated." action={<button onClick={onAdd} className="button-primary"><Plus size={16} /> Add food</button>} />
      <div className="mb-5 flex items-center gap-3 rounded-2xl border border-line bg-panel px-4">
        <Search size={16} className="shrink-0 text-muted" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted" placeholder="Search foods or brands" />
        <span className="shrink-0 text-[10px] text-muted">{visibleFoods.length} foods</span>
      </div>
      {visibleFoods.length === 0 ? (
        <EmptyState icon={Apple} title={foods.length ? "No matching foods" : "Your library starts here"} detail={foods.length ? "Try a different search term." : "No pre-filled nutrition data. Add food details using a label or source you trust."} action={foods.length ? undefined : "Add a food"} onClick={onAdd} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {visibleFoods.map((food) => (
            <article key={food.id} className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
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
                <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-[10px] text-muted">
                  <span><b className="font-medium text-white">{formatNumber(food.protein_g_per_100g)}g</b> protein</span>
                  <span><b className="font-medium text-white">{formatNumber(food.carbohydrates_g_per_100g)}g</b> carbs</span>
                  <span><b className="font-medium text-white">{formatNumber(food.fat_g_per_100g)}g</b> fat</span>
                  <span><b className="font-medium text-white">{formatNumber(food.fiber_g_per_100g)}g</b> fiber</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[9px] text-muted"><span className="rounded-full bg-panel-raised px-2 py-1 capitalize">{food.preparation}</span>{food.servings.map((serving) => <span key={serving.label} className="rounded-full bg-lime/10 px-2 py-1 text-lime">{serving.label} · {formatNumber(serving.grams)} g</span>)}<span>Manually entered · not independently verified</span></div>
              {food.notes && <p className="mt-2 text-[10px] leading-4 text-muted">{food.notes}</p>}
            </article>
          ))}
        </div>
      )}
      <p className="mt-6 flex items-start gap-2 text-[10px] leading-4 text-muted"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-mint" /> Nutrition is calculated from your own entries. Values are not validated against a nutrition database.</p>
    </div>
  );
}

type FoodBody = Omit<Food, "id" | "source" | "is_verified">;

function FoodForm({ initialFood, busy, error, onSubmit }: { initialFood: Food | null; busy: boolean; error: string; onSubmit: (body: FoodBody) => void }) {
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
  });
  const [servings, setServings] = useState((initialFood?.servings ?? []).map((serving) => ({ label: serving.label, grams: String(serving.grams) })));
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
      servings: filledServings.map((serving) => ({ label: serving.label.trim(), grams: Number(serving.grams) })),
    });
  }
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const updateServing = (index: number, key: "label" | "grams", value: string) =>
    setServings((current) => current.map((serving, i) => (i === index ? { ...serving, [key]: value } : serving)));
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="rounded-xl border border-amber-200/10 bg-amber-200/5 p-3 text-[11px] leading-5 text-muted">Use the nutrition values from your own label or source. These values will be marked as user-entered, not verified.</p>
      <div className="grid gap-3 sm:grid-cols-2">
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

function PortionPicker({ grams, onChange, servings }: { grams: string; onChange: (grams: string) => void; servings: Serving[] }) {
  const chips = [
    ...servings.map((serving) => ({ key: `s-${serving.label}`, label: `${serving.label} · ${formatNumber(serving.grams)} g`, grams: serving.grams, saved: true })),
    ...[50, 100, 150, 200].map((value) => ({ key: `g-${value}`, label: `${value} g`, grams: value, saved: false })),
  ];
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <button key={chip.key} type="button" onClick={() => onChange(String(chip.grams))} className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${Number(grams) === chip.grams ? "border-lime bg-lime/10 text-lime" : chip.saved ? "border-lime/30 text-zinc-200" : "border-line text-muted hover:text-white"}`}>
            {chip.label}
          </button>
        ))}
      </div>
      <div className="relative">
        <input type="number" inputMode="decimal" min="0.1" max="10000" step="any" value={grams} onChange={(e) => onChange(e.target.value)} className="input-dark pr-10" aria-label="Portion in grams" />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">g</span>
      </div>
    </div>
  );
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

function MealForm({ foods, recentFoodIds, busy, error, date, dayLabel, onAddFood, onSubmit }: { foods: Food[]; recentFoodIds: number[]; busy: boolean; error: string; date: string; dayLabel: string; onAddFood: () => void; onSubmit: (body: { food_id: number; date: string; meal_type: string; portion_g: number }) => void }) {
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

  if (foods.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-night p-4 text-center">
        <Apple className="mx-auto text-lime" size={22} />
        <p className="mt-3 text-sm font-medium">Your food library is empty</p>
        <p className="mt-1 text-xs text-muted">Create a food entry with nutrition values you trust.</p>
        <button type="button" className="button-secondary mt-4" onClick={onAddFood}><Plus size={14} /> Add a food</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center gap-2 rounded-xl border border-line bg-night px-3">
        <Search size={15} className="shrink-0 text-muted" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your foods" className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted" aria-label="Search foods" />
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
            No foods match "{search}".
            <button type="button" onClick={onAddFood} className="ml-1 font-semibold text-lime">Add it</button>
          </div>
        ) : (
          <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">{matches.map((food) => <FoodChoice key={food.id} food={food} selected={food.id === foodId} onSelect={() => choose(food)} />)}</div>
        )}
      </div>

      {selectedFood && (
        <>
          <Field label="Meal"><MealTypePicker value={mealType} onChange={setMealType} /></Field>
          <Field label="Portion"><PortionPicker grams={portion} onChange={setPortion} servings={selectedFood.servings} /></Field>
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

type SetDraft = { exercise_name: string; reps: string; weight_kg: string };

const toDrafts = (workout: Workout): SetDraft[] =>
  workout.sets.map((set) => ({ exercise_name: set.exercise_name, reps: String(set.reps), weight_kg: String(set.weight_kg) }));

function WorkoutForm({ initial, isEdit, history, busy, error, date, onSubmit }: { initial: Workout | null; isEdit: boolean; history: Workout[]; busy: boolean; error: string; date: string; onSubmit: (body: WorkoutBody) => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [sets, setSets] = useState<SetDraft[]>(initial ? toDrafts(initial) : [{ exercise_name: "", reps: "", weight_kg: "" }]);
  const [validation, setValidation] = useState("");

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
    if (sets.some((set) => !set.exercise_name.trim() || !Number.isInteger(Number(set.reps)) || Number(set.reps) < 1 || set.weight_kg.trim() === "" || !Number.isFinite(Number(set.weight_kg)) || Number(set.weight_kg) < 0)) {
      setValidation("Each set needs an exercise, reps, and a non-negative weight. Use 0 kg for bodyweight sets.");
      return;
    }
    const counts: Record<string, number> = {};
    const normalized = sets.map((set) => {
      const exercise_name = set.exercise_name.trim();
      counts[exercise_name] = (counts[exercise_name] ?? 0) + 1;
      return { exercise_name, set_number: counts[exercise_name], reps: Number(set.reps), weight_kg: Number(set.weight_kg) };
    });
    setValidation("");
    onSubmit({ name: name.trim(), date, sets: normalized });
  }
  function updateSet(index: number, key: keyof SetDraft, value: string) {
    setSets((current) => current.map((set, i) => (i === index ? { ...set, [key]: value } : set)));
  }
  function addSet() {
    // Copy the previous set so the next one is usually just one tap away.
    setSets((current) => {
      const last = current[current.length - 1];
      return [...current, last ? { ...last } : { exercise_name: "", reps: "", weight_kg: "" }];
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {!initial && recentWorkouts.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted"><Repeat size={12} /> Repeat a previous workout</p>
          <div className="flex flex-wrap gap-1.5">
            {recentWorkouts.map((workout) => (
              <button key={workout.id} type="button" onClick={() => { setName(workout.name); setSets(toDrafts(workout)); }} className="rounded-full border border-mint/30 px-3 py-1.5 text-[11px] font-medium text-mint transition hover:bg-mint/10">
                {workout.name} <span className="text-muted">· {dateLabel(workout.date)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <Field label="Workout name"><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Upper body" className="input-dark" /></Field>
      <div>
        <div className="mb-2 flex items-center justify-between"><p className="text-xs font-medium text-zinc-300">Sets</p><span className="text-[10px] text-muted">Weight in kg</span></div>
        <datalist id="exercise-names">{exerciseNames.map((exercise) => <option key={exercise} value={exercise} />)}</datalist>
        <div className="space-y-2">
          {sets.map((set, index) => {
            // Show "last time" once, above the first set of each exercise.
            const startsExercise = index === 0 || set.exercise_name.trim().toLowerCase() !== sets[index - 1].exercise_name.trim().toLowerCase();
            const previous = startsExercise ? lastTime(set.exercise_name) : null;
            return (
              <div key={index}>
                {previous && (
                  <p className="mb-1 rounded-lg bg-mint/5 px-2.5 py-1.5 text-[10px] text-mint">
                    Last time ({dateLabel(previous.date)}): {previous.sets.map((item) => `${item.reps} × ${formatNumber(item.weight_kg)} kg`).join(" · ")}
                  </p>
                )}
                <div className="grid grid-cols-[minmax(0,1fr)_60px_72px_30px] items-end gap-2">
                  <Field label={index === 0 ? "Exercise" : " "}><input value={set.exercise_name} list="exercise-names" onChange={(e) => updateSet(index, "exercise_name", e.target.value)} placeholder="Exercise name" className="input-dark !px-2.5" /></Field>
                  <Field label={index === 0 ? "Reps" : " "}><input type="number" inputMode="numeric" min="1" value={set.reps} onChange={(e) => updateSet(index, "reps", e.target.value)} placeholder="0" className="input-dark !px-2 text-center" /></Field>
                  <Field label={index === 0 ? "Weight" : " "}><input type="number" inputMode="decimal" min="0" step="any" value={set.weight_kg} onChange={(e) => updateSet(index, "weight_kg", e.target.value)} placeholder="0" className="input-dark !px-2 text-center" /></Field>
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
    </form>
  );
}

function TargetsForm({ targets, busy, error, onSubmit }: { targets: Targets; busy: boolean; error: string; onSubmit: (body: Targets) => void }) {
  const [form, setForm] = useState({
    calories: targets.calories == null ? "" : String(targets.calories),
    protein_g: targets.protein_g == null ? "" : String(targets.protein_g),
    carbohydrates_g: targets.carbohydrates_g == null ? "" : String(targets.carbohydrates_g),
    fat_g: targets.fat_g == null ? "" : String(targets.fat_g),
    fiber_g: targets.fiber_g == null ? "" : String(targets.fiber_g),
    workouts_per_week: targets.workouts_per_week == null ? "" : String(targets.workouts_per_week),
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
    });
  }
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="rounded-xl border border-line bg-night p-3 text-[11px] leading-5 text-muted">Targets are optional and personal. Leave any field blank if you don't use that target.</p>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Calories · kcal" value={form.calories} onChange={(v) => update("calories", v)} />
        <NumberField label="Protein · g" value={form.protein_g} onChange={(v) => update("protein_g", v)} />
        <NumberField label="Carbohydrates · g" value={form.carbohydrates_g} onChange={(v) => update("carbohydrates_g", v)} />
        <NumberField label="Fat · g" value={form.fat_g} onChange={(v) => update("fat_g", v)} />
        <NumberField label="Fiber · g" value={form.fiber_g} onChange={(v) => update("fiber_g", v)} />
        <NumberField label="Workouts · / week" value={form.workouts_per_week} onChange={(v) => update("workouts_per_week", v)} />
      </div>
      {(validation || error) && <FormError message={validation || error} />}
      <button disabled={busy} className="button-primary w-full disabled:opacity-60">{busy ? "Saving…" : "Save targets"}</button>
    </form>
  );
}

function WorkoutsPage({ workouts, onAdd, onEdit, onRepeat, onDelete }: { workouts: Workout[]; onAdd: () => void; onEdit: (workout: Workout) => void; onRepeat: (workout: Workout) => void; onDelete: (workout: Workout) => void }) {
  const personalRecords = useMemo(() => {
    const records = new Map<string, number>();
    workouts.forEach((workout) => workout.sets.forEach((set) => records.set(set.exercise_name, Math.max(records.get(set.exercise_name) ?? 0, set.weight_kg))));
    return [...records.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [workouts]);
  return (
    <div className="mx-auto max-w-[1050px]">
      <PageIntro eyebrow="TRAINING JOURNAL" title="Workouts" detail="Record completed sets in kilograms. Repeat a past session to start from last time's numbers." action={<button onClick={onAdd} className="button-primary"><Plus size={16} /> Log workout</button>} />
      {personalRecords.length > 0 && (
        <section className="mb-5 rounded-3xl border border-line bg-panel p-5">
          <div className="mb-4 flex items-center gap-2"><Target size={15} className="text-lime" /><h3 className="text-sm font-semibold">Top recorded weights</h3><span className="text-[10px] text-muted">from your logged sets</span></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{personalRecords.map(([exercise, weight]) => <div key={exercise} className="rounded-xl bg-night p-3"><p className="truncate text-xs font-medium">{exercise}</p><p className="mt-2 text-lg font-semibold">{formatNumber(weight)} <span className="text-[10px] font-normal text-muted">kg</span></p></div>)}</div>
        </section>
      )}
      {workouts.length === 0 ? <EmptyState icon={Dumbbell} title="Your training log is ready" detail="Add a workout with exercises, reps, and weights to start building your history." action="Log a workout" onClick={onAdd} /> : (
        <div className="space-y-3">
          {workouts.map((workout) => <WorkoutCard key={workout.id} workout={workout} onEdit={() => onEdit(workout)} onRepeat={() => onRepeat(workout)} onDelete={() => onDelete(workout)} />)}
        </div>
      )}
    </div>
  );
}

function WorkoutCard({ workout, onEdit, onRepeat, onDelete }: { workout: Workout; onEdit: () => void; onRepeat: () => void; onDelete: () => void }) {
  const grouped = useMemo(() => {
    const map = new Map<string, typeof workout.sets>();
    workout.sets.forEach((set) => map.set(set.exercise_name, [...(map.get(set.exercise_name) ?? []), set]));
    return [...map.entries()];
  }, [workout.sets]);
  return (
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
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {grouped.map(([exercise, sets]) => (
          <div key={exercise} className="rounded-xl bg-night px-3 py-2.5">
            <p className="text-xs font-medium">{exercise}</p>
            <p className="mt-1 text-[10px] text-muted">{sets.map((set) => `${set.reps} × ${formatNumber(set.weight_kg)} kg`).join("  ·  ")}</p>
          </div>
        ))}
      </div>
      {workout.notes && <p className="mt-3 text-xs text-muted">{workout.notes}</p>}
    </article>
  );
}

function SettingsPage({ targets, onEditTargets, backup, onBackup, onImport }: { targets: Targets; onEditTargets: () => void; backup: BackupStatus; onBackup: () => void; onImport: (backup: unknown) => void }) {
  const age = backup.last_backup_at === null ? null : daysSince(backup.last_backup_at);
  const lastBackup = age === null ? "Never" : age === 0 ? "Today" : age === 1 ? "Yesterday" : `${age} days ago`;
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
  ];
  return (
    <div className="mx-auto max-w-[850px]">
      <PageIntro eyebrow="PREFERENCES" title="Settings" detail="Choose the targets and units that fit how you track." />
      <section className="rounded-3xl border border-line bg-panel p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><div className="flex items-center gap-2"><Target size={16} className="text-lime" /><h3 className="font-semibold">Daily and weekly targets</h3></div><p className="mt-2 text-xs text-muted">Targets are optional and editable whenever you need.</p></div>
          <button onClick={onEditTargets} className="button-secondary !min-h-9 !px-3">Edit targets</button>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">{targetRows.map(([label, value]) => <div key={label} className="flex items-center justify-between rounded-xl bg-night px-3.5 py-3"><span className="text-xs text-muted">{label}</span><span className="text-xs font-medium">{value}</span></div>)}</div>
      </section>
      <section className="mt-4 rounded-3xl border border-line bg-panel p-5 sm:p-6">
        <div className="flex items-center gap-2"><Settings size={16} className="text-mint" /><h3 className="font-semibold">Units</h3></div>
        <div className="mt-4 flex items-center justify-between rounded-xl bg-night px-3.5 py-3"><span className="text-xs text-muted">Weight and food portions</span><span className="rounded-full bg-mint/10 px-2.5 py-1 text-[10px] font-semibold text-mint">Metric · kg / g</span></div>
      </section>
      <section className="mt-4 rounded-3xl border border-line bg-panel p-5 sm:p-6">
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

function PageIntro({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div><p className="mb-2 text-[10px] font-bold tracking-[.2em] text-lime">{eyebrow}</p><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-muted">{detail}</p></div>
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

function ModalShell({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="max-h-[94dvh] w-full overflow-y-auto rounded-t-3xl border border-line bg-panel p-5 shadow-2xl sm:max-w-[540px] sm:rounded-3xl sm:p-6">
        <div className="mb-5 flex items-start justify-between">
          <div><p className="text-[9px] font-bold tracking-[.2em] text-lime">{eyebrow}</p><h2 className="mt-1.5 text-xl font-semibold">{title}</h2></div>
          <button onClick={onClose} className="rounded-xl border border-line p-2 text-muted transition hover:bg-panel-raised hover:text-white" aria-label="Close"><X size={16} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-medium text-zinc-300">{label}{required && <span className="ml-1 text-red-300">*</span>}</span>{children}</label>;
}

function NumberField({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <Field label={label} required={required}><input type="number" min="0" step="any" required={required} value={value} onChange={(event) => onChange(event.target.value)} placeholder={required ? "Required" : "Not set"} className="input-dark" /></Field>;
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[9px] text-muted">{label}</p><p className="mt-1 text-xs font-semibold">{value}</p></div>;
}

function FormError({ message }: { message: string }) {
  return <p role="alert" className="rounded-xl border border-red-300/15 bg-red-300/5 px-3 py-2 text-[11px] leading-5 text-red-200">{message}</p>;
}

function Alert({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return <div role="alert" className="mb-5 flex items-start justify-between gap-3 rounded-2xl border border-red-300/20 bg-red-400/5 px-4 py-3 text-xs leading-5 text-red-200"><span>{message}</span>{onDismiss && <button onClick={onDismiss} className="shrink-0 text-red-200/70 hover:text-red-100" aria-label="Dismiss"><X size={14} /></button>}</div>;
}

function Notice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return <div role="status" className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-mint/20 bg-mint/5 px-4 py-3 text-xs text-mint"><span className="flex items-center gap-2"><Check size={14} />{message}</span><button onClick={onDismiss} aria-label="Dismiss"><X size={14} /></button></div>;
}

function LoadingState() {
  return <div className="mx-auto flex min-h-[55vh] max-w-[1180px] items-center justify-center"><div className="flex items-center gap-3 text-sm text-muted"><span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-lime" /> Loading your local tracker…</div></div>;
}
