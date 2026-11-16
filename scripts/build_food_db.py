"""Builds a compact generic-food database from USDA FoodData Central SR Legacy (public domain).

Usage: python -I build_food_db.py <sr_legacy.zip> <output.json>
Output: {"v":1,"source":..., "categories":[...], "foods":[[name, cat, kcal, protein, carbs, fat, fiber, sugar, satfat, sodium_mg, [[label, grams], ...]], ...]}
All nutrient values are per 100 g; null when USDA has no value.
"""
import json
import sys
import zipfile

# SR nutrient numbers
NUTRIENTS = {"208": "kcal", "203": "protein", "205": "carbs", "204": "fat", "291": "fiber", "269": "sugar", "606": "satfat", "307": "sodium"}
ORDER = ["kcal", "protein", "carbs", "fat", "fiber", "sugar", "satfat", "sodium"]


def round1(value):
    return None if value is None else round(float(value), 1)


def main(zip_path, out_path):
    with zipfile.ZipFile(zip_path) as archive, archive.open(archive.infolist()[0]) as handle:
        data = json.load(handle)
    foods = data["SRLegacyFoods"]
    categories, cat_index, rows = [], {}, []
    for food in foods:
        values = {}
        for item in food.get("foodNutrients", []):
            number = str(item.get("nutrient", {}).get("number", ""))
            if number in NUTRIENTS and "amount" in item:
                values[NUTRIENTS[number]] = item["amount"]
        if values.get("kcal") is None:
            continue
        for key in ("protein", "carbs", "fat", "fiber"):
            values.setdefault(key, 0)
        category = (food.get("foodCategory") or {}).get("description", "Other")
        if category not in cat_index:
            cat_index[category] = len(categories)
            categories.append(category)
        portions = []
        for portion in food.get("foodPortions", []):
            grams = portion.get("gramWeight")
            if not grams or grams <= 0:
                continue
            amount = portion.get("amount") or 1
            modifier = (portion.get("modifier") or portion.get("portionDescription") or "").strip()
            if not modifier:
                continue
            label = f"{amount:g} {modifier}"[:40]
            if label not in [p[0] for p in portions]:
                portions.append([label, round(float(grams), 1)])
            if len(portions) >= 6:
                break
        row = [food["description"].strip(), cat_index[category]]
        row += [round1(values.get(key)) if key != "sodium" else (None if values.get(key) is None else round(float(values[key]))) for key in ORDER]
        row.append(portions)
        rows.append(row)
    rows.sort(key=lambda row: row[0].lower())
    out = {
        "v": 1,
        "source": "USDA FoodData Central, SR Legacy (April 2018). Public domain.",
        "categories": categories,
        "foods": rows,
    }
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(out, handle, separators=(",", ":"), ensure_ascii=False)
    print(f"{len(rows)} foods, {len(categories)} categories")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
