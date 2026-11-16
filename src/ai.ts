// Optional AI features using Claude Haiku 5.5, called straight from this device with YOUR OWN
// Anthropic API key (stored only on this device, never in backups or the app's code).
// The SDK is loaded on first use so it isn't part of the app's first download.
import type Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-5-5";
const KEY_STORAGE = "anthropic-api-key";

export function getApiKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}
export function setApiKey(key: string | null) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* storage blocked: AI stays off */
  }
}
export const hasApiKey = () => Boolean(getApiKey());

async function sdk() {
  return (await import("@anthropic-ai/sdk")).default;
}

async function client(): Promise<Anthropic> {
  const key = getApiKey();
  if (!key) throw new Error("Add your Anthropic API key in Settings → AI first.");
  const Sdk = await sdk();
  // Browser use is allowed here because the key is the user's own and lives only on their device.
  return new Sdk({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

/** Turns SDK errors into short, actionable messages. */
export async function friendlyError(error: unknown): Promise<string> {
  const Sdk = await sdk();
  if (error instanceof Sdk.AuthenticationError) return "Your API key was rejected. Check it in Settings → AI.";
  if (error instanceof Sdk.PermissionDeniedError) return "This API key isn't allowed to use Claude Haiku 5.5.";
  if (error instanceof Sdk.RateLimitError) return "Too many requests right now, or your credit or spend limit was reached. Try again shortly.";
  if (error instanceof Sdk.APIConnectionError) return "Couldn't reach the AI. Check your internet connection.";
  if (error instanceof Sdk.BadRequestError) return `The AI couldn't process that: ${error.message}`;
  if (error instanceof Sdk.APIError) return `AI error (${error.status ?? "?"}). Try again.`;
  return error instanceof Error ? error.message : "Something went wrong with the AI request.";
}

function firstText(message: Anthropic.Message): string {
  for (const block of message.content) if (block.type === "text") return block.text;
  return "";
}

function checkStop(message: Anthropic.Message) {
  if (message.stop_reason === "refusal") throw new Error("The AI declined this request.");
  if (message.stop_reason === "max_tokens") throw new Error("The AI's answer was cut off. Try a shorter description.");
}

/** A tiny request to confirm the key works (costs a fraction of a paisa). */
export async function testApiKey(): Promise<void> {
  const ai = await client();
  const message = await ai.messages.create({
    model: MODEL,
    max_tokens: 1000,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: "Reply with just: OK" }],
  });
  checkStop(message);
}

// ---------- meal estimates ----------

export type AiFoodItem = {
  name: string;
  grams: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  confidence: "high" | "medium" | "low";
  note: string;
};

const NUMBER = { type: "number" } as const;
// The model gives per-100 g values and the edible weight; the app does the arithmetic (small models
// slip on multiplication) and checks calories against the macros.
const MEAL_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short everyday name, e.g. 'Chicken curry (meat only)' or 'Chapati'" },
          edible_grams: { ...NUMBER, description: "Weight actually eaten in grams, after removing bones or anything the user excluded" },
          kcal_per_100g: NUMBER,
          protein_per_100g: NUMBER,
          carbs_per_100g: NUMBER,
          fat_per_100g: NUMBER,
          fiber_per_100g: NUMBER,
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          note: { type: "string", description: "One short line on key assumptions, e.g. '200 g with bone = ~140 g meat; 1 tsp oil'. Empty if none." },
        },
        required: ["name", "edible_grams", "kcal_per_100g", "protein_per_100g", "carbs_per_100g", "fat_per_100g", "fiber_per_100g", "confidence", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const MEAL_SYSTEM = `You estimate the nutrition of food for a personal food log. The user often eats Indian home cooking: assume typical Indian home recipes and portions (a katori is about 150 g, a chapati about 40 g, a cup of chai about 150 ml with milk and sugar) unless told otherwise.

Return one item per distinct food, with the edible weight eaten and nutrition per 100 g of that food as eaten (cooked, with its share of oil). The app multiplies them out.

Rules:
- Weights "with bone" / "bone-in" include bone. Edible part: chicken curry or tandoori pieces about 70%, drumsticks about 65%, wings about 50%, mutton on the bone about 65%, fish steaks about 80%. Report edible_grams for the meat only and say so in note.
- If the user excludes the curry/gravy, count only the solid pieces (with oil absorbed in cooking). Otherwise include a typical amount of gravy as a separate item or within the dish, and say which.
- Per-100 g values must be realistic for the cooked food: cooked skinless chicken is roughly 25-31 g protein per 100 g; calories should roughly equal 4 x protein + 4 x carbs + 9 x fat.
- When reference values from a food database are given, use them as the base and adjust only for cooking method, oil and recipe.
- If a portion or recipe is uncertain, choose the most likely option, set confidence accordingly, and state the assumption briefly in note. Do not invent foods that aren't described or visible.`;

type RawItem = { name: string; edible_grams: number; kcal_per_100g: number; protein_per_100g: number; carbs_per_100g: number; fat_per_100g: number; fiber_per_100g: number; confidence: AiFoodItem["confidence"]; note: string };

function toItems(message: Anthropic.Message): AiFoodItem[] {
  checkStop(message);
  const parsed = JSON.parse(firstText(message)) as { items: RawItem[] };
  return parsed.items
    .filter((item) => item.edible_grams > 0 && item.kcal_per_100g >= 0)
    .map((item) => {
      const f = item.edible_grams / 100;
      const protein = Math.max(0, item.protein_per_100g);
      const carbs = Math.max(0, item.carbs_per_100g);
      const fat = Math.max(0, item.fat_per_100g);
      // Calories should match the macros (4/4/9); if the model's figure is far off, trust the macros.
      const fromMacros = protein * 4 + carbs * 4 + fat * 9;
      const kcal100 = fromMacros > 0 && Math.abs(item.kcal_per_100g - fromMacros) > fromMacros * 0.2 ? fromMacros : item.kcal_per_100g;
      return {
        name: item.name,
        grams: Math.round(item.edible_grams),
        kcal: Math.round(kcal100 * f),
        protein_g: Math.round(protein * f * 10) / 10,
        carbs_g: Math.round(carbs * f * 10) / 10,
        fat_g: Math.round(fat * f * 10) / 10,
        fiber_g: Math.round(Math.max(0, item.fiber_per_100g) * f * 10) / 10,
        confidence: item.confidence,
        note: item.note,
      };
    });
}

/** A database food the model can anchor on (values per 100 g). */
export type AiReference = { name: string; kcal: number; protein: number; carbs: number; fat: number };

/** Estimates foods from a typed description, e.g. "chicken curry 200g with bone". */
export async function estimateMealFromText(description: string, references: AiReference[] = []): Promise<AiFoodItem[]> {
  const ai = await client();
  const reference = references.length
    ? `\n\nReference values from the USDA food database (per 100 g), for the closest plain foods:\n${references
        .map((r) => `- ${r.name}: ${Math.round(r.kcal)} kcal, ${r.protein} g protein, ${r.carbs} g carbs, ${r.fat} g fat`)
        .join("\n")}`
    : "";
  const message = await ai.messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: MEAL_SCHEMA } },
    system: MEAL_SYSTEM,
    messages: [{ role: "user", content: `What I ate: ${description}${reference}` }],
  });
  return toItems(message);
}

/** Estimates foods from a meal photo (JPEG, base64 without the data: prefix). */
export async function estimateMealFromPhoto(jpegBase64: string, note: string): Promise<AiFoodItem[]> {
  const ai = await client();
  const message = await ai.messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: MEAL_SCHEMA } },
    system: `${MEAL_SYSTEM}\nFor photos, judge portions from visual cues such as plate size (a dinner plate is about 26 cm), bowls and cutlery.`,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
        { type: "text", text: note.trim() ? `Estimate this meal. Extra details: ${note.trim()}` : "Estimate this meal." },
      ],
    }],
  });
  return toItems(message);
}

/** Shrinks a photo to at most 1024 px on its longest side (fewer tokens, faster upload). */
export async function photoToJpegBase64(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
}

// ---------- coach ----------

const COACH_SYSTEM = `You are a friendly, practical fitness and nutrition coach inside the user's personal tracker app. You get a snapshot of their recent data (food, training, sleep, steps, weight, goals) below.
- Base answers on their actual numbers; quote the key figures you used.
- Be concise: a few short paragraphs or a short list, suited to a phone screen. Plain text with simple "-" bullets; no tables or headings.
- Suggest practical, specific actions. Indian food suggestions are welcome when relevant.
- If data is missing for a question, say what to log. Don't invent data.
- You give general wellness guidance, not medical advice. For pain, illness, medication, pregnancy, eating disorders or very low-calorie diets, suggest seeing a doctor or dietitian.`;

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Streams a coach reply; `onText` receives each new piece of text. Returns the full reply. */
export async function askCoach(history: ChatTurn[], snapshot: string, onText: (delta: string) => void): Promise<string> {
  const ai = await client();
  const stream = ai.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    system: [
      { type: "text", text: COACH_SYSTEM },
      { type: "text", text: `The user's data (today is ${new Date().toDateString()}):\n${snapshot}` },
    ],
    messages: history.map((turn) => ({ role: turn.role, content: turn.content })),
  });
  stream.on("text", onText);
  const message = await stream.finalMessage();
  checkStop(message);
  return firstText(message);
}
