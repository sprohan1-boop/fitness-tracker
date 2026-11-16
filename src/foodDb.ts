// Built-in generic food database: USDA FoodData Central, SR Legacy (public domain), built into
// public/foods-db.json. Downloaded on first search, then cached for offline use.
import type { Food, Serving } from "./types";
import { normalizeServing } from "./utils";

export type DbFood = {
  name: string;
  category: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number | null;
  satFat: number | null;
  sodiumMg: number | null;
  portions: Serving[];
  /** The name's words, singular (see `tokens`), for whole-word matching. */
  words: Set<string>;
};

type Raw = { categories: string[]; foods: [string, number, number, number, number, number, number, number | null, number | null, number | null, [string, number][]][] };

let loading: Promise<DbFood[]> | null = null;

// Portions that are a natural single item ("1 egg", "1 slice") as opposed to a kitchen measure.
const COUNT_UNITS = new Set([
  "piece", "fruit", "breast", "thigh", "drumstick", "wing", "leg", "fillet", "egg", "link", "patty", "bar", "cookie", "biscuit",
  "muffin", "roll", "bun", "tortilla", "chapati", "roti", "paratha", "nut", "kernel", "floweret", "floret", "leaf", "stalk", "spear",
  "clove", "cracker", "item", "each", "whole", "unit", "serving", "nlea", "jigger", "cocktail", "bottle", "can", "glass",
]);
// Portions too big (or odd) to be a sensible default: a whole cauliflower, a stick of butter, a recipe.
const WHOLE_UNITS = new Set(["head", "package", "container", "loaf", "stick", "quart", "gallon", "recipe", "yield", "pizza", "pie", "cake", "block", "lb", "pound", "batch", "bunch", "jar", "box", "bag", "cubic"]);

// Eaten by the spoon, so a tablespoon comes before a cup.
const SPREADS = /\b(catsup|ketchup|sauce|dressing|mayonnaise|mustard|vinegar|syrup|jams?|jelly|jellies|preserves|marmalade|spread|honey|butter|ghee|oil|chutney|relish|salsa|pickle|cream cheese|sour cream|nutella)\b/i;

/** A whole head, bunch, package or recipe: never a default serving. */
export function isWholePortion(label: string): boolean {
  return WHOLE_UNITS.has(singular(label.toLowerCase().replace(/^[\d./\s]+/, "").split(/[^a-z]+/)[0] ?? ""));
}

/**
 * Order of a food's portions; the first is the default when you type no unit ("2 carrots").
 * "1 medium" first, then natural single items ("1 egg", "1 almond"), then cups, then spoons; never
 * a whole-package portion, and never one over ~400 kcal (a cup of butter or honey isn't a serving).
 */
function portionRank(label: string, nameWords: Set<string>, kcalPer100: number, grams: number, spread: boolean): number {
  const head = singular(label.toLowerCase().replace(/^[\d./\s]+/, "").split(/[^a-z]+/)[0] ?? "");
  let rank = 5;
  if (head === "medium" || (nameWords.has(head) && /\bmedium\b/i.test(label))) rank = 0; // "1 croissant, medium"
  else if (nameWords.has(head)) rank = 0.5; // the food's own unit: "1 breast", "1 almond"
  else if (head === "large" || head === "small" || COUNT_UNITS.has(head)) rank = 1;
  else if (head === "slice") rank = 2;
  else if (head === "cup" || head === "bowl" || head === "katori") rank = 3;
  else if (head === "tbsp" || head === "tablespoon") rank = spread ? 2.5 : 4;
  else if (head === "tsp" || head === "teaspoon") rank = 4.1;
  else if (head === "pat") rank = 4.2;
  else if (head === "oz" || head === "fl") rank = 4.5;
  if (WHOLE_UNITS.has(head) || /\b(whole|entire)\b.*\b(pie|cake|pizza|loaf)\b/i.test(label)) rank = 9;
  if ((kcalPer100 * grams) / 100 > 400) rank += 10;
  return rank;
}

/** Turns the compact foods-db.json format into foods (also used by the matching tests). */
export function parseFoodDb(raw: Raw): DbFood[] {
  return raw.foods.map(([name, cat, kcal, protein, carbs, fat, fiber, sugar, satFat, sodiumMg, portions]) => {
    const words = new Set(nameTokens(name));
    const servings = portions.map(([label, grams]) => normalizeServing({ label, grams }));
    const spread = SPREADS.test(name);
    const rank = (serving: Serving) => portionRank(serving.label, words, kcal, serving.grams, spread);
    return {
      name, category: raw.categories[cat] ?? "", kcal, protein, carbs, fat, fiber, sugar, satFat, sodiumMg, words,
      portions: servings.sort((a, b) => rank(a) - rank(b)),
    };
  });
}

export function loadFoodDb(): Promise<DbFood[]> {
  loading ??= fetch(`${import.meta.env.BASE_URL}foods-db.json`)
    .then((response) => {
      if (!response.ok) throw new Error("The food database couldn't be downloaded.");
      return response.json() as Promise<Raw>;
    })
    .then(parseFoodDb)
    .catch((cause) => {
      loading = null; // allow a retry
      throw cause;
    });
  return loading;
}

// Everyday (incl. Indian) words -> the wording USDA uses. Keys are single words, in singular form.
const SYNONYMS: Record<string, string> = {
  dal: "lentils", daal: "lentils", dhal: "lentils", curd: "yogurt", dahi: "yogurt", chana: "chickpeas", chole: "chickpeas",
  rajma: "kidney beans", aloo: "potato", gobi: "cauliflower", palak: "spinach", bhindi: "okra", ladyfinger: "okra", brinjal: "eggplant",
  baingan: "eggplant", capsicum: "peppers", methi: "fenugreek", ghee: "butter oil", atta: "wheat flour whole-grain", maida: "wheat flour white",
  roti: "chapati", phulka: "chapati", chapathi: "chapati", mutton: "goat", bakra: "goat", prawn: "shrimp", keema: "ground",
  groundnut: "peanuts", moong: "mung", masoor: "lentils", toor: "pigeon peas", arhar: "pigeon peas",
  chai: "tea black brewed", tea: "tea brewed", coffee: "coffee brewed", anda: "egg", murgi: "chicken", seb: "apple", kela: "banana",
  biscuit: "cookies", jowar: "sorghum", bajra: "millet", ragi: "millet", sooji: "semolina", rava: "semolina", besan: "chickpea flour",
  omelette: "egg omelet", omelet: "egg omelet", buttermilk: "milk buttermilk", chaas: "milk buttermilk", chhaas: "milk buttermilk", soya: "soy", coke: "cola", pepsi: "cola", chikoo: "sapodilla", chiku: "sapodilla",
  sapota: "sapodilla", whisky: "whiskey", aubergine: "eggplant", courgette: "zucchini", brinjals: "eggplant", sabudana: "tapioca",
  makhana: "lotus seeds", amla: "gooseberries", lauki: "gourd", karela: "bitter gourd", tinda: "gourd", mooli: "radish", shakarkandi: "sweet potato",
  kaju: "cashew", badam: "almonds", akhrot: "walnuts", kishmish: "raisins", khajoor: "dates", ananas: "pineapple", santra: "orange",
  kiwi: "kiwifruit", ketchup: "catsup", achar: "pickle", aam: "mango", angoor: "grapes", papita: "papaya", tarbooz: "watermelon", anar: "pomegranate", amrud: "guava", nimbu: "lemon",
};

// Whole phrases with a USDA wording (applied to the entire query).
const PHRASES: Record<string, string> = {
  "toned milk": "milk reduced fat 2%", "double toned milk": "milk lowfat 1%", "skimmed milk": "milk nonfat", "skim milk": "milk nonfat",
  "full cream milk": "milk whole", "full fat milk": "milk whole", "low fat milk": "milk lowfat 1%",
  "sprouts": "mung beans sprouted", "moong sprouts": "mung beans sprouted", "brown bread": "bread whole-wheat commercially prepared",
  "moong dal": "mung beans mature seeds cooked", "mung dal": "mung beans mature seeds cooked", "masoor dal": "lentils",
  "toor dal": "pigeon peas cooked", "arhar dal": "pigeon peas cooked", "tuvar dal": "pigeon peas cooked", "chana dal": "chickpeas",
  "urad dal": "mungo beans cooked", "moong": "mung beans mature seeds cooked", "urad": "mungo beans cooked",
  "french fries": "potatoes french fried", "fries": "potatoes french fried", "chips": "snacks potato chips", "poha": "flattened rice",
  "curd rice": "yogurt rice", "soda": "carbonated beverage club soda", "cold drink": "carbonated cola", "soft drink": "carbonated cola",
};

const phraseKey = (words: string[]) => [...words].sort().join(" ");
const PHRASE_LOOKUP = new Map(Object.entries(PHRASES).map(([key, value]) => [phraseKey(tokens(key)), value]));

// Foods USDA only has in a different form, so a database match is a hint, never picked automatically:
// Indian chai is tea boiled with milk and sugar (~80 kcal more per cup than the black tea USDA lists).
// Indian pickle (achar) is fruit or vegetables in oil and spice, not USDA's vinegar cucumber pickle.
export const ROUGH = new Set(["chai", "pickle", "achar"]);

// The everyday version of staples, which word-matching can't pick out on its own.
const EVERYDAY = [
  /^rice, white, long-grain, regular, enriched, cooked$/,
  /breast, meat only, cooked, roasted$/,
  /^milk, whole, 3\.25% milkfat, with added vitamin d$/,
  /^yogurt, plain, whole milk$/,
  /^potatoes, boiled, cooked without skin, flesh, without salt$/,
  /^lentils, mature seeds, cooked, boiled, without salt$/,
  /^chickpeas \(garbanzo beans, bengal gram\), mature seeds, cooked, boiled, without salt$/,
  /^egg, whole, cooked, hard-boiled$/,
  /^cereals, oats, regular and quick, not fortified, dry$/,
  /^beverages, tea, black, brewed, prepared with tap water$/,
  /^beverages, coffee, brewed, prepared with tap water$/,
  /^cookies, marie biscuit$/,
  /^tomatoes, red, ripe, raw, year round average$/,
  /^mushrooms, white, raw$/,
  /^sugars, granulated$/,
  /^tofu, raw, firm, prepared with calcium sulfate$/,
  /^oil, canola$/,
  /^grapes, red or green \(european type/,
  /^cheese, cheddar \(includes/,
  /^corn, sweet, yellow, cooked, boiled, drained, without salt$/,
  /^bread, white, commercially prepared \(includes soft bread crumbs\)$/,
  /^peanuts, all types, raw$/,
  /^beans, kidney, red, mature seeds, cooked, boiled, without salt$/,
  /^bananas, raw$/,
  /^apples, raw, with skin\b/,
  /^onions, raw$/,
  /^carrots, raw$/,
  /^nuts, almonds$/,
  /^nuts, cashew nuts, raw$/,
  /^nuts, walnuts, english$/,
  /^nuts, coconut meat, raw$/,
  /^alcoholic beverage, beer, regular, all$/,
  /^alcoholic beverage, wine, table, red$/,
  /^alcoholic beverage, wine, table, white$/,
  /^beverages, carbonated, cola, regular$/,
  /^pasta, cooked, enriched, without added salt$/,
  /^butter, salted$/,
  /^oranges, raw, all commercial varieties$/,
  /^ice creams, vanilla$/,
  /^avocados, raw, all commercial varieties$/,
  /^game meat, goat, cooked, roasted$/,
  /^fish, salmon, atlantic, farmed, cooked, dry heat$/,
  /^fish, tuna, light, canned in water, drained solids\b/,
  /^crustaceans, shrimp, cooked\b/,
  /^bagels, plain, enriched/,
  /^croissants, butter$/,
  /^salad dressing, mayonnaise, regular$/,
  /^apple juice, canned or bottled, unsweetened, without added ascorbic acid$/,
  /^pizza, cheese topping, regular crust, frozen, cooked$/,
  /^noodles, egg, cooked, enriched\b/,
  /^snacks, popcorn, air-popped$/,
];

// Describing words: they say how a food is, not what it is ("black coffee" is coffee; "boiled egg"
// is an egg). A match may leave these out; words that change the food a lot ("fried", "masala",
// "sweet", "toned") are deliberately not here.
export const DESCRIBING = new Set([
  "black", "green", "white", "brown", "red", "yellow", "unsweetened", "salted", "unsalted", "spicy", "filter", "instant", "strong",
  "cooked", "boiled", "steamed", "roasted", "grilled", "baked", "raw", "ripe", "indian", "desi", "organic", "chopped", "sliced",
]);

// Words in a USDA name that don't make it a different food ("Chicken, …, meat only, cooked").
const NEUTRAL = new Set([
  "or", "and", "with", "without", "from", "in", "of", "all", "type", "types", "style", "plain", "regular", "whole", "fresh", "raw",
  "cooked", "boiled", "meat", "only", "flesh", "common", "mature", "seed", "kernel", "fluid", "skin", "skinless", "boneless",
  "hard", "average", "year", "round", "variety", "commercial", "table", "drained", "unenriched", "enriched", "brewed",
]);

// First parts of USDA names that are a category, not the food: "Nuts, almonds" is almonds.
const CATEGORY_HEADS = new Set([
  "nut", "beverage", "alcoholic beverage", "cereal", "cereal ready to eat", "snack", "spice", "candy", "fish", "crustacean",
  "mollusk", "seed", "vegetable", "fruit", "game meat", "bread", "sweetener", "carbonated beverage", "dessert", "cookie",
  "carbonated", "distilled", "snack", "formulated bar", "salad dressing", "juice",
]);

/** One word in a standard form, so plurals match: "blackberries" -> "blackberry", "tomatoes" -> "tomato", "eggs" -> "egg". */
export function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ches|shes|sses|xes|oes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * A text's words: lowercase, split on anything that isn't a letter or digit, made singular.
 * All matching compares these whole words, never parts of words, so "black" can't match
 * "Blackberries", "egg" can't match "Eggplant" and "pea" can't match "Peanuts".
 */
export function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(singular);
}

/** A USDA name's words, without notes like "(includes fried, teriyaki, … varieties)" that name other foods. */
function nameTokens(name: string): string[] {
  return tokens(name.replace(/\(includes[^)]*\)/gi, " "));
}

/** Search words for a query, with everyday names translated ("dal" -> "lentil", "toned milk" -> "milk reduced fat 2"). */
export function queryTerms(query: string): string[] {
  const words = tokens(query);
  const phrase = PHRASE_LOOKUP.get(phraseKey(words));
  if (phrase) return [...new Set(tokens(phrase))];
  return [...new Set(words.flatMap((word) => (SYNONYMS[word] ? tokens(SYNONYMS[word]) : [word])))];
}

/** The words as typed or translated, for matching your own food names ("chai" finds "Chai" and "Tea"). */
export function libraryTerms(query: string): { plain: string[]; mapped: string[] } {
  return { plain: tokens(query), mapped: queryTerms(query) };
}

export type Ranked = { food: DbFood; score: number; exact: boolean };

/**
 * Database foods with every search word as a whole word (after translation), best first.
 *
 * `exact` says the food IS what was asked for: the words are in the part of the name that says
 * what the food is ("Nuts, almonds", "Rice, brown, …"), with no other food word beside them.
 * "Beverages, almond milk" for "almonds", "Oil, walnut" for "walnuts" or "Vinegar, red wine" for
 * "red wine" contain the words but are different foods, so they are never exact.
 * `typing`: the last word may be unfinished ("bisc" -> "biscuits"), for search-as-you-type boxes.
 */
export function rankFoodDb(foods: DbFood[], query: string, limit = 8, typing = false): Ranked[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const typed = new Set([...terms, ...tokens(query)]);
  const curated = PHRASE_LOOKUP.has(phraseKey(tokens(query)));
  const last = terms.length - 1;
  const has = (food: DbFood, term: string, index: number) =>
    food.words.has(term) || (typing && index === last && term.length >= 2 && [...food.words].some((word) => word.startsWith(term)));
  const asked = (word: string) => terms.some((term) => term.startsWith(word.slice(0, 5)));
  const ranked: Ranked[] = [];
  for (const food of foods) {
    if (!terms.every((term, index) => has(food, term, index))) continue;
    const name = food.name.toLowerCase();
    // The name's parts, without notes in brackets: "Nuts, almonds" -> [["nut"], ["almond"]].
    const parts = name.replace(/\([^)]*\)/g, " ").split(",").map(tokens).filter((part) => part.length);
    // The part that says what the food is, after category parts: "Beverages, carbonated, cola" -> cola.
    let main = 0;
    while (main < parts.length - 1 && CATEGORY_HEADS.has(parts[main].join(" "))) main += 1;
    const partOf = (term: string) => { const index = parts.findIndex((part) => part.includes(term)); return index === -1 ? parts.length : index; };
    const foodTerms = terms.filter((term) => !DESCRIBING.has(term));
    const where = new Set((foodTerms.length ? foodTerms : terms).map(partOf));
    // The food's own name part has your words (or a category part does: "Milk, …" for "milk").
    const isTheFood = [...where].some((index) => index <= main);
    // Other food words beside yours: "almond MILK", "walnut OIL", "beer SALAMI". Not other words: the
    // category ("cashew NUTS"), a word that translates to yours ("chapati or ROTI"), or a curated phrase.
    const fine = (word: string) =>
      typed.has(word) || NEUTRAL.has(word) || /^\d+$/.test(word) || parts.slice(0, main).some((part, index) => !where.has(index) && part.includes(word)) ||
      (SYNONYMS[word] !== undefined && tokens(SYNONYMS[word]).every((term) => terms.includes(term)));
    let otherWords = 0;
    // A curated phrase ("toned milk" -> "milk reduced fat 2%") is trusted beyond the food's own part.
    for (const index of where) if (index < parts.length && (!curated || index <= main)) otherWords += parts[index].filter((word) => !fine(word)).length;

    let score = parts.length * 0.6 + name.length / 60;
    if (!isTheFood) score += 8;
    score += otherWords * 3;
    // Brand names are in capitals in USDA data (e.g. "UNCLE BENS"); "USDA" itself, in "(Includes foods
    // for USDA's …)", marks a standard staple, not a brand.
    if (/\b(?!USDA\b)[A-Z]{3,}\b/.test(food.name)) score += 4;
    if (EVERYDAY.some((pattern) => pattern.test(name))) score -= 5;
    // Plain foods before processed or prepared versions, unless you asked for them.
    if (name.includes("commercially prepared") && !asked("commercially")) score += 1; // the norm for bread, biscuits
    for (const word of ["breaded", "battered", "frozen", "canned", "prepared from recipe", "ready-to", "with sauce", "dehydrated", "dried", "dry", "uncooked", "unprepared", "mix", "dough", "herbal", "flour", "powder", "imitation", "substitute", "meatless", "low calorie", "diet", "reduced", "fortified"]) if (name.includes(word) && !asked(word)) score += 3;
    if (/\bfried\b/.test(name) && !asked("fried")) score += 2;
    // Dry beans, lentils, rice and pasta are ~2.5x the calories of cooked: cooked unless you said raw/dry.
    if ((/mature seeds/.test(name) || /Cereal Grains/.test(food.category)) && /\braw\b/.test(name) && !asked("raw") && !asked("dry")) score += 4;
    if (name.includes("separable fat")) score += 8; // trimmed fat only
    if (food.category === "Snacks" && !asked("snack") && !asked("chip")) score += 4; // "pork" isn't pork rinds
    if (/Beef|Pork|Lamb|Poultry|Finfish|Sausages/.test(food.category) && /\braw\b/.test(name) && !asked("raw")) score += 3;
    for (const word of ["cured", "pickled", "smoked", "canned", "luncheon", "variety meats", "by-products"]) if (/Beef|Pork|Lamb|Poultry|Sausages/.test(food.category) && name.includes(word) && !asked(word)) score += 3;
    if (name.includes("with salt") && !asked("salt")) score += 1;
    if (/Baby Foods|Fast Foods|Restaurant/.test(food.category) || /baby food|infant formula/.test(name)) score += 10;
    ranked.push({ food, score, exact: isTheFood && otherWords === 0 });
  }
  return ranked.sort((a, b) => a.score - b.score).slice(0, limit);
}

/** Database foods for a query, best first (see `rankFoodDb`). */
export function searchFoodDb(foods: DbFood[], query: string, limit = 8, typing = false): DbFood[] {
  return rankFoodDb(foods, query, limit, typing).map((item) => item.food);
}

const COOKED = /\b(cooked|roasted|boiled|fried|baked|grilled|braised|stewed|steamed|broiled|microwaved|scrambled|poached)\b/i;

/** A food-library entry for a database food (values per 100 g, its portion sizes as servings). */
export function foodFromDb(item: DbFood): Omit<Food, "id" | "source" | "is_verified"> & { source: "usda" } {
  return {
    name: item.name.slice(0, 120),
    brand: null,
    preparation: COOKED.test(item.name) ? "cooked" : /\braw\b/i.test(item.name) ? "raw" : "unspecified",
    calories_per_100g: item.kcal,
    protein_g_per_100g: item.protein,
    carbohydrates_g_per_100g: item.carbs,
    fat_g_per_100g: item.fat,
    fiber_g_per_100g: item.fiber,
    sugar_g_per_100g: item.sugar,
    sat_fat_g_per_100g: item.satFat,
    sodium_mg_per_100g: item.sodiumMg,
    servings: item.portions.slice(0, 10),
    notes: "USDA FoodData Central (SR Legacy)",
    source: "usda",
  };
}
