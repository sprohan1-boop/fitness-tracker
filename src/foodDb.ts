// Built-in generic food database: USDA FoodData Central, SR Legacy (public domain), built into
// public/foods-db.json. Downloaded on first search, then cached for offline use.
import type { Food, Serving } from "./types";

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
};

type Raw = { categories: string[]; foods: [string, number, number, number, number, number, number, number | null, number | null, number | null, [string, number][]][] };

let loading: Promise<DbFood[]> | null = null;

/** Everyday portions ("1 large", "1 piece", "1 breast") before kitchen measures ("1 tbsp", "1 oz"). */
function portionRank(label: string) {
  const text = label.toLowerCase();
  if (/\b(large|medium|small|piece|slice|breast|thigh|drumstick|wing|fillet|egg|fruit|serving|link|patty|bar|cookie|biscuit|muffin|roll|bun|tortilla|chapati)\b/.test(text)) return 0;
  if (/\bcup\b/.test(text)) return 1;
  if (/\b(tbsp|tablespoon|tsp|teaspoon|oz|lb|fl oz|cubic|yield)\b/.test(text)) return 3;
  return 2;
}

export function loadFoodDb(): Promise<DbFood[]> {
  loading ??= fetch(`${import.meta.env.BASE_URL}foods-db.json`)
    .then((response) => {
      if (!response.ok) throw new Error("The food database couldn't be downloaded.");
      return response.json() as Promise<Raw>;
    })
    .then((raw) =>
      raw.foods.map(([name, cat, kcal, protein, carbs, fat, fiber, sugar, satFat, sodiumMg, portions]) => ({
        name, category: raw.categories[cat] ?? "", kcal, protein, carbs, fat, fiber, sugar, satFat, sodiumMg,
        portions: portions.map(([label, grams]) => ({ label, grams })).sort((a, b) => portionRank(a.label) - portionRank(b.label)),
      })),
    )
    .catch((cause) => {
      loading = null; // allow a retry
      throw cause;
    });
  return loading;
}

// Everyday (incl. Indian) names -> the wording USDA uses.
const SYNONYMS: Record<string, string> = {
  dal: "lentils", daal: "lentils", dhal: "lentils", curd: "yogurt", dahi: "yogurt", chana: "chickpeas", chole: "chickpeas",
  rajma: "kidney", aloo: "potato", gobi: "cauliflower", palak: "spinach", bhindi: "okra", ladyfinger: "okra", brinjal: "eggplant",
  baingan: "eggplant", capsicum: "peppers", methi: "fenugreek", ghee: "butter oil", atta: "wheat flour whole-grain", maida: "wheat flour white",
  roti: "chapati", phulka: "chapati", chapathi: "chapati", mutton: "lamb", prawn: "shrimp", prawns: "shrimp",
  groundnut: "peanuts", peanut: "peanuts", moong: "mung", masoor: "lentils", toor: "pigeon peas", arhar: "pigeon peas",
  jowar: "sorghum", bajra: "millet", ragi: "millet", sooji: "semolina", rava: "semolina", besan: "chickpea flour", oats: "oats",
};

// The everyday version of a few staples, which plain word-matching can't pick out on its own.
const EVERYDAY = [
  /^rice, white, long-grain, regular, enriched, cooked$/,
  /^rice, brown, long-grain, cooked\b/,
  /breast, meat only, cooked, roasted$/,
  /^milk, whole, 3\.25% milkfat, with added vitamin d$/,
  /^yogurt, plain, whole milk$/,
  /^potatoes, boiled, cooked without skin, flesh, without salt$/,
  /^lentils, mature seeds, cooked, boiled, without salt$/,
  /^chickpeas \(garbanzo beans, bengal gram\), mature seeds, cooked, boiled, without salt$/,
  /^egg, whole, cooked, hard-boiled$/,
  /^cereals, oats, regular and quick, not fortified, dry$/,
];

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);

/** Foods whose name contains every search word (after synonyms), best matches first. */
export function searchFoodDb(foods: DbFood[], query: string, limit = 8): DbFood[] {
  const terms = words(query).flatMap((word) => words(SYNONYMS[word] ?? word.replace(/s$/, "")));
  if (!terms.length) return [];
  const asked = (word: string) => terms.some((term) => term.startsWith(word.slice(0, 5)));
  // Search terms are letters/digits/hyphens only (see `words`), so they're safe inside a RegExp.
  const wholeWord = (name: string, term: string) => new RegExp(`\\b${term}s?\\b`).test(name);
  const scored: { food: DbFood; score: number }[] = [];
  for (const food of foods) {
    const name = food.name.toLowerCase();
    if (!terms.every((term) => name.includes(term))) continue;
    const firstPart = name.split(",")[0].trim();
    let score = name.length / 30 + (name.match(/,/g)?.length ?? 0) * 0.8;
    if (firstPart === terms[0] || firstPart === `${terms[0]}s`) score -= 10; // "Chicken, …" for "chicken …"
    else if (firstPart.includes(terms[0])) score -= 6;
    if (/\b[A-Z]{3,}\b/.test(food.name)) score += 4; // brand names are in capitals in USDA data (e.g. "UNCLE BENS")
    if (EVERYDAY.some((pattern) => pattern.test(name))) score -= 5;
    if (name.startsWith(terms[0])) score -= 3;
    if (!terms.every((term) => wholeWord(name, term))) score += 6; // "egg" shouldn't prefer "eggplant"
    // Plain foods before processed or prepared versions, unless you asked for them.
    for (const word of ["breaded", "battered", "frozen", "canned", "commercially", "prepared", "ready-to", "with sauce", "fast food", "dehydrated", "dried"]) if (name.includes(word) && !asked(word)) score += 3;
    if (/\bfried\b/.test(name) && !asked("fried")) score += 2;
    if (name.includes("with salt") && !asked("salt")) score += 1;
    if (/Baby Foods|Fast Foods|Restaurant/.test(food.category) || /baby food|infant formula/.test(name)) score += 10;
    scored.push({ food, score });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((item) => item.food);
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
