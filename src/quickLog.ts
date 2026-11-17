// Free, on-device "quick log": turns "2 roti, 1 bowl dal and chai" into food + amount lines,
// matched against your library first and then the built-in USDA database. No AI, works offline.
import { DESCRIBING, isWholePortion, libraryTerms, rankFoodDb, ROUGH, tokens } from "./foodDb";
import type { DbFood } from "./foodDb";
import type { Food, Serving } from "./types";
import { normalizeServing } from "./utils";

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
  note: string; // e.g. "Weight includes bone: counted 70% as meat."
  partial: string | null; // the words of the food a near-match leaves out ("curry"); such lines start unmatched
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
  // A katori is smaller than USDA's cup, so bowls fall back to ~150 g unless the food has a bowl portion.
  cup: /\bcup/, bowl: /\bbowl/, glass:/\b(glass|cup|fl oz)/, piece: /\b(piece|pc|unit|item|each|whole)\b/, slice: /\bslice/,
  tbsp: /\b(tbsp|tablespoon)/, tsp: /\b(tsp|teaspoon)/, small: /\bsmall/, medium: /\bmedium/, large: /\b(large|big)/, serving: /\bserving/,
  scoop: /\bscoop/, plate: /\bplate/, handful: /\bhandful/,
};

/**
 * Splits on commas, semicolons, new lines, "+", "&", "and", "plus", "aur", and on "with" / "along
 * with" / "extra", since what follows is food too ("omelette with chicken", "chai with sugar").
 * Not "with bone" / "with skin" (about the weight); "without" and "no" are handled when matching.
 */
export function splitItems(input: string): string[] {
  return splitParts(input).map((part) => part.text);
}

/** Like splitItems, also saying which items were add-ons ("… with X", "extra X"): their amount is a guess. */
function splitParts(input: string): { text: string; addOn: boolean }[] {
  const parts: { text: string; addOn: boolean }[] = [];
  for (const piece of input.split(/[,;\n+&]|\band\b|\bplus\b|\baur\b/i)) {
    piece.split(/\b((?:along )?with|extra)\b(?!\s+(?:the\s+)?(?:bones?|skin)\b)/i).forEach((part, index) => {
      // split() with a capture group puts the separators at odd positions: what follows one is an add-on.
      if (index % 2 === 1) return;
      const text = part.trim();
      if (text.length > 1) parts.push({ text, addOn: index > 0 });
    });
  }
  return parts;
}

function parseNumber(token: string): number | null {
  if (/^\d+(\.\d+)?$/.test(token)) return Number(token);
  const fraction = token.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  return NUMBER_WORDS[token] ?? null;
}

/** "2 roti", "1/2 cup rice", "200g chicken", "half a banana", "roti x2" -> quantity, unit, food words. */
export function parseItem(text: string): { qty: number; unit: string | null; foodText: string; withBone: boolean; counted: boolean } {
  let rest = text.toLowerCase().replace(/(\d)(g|gm|gms|kg|ml|l)\b/g, "$1 $2").replace(/\s+/g, " ").trim();
  let qty: number | null = null;
  let unit: string | null = null;

  // "with bone", "bone-in", "on the bone": the weight includes bone.
  const bone = /\b(with (the )?bones?|bone[- ]?in|on the bone)\b/;
  const withBone = bone.test(rest);
  rest = rest.replace(bone, " ").replace(/\s+/g, " ").trim();

  // A weight or volume anywhere: "chicken curry 200 g", "rice 1.5 kg".
  const weight = rest.match(/(?:^|\s)(\d+(?:\.\d+)?)\s+(g|gm|gms|grams?|kg|kgs|ml|l|litres?|liters?)(?=\s|$)/);
  if (weight) {
    qty = Number(weight[1]);
    unit = UNITS[weight[2]];
    rest = `${rest.slice(0, weight.index)} ${rest.slice((weight.index ?? 0) + weight[0].length)}`.replace(/\s+/g, " ").trim();
    while (rest.startsWith("of ")) rest = rest.slice(3);
    return { qty, unit, foodText: rest, withBone, counted: true };
  }

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
  // A unit at the end: "cheese slice", "rice bowl", "chicken piece".
  const lastWord = tokens[tokens.length - 1];
  if (!unit && tokens.length > 1 && UNITS[lastWord] && !["small", "medium", "large", "big"].includes(lastWord)) {
    unit = UNITS[lastWord];
    tokens.pop();
  }
  return { qty: qty ?? 1, unit, foodText: tokens.join(" ").trim(), withBone, counted: qty !== null };
}

function nameOf(choice: Choice): string {
  return choice.kind === "library" ? choice.food.name : choice.kind === "db" ? choice.item.name : choice.name;
}
function servingsOf(choice: Choice): Serving[] {
  const raw = choice.kind === "library" ? choice.food.servings : choice.kind === "db" ? choice.item.portions : [{ label: "1 portion", grams: choice.grams }];
  return raw.map(normalizeServing);
}

/**
 * With no number or unit ("almonds", "sugar", "cabbage"): the first portion that's a real serving,
 * 15-400 kcal, at most 400 g and not a whole head or bunch (not 1 almond, a cup of sugar or a whole
 * cabbage); for near-zero-calorie drinks, their first portion of 50 g or more; else none, and the
 * caller uses a weight guess.
 */
function usualServing(choice: Choice, servings: Serving[]): Serving | undefined {
  const kcal = (serving: Serving) => nutritionFor(choice, serving.grams).kcal;
  // "1 oz" of meat or juice isn't a serving (an ounce of nuts is).
  const ounce = (serving: Serving) => /^[\d./\s]*(oz|fl oz|ounce)\b/i.test(serving.label) && kcal(serving) < 100;
  const sensible = servings.filter((serving) => kcal(serving) <= 400 && serving.grams <= 400 && !isWholePortion(serving.label) && !ounce(serving));
  // Near-zero-calorie foods (black coffee, tea, water) never reach 15 kcal: their first proper-sized portion.
  return sensible.find((serving) => kcal(serving) >= 15) ?? sensible.find((serving) => serving.grams >= 50);
}

/**
 * Grams for a quantity + unit of a chosen food. `counted`: a number was typed ("2 carrots"); with
 * no number and no unit ("grapes", "almonds") a real serving is used, not one grape or one almond.
 */
export function gramsFor(choice: Choice, qty: number, unit: string | null, counted = true): { grams: number | null; estimated: boolean } {
  if (choice.kind === "ai") return { grams: choice.grams, estimated: false };
  if (unit === "g" || unit === "ml") return { grams: qty, estimated: false };
  if (unit === "kg" || unit === "l") return { grams: qty * 1000, estimated: false };
  const servings = servingsOf(choice);
  if (unit && UNIT_MATCH[unit]) {
    const portion = servings.find((serving) => UNIT_MATCH[unit].test(serving.label.toLowerCase()));
    if (portion) return { grams: Math.round(qty * portion.grams), estimated: false };
  }
  if (unit && HOUSEHOLD_GRAMS[unit]) return { grams: Math.round(qty * HOUSEHOLD_GRAMS[unit]), estimated: true };
  const bare = !counted && !unit;
  const serving = bare ? usualServing(choice, servings) : servings[0];
  if (serving) return { grams: Math.round(qty * serving.grams), estimated: unit !== null };
  // No usable portion: 100 g, or less for dense foods (about 200 kcal), marked as a guess.
  if (bare) {
    const per100 = nutritionFor(choice, 100).kcal;
    return { grams: per100 > 200 ? Math.round((200 / per100) * 100) : 100, estimated: true };
  }
  return { grams: Math.round(qty * 100), estimated: true };
}

/** Your own foods with every word as a whole word (as typed, or translated: "chai" finds "Tea"), single foods first. */
function matchLibrary(foods: Food[], phrase: string): Food[] {
  const { plain, mapped } = libraryTerms(phrase);
  if (!plain.length) return [];
  return foods
    .filter((food) => {
      const words = new Set(tokens(`${food.name} ${food.brand ?? ""}`));
      return plain.every((word) => words.has(word)) || mapped.every((word) => words.has(word));
    })
    // Single foods before recipes that merely contain the word ("biscuit" vs "Tea and 2 biscuits").
    .sort((a, b) => Number(a.source === "recipe") - Number(b.source === "recipe") || a.name.length - b.name.length);
}

// Words that carry no food meaning.
const FILLER = new Set(["some", "little", "bit", "of", "the", "my", "a", "an", "and", "in", "on", "for", "homemade", "home", "made", "fresh", "hot", "plain", "warm", "freshly", "style", "type"]);
// After these words come add-ons ("chai with sugar", "dosa with chutney", "coffee without sugar"): useful,
// but not what the food is, so a match may leave them out (and says so).
const EXTRAS_AFTER = new Set(["with", "without", "less", "no", "extra"]);
// Describing words ("black", "boiled": see DESCRIBING in foodDb.ts) may also be left out (and the line says so).

/** Splits food words into the ones a match must cover and the ones it may leave out. */
export function classify(foodText: string): { required: string[]; optional: string[] } {
  const required: string[] = [];
  const optional: string[] = [];
  let extras = false;
  for (const word of foodText.toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean)) {
    if (EXTRAS_AFTER.has(word)) { extras = true; continue; }
    if (FILLER.has(word)) continue;
    (extras || DESCRIBING.has(word) ? optional : required).push(word);
  }
  // A food named only by describing words ("raw", "black"): they're all it has.
  if (!required.length) return { required: optional, optional: [] };
  return { required, optional };
}

/** Shorter runs of words, longest first and earlier words first: "chicken tikka masala" -> "chicken tikka", "tikka masala", "chicken", … */
function subPhrases(words: string[]): string[][] {
  const runs: string[][] = [];
  for (let size = words.length - 1; size >= 1; size -= 1) for (let from = 0; from + size <= words.length; from += 1) runs.push(words.slice(from, from + size));
  return runs;
}

/**
 * Parses free text into lines with a best match, alternatives and grams.
 *
 * The rule that keeps it honest: a food is picked automatically only when its name covers every
 * word that says what the food is (whole words; plurals and Indian names understood). If only part
 * of what you typed matches ("chicken" for "chicken curry"), the line stays unmatched and shows
 * near matches to pick from, or the AI estimates it. Only describing words ("black", "boiled") and
 * add-ons ("with sugar") may be left out, and the line then says what was left out.
 */
export function quickLog(input: string, library: Food[], db: DbFood[] | null): QuickLine[] {
  return splitParts(input).map(({ text, addOn }) => {
    const { qty, unit, foodText, withBone, counted } = parseItem(text);
    const { required, optional } = classify(foodText);
    // Matches for some words, and whether the best one IS that food (see rankFoodDb).
    const find = (words: string[]): { choices: Choice[]; exact: boolean; names: boolean } => {
      const phrase = words.join(" ");
      const own: Choice[] = matchLibrary(library, phrase).slice(0, 3).map((food) => ({ kind: "library" as const, food }));
      const ownNames = new Set(own.map((choice) => nameOf(choice).toLowerCase()));
      const ranked = db ? rankFoodDb(db, phrase, 5) : [];
      // Some words have only a rough stand-in in the database (chai): offered, never picked.
      const rough = tokens(phrase).some((word) => ROUGH.has(word));
      const sorted = [...ranked.filter((item) => item.exact && !rough), ...ranked.filter((item) => !item.exact || rough)];
      const fromDb: Choice[] = sorted.map((item) => ({ kind: "db" as const, item: item.food }));
      // Your own foods first (they match on your own words); skip database entries you already have.
      return {
        choices: [...own, ...fromDb.filter((choice) => !ownNames.has(nameOf(choice).toLowerCase()))],
        exact: own.length > 0 || (sorted[0]?.exact === true && !rough),
        names: own.length > 0 || sorted[0]?.exact === true, // it IS (roughly) that food
      };
    };

    // Every word first, then only the required ones: an exact match on either is picked.
    let alternatives: Choice[] = [];
    let matched: string[] = [];
    let exact = false;
    for (const words of optional.length ? [[...required, ...optional], required] : [required]) {
      const found = find(words);
      if (found.exact) { alternatives = found.choices; matched = words; exact = true; break; }
      if (!alternatives.length && found.choices.length) { alternatives = found.choices; matched = []; }
    }
    if (!alternatives.length) {
      // Near matches only: shown to pick from (and given to the AI as reference), never picked automatically.
      // All runs of the longest size that finds anything, so "masala chai" offers tea, not only masala.
      const runs = subPhrases(required);
      for (const size of [...new Set(runs.map((run) => run.length))]) {
        const all = runs.filter((run) => run.length === size).map((run) => ({ run, ...find(run) })).filter((item) => item.choices.length);
        if (!all.length) continue;
        // Runs that name a real food first ("chicken" for "chicken curry"); drop loose hits ("cold" -> "cold pressed oil").
        const found = all.some((item) => item.names) ? all.filter((item) => item.names) : all;
        const merged: Choice[] = [];
        for (let i = 0; i < 5; i += 1) {
          for (const item of found) {
            const next = item.choices[i];
            if (next && !merged.some((choice) => nameOf(choice) === nameOf(next))) merged.push(next);
          }
        }
        alternatives = merged.slice(0, 6);
        matched = found.length === 1 ? found[0].run : [];
        break;
      }
    }

    const choice = exact ? alternatives[0] ?? null : null;
    const left = (words: string[]) => [...new Set(words.filter((word) => !matched.includes(word)))];
    const amount = choice ? gramsFor(choice, qty, unit, counted) : { grams: null, estimated: false };
    let grams = amount.grams;
    const notes: string[] = [];
    if (choice && left(optional).length) notes.push(`Matched without “${left(optional).join(" ")}”.`);
    if (grams !== null && withBone && choice?.kind !== "ai") {
      grams = Math.round(grams * 0.7);
      notes.push("Weight includes bone: counted 70% as meat.");
    }
    return {
      text, qty, unit, choice, alternatives,
      grams: grams === null ? "" : String(grams),
      // An add-on with no amount ("… with chicken") gets a usual serving, but flagged for checking.
      estimatedAmount: amount.estimated || withBone || (addOn && choice !== null && !counted && !unit),
      note: notes.join(" "),
      partial: !exact && alternatives.length ? (left(required).join(" ") || required.join(" ")) : null,
    };
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
