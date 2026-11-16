// "Type it" meal logging: free on-device parsing, with optional AI (Claude Haiku 5.5) for photos and
// dishes the database doesn't know. Every line is reviewed before anything is saved.
import { Camera, ChevronDown, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { estimateMealFromPhoto, estimateMealFromText, friendlyError, photoToJpegBase64 } from "./ai";
import type { AiFoodItem, AiReference } from "./ai";
import { loadFoodDb } from "./foodDb";
import type { DbFood } from "./foodDb";
import { choiceName, choiceServings, gramsFor, nutritionFor, parseItem, quickLog } from "./quickLog";
import type { Choice, QuickLine } from "./quickLog";
import type { Food } from "./types";
import { AmountInput, FormError } from "./ui";
import { formatNumber } from "./utils";

export type SmartLogEntry = { choice: Choice; grams: number };

const PHOTO_LINE = "From photo";
const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];

function aiChoice(item: AiFoodItem): Choice {
  return { kind: "ai", name: item.name, grams: item.grams, kcal: item.kcal, protein: item.protein_g, carbs: item.carbs_g, fat: item.fat_g, fiber: item.fiber_g, note: item.note, confidence: item.confidence };
}
const aiLine = (item: AiFoodItem, text: string): QuickLine => ({ text, qty: 1, unit: null, choice: aiChoice(item), alternatives: [], grams: String(Math.round(item.grams)), estimatedAmount: false, note: "", partial: null });

function sourceLabel(choice: Choice) {
  if (choice.kind === "library") return { text: "Your food", tone: "text-lime" };
  if (choice.kind === "db") return { text: "USDA", tone: "text-sky-300" };
  return { text: `AI estimate · ${choice.confidence} confidence`, tone: "text-amber-300" };
}

export function SmartLog({ foods, aiReady, busy, error, defaultMealType, dayLabel, onSave, onSetUpAi }: {
  foods: Food[];
  aiReady: boolean;
  busy: boolean;
  error: string;
  defaultMealType: string;
  dayLabel: string;
  onSave: (entries: SmartLogEntry[], mealType: string) => void;
  onSetUpAi: () => void;
}) {
  const [text, setText] = useState("");
  const [lines, setLines] = useState<QuickLine[]>([]);
  const [db, setDb] = useState<DbFood[] | null>(null);
  const [mealType, setMealType] = useState(defaultMealType);
  const [aiBusy, setAiBusy] = useState<"text" | "photo" | null>(null);
  const [aiError, setAiError] = useState("");
  const [openPicker, setOpenPicker] = useState<number | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  // The database loads in the background; matching works with your own foods meanwhile.
  useEffect(() => { void loadFoodDb().then(setDb).catch(() => setDb([])); }, []);
  // The text whose unknown items the AI has already estimated (those lines are then hidden).
  const [aiCoveredText, setAiCoveredText] = useState<string | null>(null);
  // Re-read the text a moment after typing stops. AI lines (from text or photos) are kept.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setLines((current) => {
        const parsed = text.trim() ? quickLog(text, foods, db) : [];
        // Photo estimates stay; estimates made from the text only while that text is unchanged.
        const ai = current.filter((line) => line.choice?.kind === "ai" && (line.text === PHOTO_LINE || aiCoveredText === text));
        return [...(aiCoveredText === text ? parsed.filter((line) => line.choice) : parsed), ...ai];
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [text, foods, db, aiCoveredText]);

  const unmatched = lines.filter((line) => !line.choice);
  const ready = lines.filter((line) => line.choice && Number(line.grams) > 0);
  const totals = ready.reduce((sum, line) => {
    const n = nutritionFor(line.choice!, Number(line.grams));
    return { kcal: sum.kcal + n.kcal, protein: sum.protein + n.protein };
  }, { kcal: 0, protein: 0 });

  function update(index: number, change: Partial<QuickLine>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...change } : line)));
  }
  function pick(index: number, choice: Choice) {
    const line = lines[index];
    const amount = gramsFor(choice, line.qty, line.unit);
    const withBone = parseItem(line.text).withBone && choice.kind !== "ai";
    const grams = amount.grams === null ? null : withBone ? Math.round(amount.grams * 0.7) : amount.grams;
    update(index, { choice, grams: grams === null ? "" : String(grams), estimatedAmount: amount.estimated || withBone, partial: null, note: withBone ? "Weight includes bone: counted 70% as meat." : "" });
    setOpenPicker(null);
  }

  async function estimateUnmatched() {
    setAiBusy("text");
    setAiError("");
    try {
      // Give the AI the closest database/library foods as anchors (e.g. cooked chicken for "chicken curry").
      const references: AiReference[] = [];
      for (const line of unmatched) {
        for (const alternative of line.alternatives.slice(0, 2)) {
          const n = nutritionFor(alternative, 100);
          if (!references.some((r) => r.name === choiceName(alternative))) {
            references.push({ name: choiceName(alternative), kcal: n.kcal, protein: Math.round(n.protein * 10) / 10, carbs: Math.round(n.carbs * 10) / 10, fat: Math.round(n.fat * 10) / 10 });
          }
        }
      }
      const items = await estimateMealFromText(unmatched.map((line) => line.text).join(", "), references.slice(0, 6));
      // Replace the lines the free matcher couldn't place with the AI's estimates.
      setAiCoveredText(text);
      setLines((current) => [...current.filter((line) => line.choice), ...items.map((item) => aiLine(item, item.name))]);
    } catch (cause) {
      setAiError(await friendlyError(cause));
    } finally {
      setAiBusy(null);
    }
  }

  async function estimatePhoto(file: File) {
    setAiBusy("photo");
    setAiError("");
    try {
      const items = await estimateMealFromPhoto(await photoToJpegBase64(file), text);
      setLines((current) => [...current, ...items.map((item) => aiLine(item, PHOTO_LINE))]);
    } catch (cause) {
      setAiError(await friendlyError(cause));
    } finally {
      setAiBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="What did you eat? e.g. 2 roti, 1 bowl dal, chai"
        className="input-dark resize-none py-2.5 leading-5"
        aria-label="What you ate"
      />
      <div className="flex flex-wrap items-center gap-2">
        {aiReady ? (
          <>
            <button type="button" disabled={aiBusy !== null} onClick={() => photoInput.current?.click()} className="button-secondary !min-h-9 !px-3">
              {aiBusy === "photo" ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />} Photo
            </button>
            <input ref={photoInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void estimatePhoto(file); }} />
            <span className="text-[10px] text-muted">AI photo estimate (Claude Haiku)</span>
          </>
        ) : (
          <button type="button" onClick={onSetUpAi} className="text-[11px] text-muted"><Sparkles size={12} className="-mt-0.5 mr-1 inline text-amber-300" />Set up AI for meal photos and dishes not in the database</button>
        )}
      </div>
      {!text.trim() && !lines.length && <p className="text-[11px] leading-5 text-muted">Separate items with commas. Amounts like "2", "half", "1 cup", "200g" or "1 bowl" work. Matching happens on your phone, free and offline.</p>}

      {lines.map((line, index) => (
        <div key={`${index}-${line.text}`} className="rounded-2xl border border-line bg-night p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10px] text-muted">"{line.text}"</p>
            <button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="-mr-1 -mt-1 rounded-lg p-1 text-muted" aria-label="Remove line"><X size={13} /></button>
          </div>
          {line.choice ? (
            <>
              <button type="button" onClick={() => setOpenPicker(openPicker === index ? null : index)} disabled={!line.alternatives.length} className="mt-1 flex w-full items-start justify-between gap-2 text-left">
                <span className="min-w-0">
                  <span className="line-clamp-2 text-sm font-medium leading-5">{choiceName(line.choice)}</span>
                  <span className={`text-[10px] ${sourceLabel(line.choice).tone}`}>{sourceLabel(line.choice).text}</span>
                </span>
                {line.alternatives.length > 1 && <ChevronDown size={16} className="mt-0.5 shrink-0 text-muted" />}
              </button>
              {openPicker === index && (
                <div className="mt-2 space-y-1">
                  {line.alternatives.map((alternative) => (
                    <button key={choiceName(alternative)} type="button" onClick={() => pick(index, alternative)} className="block w-full rounded-lg border border-line/70 px-2.5 py-2 text-left text-[12px] leading-4">
                      {choiceName(alternative)} <span className={`text-[10px] ${sourceLabel(alternative).tone}`}>· {sourceLabel(alternative).text}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-2">
                <AmountInput key={choiceName(line.choice)} grams={line.grams} servings={choiceServings(line.choice)} onChange={(grams) => update(index, { grams, estimatedAmount: false })} label={`Amount of ${choiceName(line.choice)}`} preferGrams={["g", "kg", "ml", "l"].includes(line.unit ?? "") || line.note !== ""} />
              </div>
              <p className="mt-1.5 flex flex-wrap justify-between gap-x-2 text-[11px] text-muted">
                {Number(line.grams) > 0 && (() => { const n = nutritionFor(line.choice!, Number(line.grams)); return <span><b className="text-white">{formatNumber(Math.round(n.kcal))} kcal</b> · {formatNumber(n.protein)} g protein</span>; })()}
                {line.estimatedAmount && <span className="text-amber-300">Amount guessed, please check</span>}
              </p>
              {line.choice.kind === "ai" && line.choice.note && <p className="mt-1 text-[10px] leading-4 text-muted">{line.choice.note}</p>}
              {line.note && <p className="mt-1 text-[10px] leading-4 text-muted">{line.note}</p>}
            </>
          ) : (
            <>
              <p className="mt-1 text-xs text-amber-300">{line.partial ? `No exact match: nothing found with "${line.partial}".` : "Not found in your foods or the database."}</p>
              {line.alternatives.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] text-muted">Near matches{line.partial ? ` (without "${line.partial}")` : ""}:</p>
                  {line.alternatives.slice(0, 3).map((alternative) => (
                    <button key={choiceName(alternative)} type="button" onClick={() => pick(index, alternative)} className="block w-full rounded-lg border border-line/70 px-2.5 py-2 text-left text-[12px] leading-4">
                      {choiceName(alternative)} <span className={`text-[10px] ${sourceLabel(alternative).tone}`}>· {sourceLabel(alternative).text}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {unmatched.length > 0 && (
        aiReady ? (
          <button type="button" disabled={aiBusy !== null} onClick={() => void estimateUnmatched()} className="button-secondary w-full">
            {aiBusy === "text" ? <><Loader2 size={15} className="animate-spin" /> Estimating…</> : <><Sparkles size={15} className="text-amber-300" /> Estimate {unmatched.length === 1 ? "it" : `these ${unmatched.length}`} with AI</>}
          </button>
        ) : (
          <p className="text-[11px] leading-5 text-muted">Remove unknown items, add them to your food library, or <button type="button" onClick={onSetUpAi} className="font-semibold text-amber-300">set up AI</button> to estimate them.</p>
        )
      )}
      {aiError && <FormError message={aiError} />}

      {ready.length > 0 && (
        <>
          <div className="grid grid-cols-4 gap-1.5">
            {MEAL_TYPES.map((type) => (
              <button key={type} type="button" onClick={() => setMealType(type)} className={`rounded-xl border px-1 py-2 text-[11px] font-medium capitalize ${mealType === type ? "border-lime bg-lime/10 text-lime" : "border-line text-muted"}`}>{type}</button>
            ))}
          </div>
          {error && <FormError message={error} />}
          <button type="button" disabled={busy || aiBusy !== null} onClick={() => onSave(ready.map((line) => ({ choice: line.choice!, grams: Number(line.grams) })), mealType)} className="button-primary w-full disabled:opacity-60">
            {busy ? "Saving…" : `Log ${ready.length} item${ready.length === 1 ? "" : "s"} · ${formatNumber(Math.round(totals.kcal))} kcal to ${dayLabel === "Today" ? "today" : dayLabel}`}
          </button>
        </>
      )}
    </div>
  );
}
