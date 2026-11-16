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
const MEAL_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short everyday name, e.g. 'Dal tadka' or 'Chapati'" },
          grams: { ...NUMBER, description: "Estimated weight eaten, in grams" },
          kcal: { ...NUMBER, description: "Calories for that amount" },
          protein_g: NUMBER,
          carbs_g: NUMBER,
          fat_g: NUMBER,
          fiber_g: NUMBER,
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          note: { type: "string", description: "One short line on assumptions, e.g. 'assumed 1 tsp ghee'. Empty if none." },
        },
        required: ["name", "grams", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "confidence", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const MEAL_SYSTEM = `You estimate the nutrition of food for a personal food log. The user is often eating Indian home cooking, so assume typical Indian home recipes and portions (a katori is about 150 g, a chapati about 40 g, a cup of chai about 150 ml with milk and sugar) unless they say otherwise.
Return one item per distinct food. Give the amount actually eaten in grams and the nutrition totals for that amount (not per 100 g). If a portion or recipe is uncertain, choose the most likely option, set confidence accordingly, and state the assumption briefly in note. Do not invent foods that aren't described or visible.`;

function toItems(message: Anthropic.Message): AiFoodItem[] {
  checkStop(message);
  const parsed = JSON.parse(firstText(message)) as { items: AiFoodItem[] };
  return parsed.items.filter((item) => item.grams > 0 && item.kcal >= 0);
}

/** Estimates foods from a typed description, e.g. "dal makhani and 2 butter naan". */
export async function estimateMealFromText(description: string): Promise<AiFoodItem[]> {
  const ai = await client();
  const message = await ai.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: { type: "json_schema", schema: MEAL_SCHEMA } },
    system: MEAL_SYSTEM,
    messages: [{ role: "user", content: `What I ate: ${description}` }],
  });
  return toItems(message);
}

/** Estimates foods from a meal photo (JPEG, base64 without the data: prefix). */
export async function estimateMealFromPhoto(jpegBase64: string, note: string): Promise<AiFoodItem[]> {
  const ai = await client();
  const message = await ai.messages.create({
    model: MODEL,
    max_tokens: 4000,
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
