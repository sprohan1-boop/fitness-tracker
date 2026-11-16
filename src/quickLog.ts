// Free, on-device "quick log": turns "2 roti, 1 bowl dal and chai" into food + amount lines,
// matched against your library first and then the built-in USDA database. No AI, works offline.
import { libraryWords, searchFoodDb } from "./foodDb";
import type { DbFood } from "./foodDb";
import type { Food, Serving } from "./types";

/** What a line is matched to: one of your foods, a database food, or an AI estimate. */
export type Choice =
  | { kind: "library"; food: Food }
  | { kind: "db"; item: DbFood }
  | { kind: "ai"; name: string; grams: number; kcal: number; protein: number; carbs: number; fat: number; fiber: number; note: string; confidence: string };

export type QuickLine = {
  text: string;
  qty: number;
  unit: string | null;
  choice: Choice | null;
  alternatives: Choice[];
  grams: string; // editable amount in grams, "" when unknown
  estimatedAmount: boolean; // amount guessed from a household measure
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  half: 0.5, quarter: 0.25, couple: 2, few: 3, ek: 1, do: 2, teen: 3, char: 4, aadha: 0.5, adha: 0.5,
};

// Unit words -> a canonical unit.
const UNITS: Record<string, string> = {
  g: "g", gm: "g", gms: "g", gram: "g", grams: "g", gr: "g", kg: "kg", kgs: "kg",
  ml: "ml", l: "l", litre: "l", liter: "l", litres: "l", liters: "l",
  cup: "cup", cups: "cup", bowl: "bowl", bowls: "bowl", katori: "bowl", katoris: "bowl",
  plate: "plate", plates: "plate", glass: "glass", glasses: "glass", mug: "cup", mugs: "cup",
  piece: "piece", pieces: "piece", pc: "piece", pcs: "piece",
  slice: "slice", slices: "slice", tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", spoon: "tbsp", spoons: "tbsp",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", scoop: "scoop", scoops: "scoop", serving: "serving", servings: "serving",
  handful: "handful", handfuls: "handful", small: "small", medium: "medium", large: "large", big: "large",
};

// Typical household amounts when a food has no matching portion of its own (marked as estimated).
const HOUSEHOLD_GRAMS: Record<string, number> = { bowl: 150, cup: 240, glass: 250, plate: 250, tbsp: 15, tsp: 5, scoop: 30, handful: 30, slice: 30, piece: 50, small: 70, medium: 120, large: 180 };

// Which words in a portion label count as that unit.
const UNIT_MATCH: Record<string, RegExp> = {
  cup: /\bcup/, bowl: /\bbowl/, // a katori is smaller than USDA's cup, so bowls fall back to ~150 g glass: /\b(glass|cup|fl oz)/, piece: /\b(piece|pc|unit|item|each|whole)\b/, slice: /\bslice/,
  tbsp: /\b(tbsp|tablespoon)/, tsp: /\b(tsp|teaspoon)/, small: /\bsmall/, medium: /\bmedium/, large: /\b(large|big)/, serving: /\bserving/,
  scoop: /\bscoop/, plate: /\bplate/, handful: /\bhandful/,
};

/** Splits on commas, semicolons, new lines, "+", "&", "and", "plus". */
export function splitItems(input: string): string[] {
  return input
    .split(/[,;\n+&]|\band\b|\bplus\b|\baur\b/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 1);
}

function parseNumber(token: string): number | null {
  if (/^\d+(\.\d+)?$/.test(token)) return Number(token);
  const fraction = token.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  return NUMBER_WORDS[token] ?? null;
}

/** "2 roti", "1/2 cup rice", "200g chicken", "half a banana", "roti x2" -> quantity, unit, food words. */
export function parseItem(text: string): { qty: number; unit: string | null; foodText: string } {
  let rest = text.toLowerCase().replace(/(\d)(g|gm|gms|kg|ml|l)\b/g, "$1 $2").replace(/\s+/g, " ").trim();
  let qty: number | null = null;
  let unit: string | null = null;

  // Trailing "x2" / "*2" / "2x"
  const trailing = rest.match(/\s*(?:x|\*)\s*(\d+(?:\.\d+)?)$/) ?? rest.match(/\s+(\d+(?:\.\d+)?)\s*x$/);
  if (trailing) { qty = Number(trailing[1]); rest = rest.slice(0, trailing.index).trim(); }

  const tokens = rest.split(" ");
  // Leading quantity: "2", "1.5", "1/2", "1 1/2", "half", "a couple of"
  if (qty === null && tokens.length) {
    const first = parseNumber(tokens[0].replace(/x$/, ""));
    if (first !== null) {
      qty = first;
      tokens.shift();
      const second = tokens[0] && /^\d+\/\d+$/.test(tokens[0]) ? parseNumber(tokens[0]) : null;
      if (second !== null) { qty += second; tokens.shift(); }
    }
  }
  while (tokens[0] === "a" || tokens[0] === "an" || tokens[0] === "of") tokens.shift(); // "half a banana", "couple of"
  if (tokens[0] && UNITS[tokens[0]]) {
    unit = UNITS[tokens.shift() as string];
    if (tokens[0] === "of") tokens.shift();
  }
  return { qty: qty ?? 1, unit, foodText: tokens.join(" ").trim() };
}

function nameOf(choice: Choice): string {
  return choice.kind === "library" ? choice.food.name : choice.kind === "db" ? choice.item.name : choice.name;
}
function servingsOf(choice: Choice): Serving[] {
  return choice.kind === "library" ? choice.food.servings : choice.kind === "db" ? choice.item.portions : [{ label: "1 portion", grams: choice.grams }];
}

/** Grams for a quantity + unit of a chosen food. */
export function gramsFor(choice: Choice, qty: number, unit: string | null): { grams: number | null; estimated: boolean } {
  if (choice.kind === "ai") return { grams: choice.grams, estimated: false };
  if (unit === "g" || unit === "ml") return { grams: qty, estimated: false };
  if (unit === "kg" || unit === "l") return { grams: qty * 1000, estimated: false };
  const servings = servingsOf(choice);
  if (unit && UNIT_MATCH[unit]) {
    const portion = servings.find((serving) => UNIT_MATCH[unit].test(serving.label.toLowerCase()));
    if (portion) {
      // "1 cup" portions are per 1 unit; labels like "0.5 breast" scale per their own amount.
      const per = Number(portion.label.match(/^(\d+(?:\.\d+)?)/)?.[1] ?? 1) || 1;
      return { grams: Math.round((qty * portion.grams) / per), estimated: false };
    }
  }
  if (unit && HOUSEHOLD_GRAMS[unit]) return { grams: Math.round(qty * HOUSEHOLD_GRAMS[unit]), estimated: true };
  if (servings[0]) {
    const per = Number(servings[0].label.match(/^(\d+(?:\.\d+)?)/)?.[1] ?? 1) || 1;
    return { grams: Math.round((qty * servings[0].grams) / per), estimated: unit !== null };
  }
  return { grams: Math.round(qty * 100), estimated: true };
}

/** Your own foods containing every word (as typed, or via a synonym: "chai" finds "Milk Tea"), shortest first. */
function matchLibrary(foods: Food[], foodText: string): Food[] {
  const { plain, mapped } = libraryWords(foodText);
  if (!plain.length) return [];
  return foods
    .filter((food) => {
      const name = `${food.name} ${food.brand ?? ""}`.toLowerCase();
      return plain.every((word) => name.includes(word)) || mapped.every((word) => name.includes(word));
    })
    // Single foods before recipes that merely contain the word ("biscuit" vs "Tea and 2 biscuits").
    .sort((a, b) => Number(a.source === "recipe") - Number(b.source === "recipe") || a.name.length - b.name.length);
}

// Words that describe how, not what ("chai with less sugar" is about chai).
const FILLER = new Set(["with", "without", "less", "no", "extra", "some", "little", "bit", "of", "the", "my", "homemade", "home", "made", "fresh", "hot", "cold", "plain"]);
const mainWords = (text: string) => text.split(/\s+/).filter((word) => word && !FILLER.has(word)).join(" ");

/** "chai with less sugar" -> tries the whole phrase, then "chai with less", "chai with", "chai". */
function shorterPhrases(foodText: string): string[] {
  const parts = foodText.split(/\s+/).filter(Boolean);
  return parts.map((_, i) => parts.slice(0, parts.length - i).join(" ")).filter((phrase) => phrase.length > 1);
}

/** Parses free text into lines with a best match, alternatives and grams. */
export function quickLog(input: string, library: Food[], db: DbFood[] | null): QuickLine[] {
  return splitItems(input).map((text) => {
    const { qty, unit, foodText } = parseItem(text);
    // Your own foods are tried on every shorter phrase first, then the database.
    const phrases = shorterPhrases(mainWords(foodText) || foodText);
    let own: Choice[] = [];
    for (const phrase of phrases) {
      own = matchLibrary(library, phrase).slice(0, 3).map((food) => ({ kind: "library" as const, food }));
      if (own.length) break;
    }
    let fromDb: Choice[] = [];
    for (const phrase of phrases) {
      fromDb = db ? searchFoodDb(db, phrase, 5).map((item) => ({ kind: "db" as const, item })) : [];
      if (fromDb.length) break;
    }
    // Skip database entries you already have in your library.
    const ownNames = new Set(own.map((choice) => nameOf(choice).toLowerCase()));
    const alternatives = [...own, ...fromDb.filter((choice) => !ownNames.has(nameOf(choice).toLowerCase()))];
    const choice = alternatives[0] ?? null;
    const amount = choice ? gramsFor(choice, qty, unit) : { grams: null, estimated: false };
    return { text, qty, unit, choice, alternatives, grams: amount.grams === null ? "" : String(amount.grams), estimatedAmount: amount.estimated };
  });
}

export const choiceName = nameOf;
export const choiceServings = servingsOf;

/** Nutrition of a choice for an amount in grams. */
export function nutritionFor(choice: Choice, grams: number) {
  if (choice.kind === "ai") {
    const f = choice.grams > 0 ? grams / choice.grams : 0;
    return { kcal: choice.kcal * f, protein: choice.protein * f, carbs: choice.carbs * f, fat: choice.fat * f };
  }
  const per100 = choice.kind === "library"
    ? { kcal: choice.food.calories_per_100g, protein: choice.food.protein_g_per_100g, carbs: choice.food.carbohydrates_g_per_100g, fat: choice.food.fat_g_per_100g }
    : { kcal: choice.item.kcal, protein: choice.item.protein, carbs: choice.item.carbs, fat: choice.item.fat };
  const f = grams / 100;
  return { kcal: per100.kcal * f, protein: per100.protein * f, carbs: per100.carbs * f, fat: per100.fat * f };
}
