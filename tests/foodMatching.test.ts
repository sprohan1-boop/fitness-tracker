// Food matching tests: run on every build (npm run build), so a change that makes the quick log
// pick the wrong food fails the deploy instead of reaching the phone.
//
// To add a case: put the text in EXPECT with a pattern the chosen food's name must match, or NOT_PICKED
// if no database food is right (the app should then show near matches / ask the AI).
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseFoodDb, queryTerms, tokens } from "../src/foodDb";
import { choiceName, classify, nutritionFor, parseItem, quickLog } from "../src/quickLog";
import type { QuickLine } from "../src/quickLog";

const db = parseFoodDb(JSON.parse(readFileSync("public/foods-db.json", "utf-8")));
const line = (text: string): QuickLine => quickLog(text, [], db)[0];
const picked = (text: string) => { const l = line(text); return l.choice ? choiceName(l.choice) : null; };

// Text -> pattern the picked food's name must match.
const EXPECT: Record<string, RegExp> = {
  "black coffee": /^Beverages, coffee, brewed/,
  "filter coffee": /^Beverages, coffee, brewed/,
  coffee: /^Beverages, coffee, brewed/,
  "green tea": /^Beverages, tea, green/,
  tea: /^Beverages, tea, black, brewed/,
  milk: /^Milk, whole/,
  "toned milk": /^Milk, reduced fat.*2%/,
  "skimmed milk": /^Milk, nonfat/,
  buttermilk: /^Milk, buttermilk/,
  "2 roti": /chapati or roti/,
  "1 chapati": /chapati or roti/,
  paratha: /^Bread, paratha/,
  naan: /^Bread, naan/,
  rice: /^Rice, white, long-grain, regular, enriched, cooked$/,
  "brown rice": /^Rice, brown, .*cooked/,
  "1 bowl dal": /^Lentils, .*cooked/,
  "moong dal": /^Mung beans, .*cooked/,
  rajma: /^Beans, kidney, .*cooked/,
  chole: /^Chickpeas.*cooked/,
  chana: /^Chickpeas.*cooked/,
  curd: /^Yogurt, plain, whole milk$/,
  dahi: /^Yogurt, plain/,
  "greek yogurt": /^Yogurt, Greek/,
  "chicken breast": /^Chicken, .*breast.*cooked/,
  "grilled chicken": /^Chicken, .*cooked, grilled/,
  mutton: /^Game meat, goat, cooked/,
  salmon: /^Fish, salmon, .*cooked/,
  tuna: /^Fish, tuna, light, canned in water/,
  prawns: /^Crustaceans, shrimp, cooked/,
  egg: /^Egg, whole, cooked/,
  "2 boiled eggs": /^Egg, whole, cooked, hard-boiled/,
  omelette: /^Egg, whole, cooked, omelet/,
  "scrambled eggs": /^Egg, whole, cooked, scrambled/,
  "egg white": /^Egg, white/,
  bread: /^Bread, white/,
  "brown bread": /^Bread, whole-wheat, commercially prepared$/,
  butter: /^Butter, salted$/,
  ghee: /^Butter oil/,
  "1 tbsp oil": /^Oil, /,
  "olive oil": /^Oil, olive/,
  "peanut butter": /^Peanut butter/i,
  "2 biscuits": /^Cookies, Marie biscuit$/,
  banana: /^Bananas, raw$/,
  apple: /^Apples, raw/,
  orange: /^Oranges, raw/,
  "orange juice": /^Orange juice/,
  "apple juice": /^Apple juice/,
  grapes: /^Grapes, red or green/,
  mango: /^Mangos, raw/,
  chikoo: /^Sapodilla/,
  kiwi: /^Kiwifruit/,
  almonds: /^Nuts, almonds$/,
  badam: /^Nuts, almonds$/,
  cashews: /^Nuts, cashew nuts/,
  kaju: /^Nuts, cashew nuts/,
  walnuts: /^Nuts, walnuts/,
  peanuts: /^Peanuts, /,
  coconut: /^Nuts, coconut meat/,
  "coconut water": /coconut water/,
  oats: /^(Oats\b|Cereals, oats, regular and quick)/,
  coke: /^Beverages, carbonated, cola/,
  beer: /^Alcoholic beverage, beer/,
  "red wine": /^Alcoholic beverage, wine, table, red$/,
  whisky: /^Alcoholic beverage, distilled.*whiskey/,
  "ice cream": /^Ice creams, vanilla$/,
  "dark chocolate": /^Chocolate, dark/,
  pasta: /^Pasta, cooked/,
  potato: /^Potatoes, boiled/,
  "sweet potato": /^Sweet potato, cooked/,
  "french fries": /^Potatoes, french fried/,
  bhindi: /^Okra/,
  tomato: /^Tomatoes, red, ripe, raw/,
  onion: /^Onions, raw$/,
  carrot: /^Carrots, raw$/,
  mushroom: /^Mushrooms, white, raw$/,
  sprouts: /^Mung beans, mature seeds, sprouted/,
  tofu: /^Tofu, raw, firm/,
  sugar: /^Sugars, granulated$/,
  honey: /^Honey$/,
  "black beans": /^Beans, black, mature seeds, cooked/,
  "green peas": /^Peas, green/,
  cheese: /^Cheese, cheddar/,
  "cheese slice": /^Cheese, cheddar/,
  mayonnaise: /^Salad dressing, mayonnaise, regular$/,
  ketchup: /^Catsup$/,
  pizza: /^Pizza, cheese topping/,
};

// No database food is right for these: they must never be auto-picked (the app asks or uses AI).
const NOT_PICKED = [
  "chai", "masala chai", "chai with sugar", "cold coffee", "chicken curry", "butter chicken", "tandoori chicken", "chicken tikka",
  "chicken 65", "mutton curry", "fish curry", "dal tadka", "dal makhani", "aloo paratha", "jeera rice", "fried rice", "biryani",
  "chicken biryani", "paneer", "paneer butter masala", "palak paneer", "raita", "idli", "dosa", "masala dosa", "sambar", "upma",
  "poha", "khichdi", "samosa", "pakora", "lassi", "gulab jamun", "jalebi", "kheer", "halwa", "aloo sabzi", "salad", "sandwich",
  "burger", "pickle", "soya chunks", "maggi",
];

// Picks that would be wrong: text -> pattern the picked food must NOT match.
const NEVER: Record<string, RegExp> = {
  "black coffee": /blackberr/i, black: /blackberr/i, egg: /eggplant/i, peas: /peanut/i, almonds: /milk/i, walnuts: /^Oil/,
  beer: /beerwurst/i, "red wine": /vinegar/i, rajma: /liquid/i, coconut: /water/i, pork: /skins/i, beef: /separable fat/i,
  bread: /^Bread, egg/, "brown bread": /boston/i, "french fries": /^Sweet/, poha: /groundcherr/i, tea: /herbal/i,
  "orange juice": /pineapple/i, "1 tbsp oil": /^Oil, oat/, sugar: /brown/i,
};

describe("picks the right food", () => {
  for (const [text, pattern] of Object.entries(EXPECT)) {
    test(text, () => expect(picked(text)).toMatch(pattern));
  }
});

describe("doesn't guess when the database doesn't have it", () => {
  for (const text of NOT_PICKED) {
    test(text, () => expect(picked(text)).toBeNull());
  }
});

describe("never picks a look-alike", () => {
  for (const [text, pattern] of Object.entries(NEVER)) {
    test(text, () => expect(picked(text) ?? "").not.toMatch(pattern));
  }
});

// Rules checked on every food in tests/everyday-foods.txt (200+ everyday Indian and general foods).
const everyday = readFileSync("tests/everyday-foods.txt", "utf-8").split("\n").map((text) => text.trim()).filter(Boolean);
describe("rules for every everyday food", () => {
  for (const text of everyday) {
    test(text, () => {
      for (const result of quickLog(text, [], db)) {
        if (!result.choice || result.choice.kind !== "db") continue;
        const name = new Set(tokens(result.choice.item.name));
        // 1. Every word that says what the food is appears in the name as a WHOLE word (after
        //    translation): no "black" -> "Blackberries", no "chicken curry" -> "Chicken".
        const { required } = classify(parseItem(result.text).foodText);
        expect(queryTerms(required.join(" ")).every((word) => name.has(word)), `${result.text} -> ${result.choice.item.name}`).toBe(true);
        // 2. The default amount is a plausible serving: under ~600 kcal and 600 g unless asked for more.
        if (!parseItem(result.text).counted && !result.unit) {
          const grams = Number(result.grams);
          expect(grams, `${result.text}: ${grams} g`).toBeGreaterThan(0);
          expect(grams, `${result.text}: ${grams} g`).toBeLessThanOrEqual(600);
          expect(nutritionFor(result.choice, grams).kcal, `${result.text}: ${grams} g`).toBeLessThanOrEqual(600);
        }
      }
    });
  }
});

describe("amounts", () => {
  const grams = (text: string) => Number(line(text).grams);
  test("counts use the food's own unit", () => {
    expect(grams("2 eggs")).toBe(100);
    expect(grams("10 almonds")).toBe(12);
    expect(grams("2 roti")).toBe(136);
  });
  test("units anywhere in the text", () => {
    expect(grams("200g chicken breast")).toBe(200);
    expect(grams("1 katori rajma")).toBe(150);
    expect(grams("1 glass milk")).toBe(244);
    expect(grams("half banana")).toBe(63);
    expect(grams("cheese slice")).toBe(28);
  });
  test("bare words get a real serving, not one almond or a whole cabbage", () => {
    expect(grams("almonds")).toBeGreaterThanOrEqual(20);
    expect(grams("grapes")).toBeGreaterThanOrEqual(80);
    expect(grams("cabbage")).toBeLessThanOrEqual(150);
    expect(grams("butter")).toBeLessThanOrEqual(15);
    expect(grams("sugar")).toBeLessThanOrEqual(13);
    expect(grams("salmon")).toBeGreaterThanOrEqual(80);
    expect(grams("black coffee")).toBe(237); // a cup, though it has almost no calories
    expect(grams("green tea")).toBeGreaterThanOrEqual(200);
    expect(grams("spinach")).toBeGreaterThanOrEqual(30);
  });
  test("bone-in weights count the meat", () => {
    const result = line("chicken breast 200g with bone");
    expect(Number(result.grams)).toBe(140);
    expect(result.note).toMatch(/bone/);
  });
  test("left-out describing words are reported", () => {
    expect(line("black coffee").note).toMatch(/without “black”/);
    expect(line("tea without sugar").note).toMatch(/sugar/);
  });
  test("several foods in one line", () => {
    expect(quickLog("2 roti, 1 bowl dal and black coffee", [], db).map((result) => result.choice && choiceName(result.choice))).toEqual([
      expect.stringMatching(/roti/), expect.stringMatching(/^Lentils/), expect.stringMatching(/coffee/),
    ]);
  });
});

describe("your own foods", () => {
  const food = (name: string) => ({ id: name, name, brand: null, preparation: "unspecified", calories_per_100g: 100, protein_g_per_100g: 1, carbohydrates_g_per_100g: 1, fat_g_per_100g: 1, fiber_g_per_100g: 0, sugar_g_per_100g: null, sat_fat_g_per_100g: null, sodium_mg_per_100g: null, servings: [], notes: "", source: "user-entered", is_verified: false }) as never;
  test("are matched first, by whole words", () => {
    const library = [food("Masala chai"), food("Blackberry jam")];
    expect(choiceName(quickLog("masala chai", library, db)[0].choice!)).toBe("Masala chai");
    expect(choiceName(quickLog("chai", library, db)[0].choice!)).toBe("Masala chai");
    expect(quickLog("black coffee", library, db)[0].choice && choiceName(quickLog("black coffee", library, db)[0].choice!)).not.toBe("Blackberry jam");
  });
});
