import { Camera, Loader2, ScanBarcode, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FormEvent } from "react";
import type { Serving } from "./types";

export type FoodPrefill = {
  barcode: string;
  name: string;
  brand: string | null;
  // per 100 g; null when Open Food Facts doesn't have the value
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  sugar: number | null;
  satFat: number | null;
  sodiumMg: number | null;
  serving: Serving | null;
};

const num = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 10) / 10 : null;
};

/**
 * Looks a barcode up in Open Food Facts (free, open database: world.openfoodfacts.org).
 * Only the barcode number is sent. Returns null when the product isn't listed.
 */
export async function lookupBarcode(barcode: string): Promise<FoodPrefill | null> {
  const fields = "product_name,product_name_en,brands,nutriments,serving_quantity,serving_size";
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Open Food Facts didn't respond. Check your connection and try again.");
  const body = (await response.json()) as { status?: number; product?: Record<string, unknown> };
  const product = body.product;
  if (body.status !== 1 || !product) return null;
  const n = (product.nutriments ?? {}) as Record<string, unknown>;
  // Some products only list energy in kJ.
  const kcal = num(n["energy-kcal_100g"]) ?? (num(n["energy_100g"]) !== null ? Math.round((num(n["energy_100g"]) as number) / 4.184) : null);
  const servingGrams = num(product.serving_quantity);
  const name = String(product.product_name_en || product.product_name || "").trim();
  return {
    barcode,
    name: name.slice(0, 120),
    brand: String(product.brands ?? "").split(",")[0].trim().slice(0, 120) || null,
    calories: kcal,
    protein: num(n["proteins_100g"]),
    carbs: num(n["carbohydrates_100g"]),
    fat: num(n["fat_100g"]),
    fiber: num(n["fiber_100g"]),
    sugar: num(n["sugars_100g"]),
    satFat: num(n["saturated-fat_100g"]),
    // Open Food Facts lists sodium in grams per 100 g.
    sodiumMg: num(n["sodium_100g"]) === null ? null : Math.round((num(n["sodium_100g"]) as number) * 1000),
    serving: servingGrams ? { label: "1 serving", grams: servingGrams } : null,
  };
}

/** Full-screen camera view that reads a product barcode; also accepts a typed barcode. */
export function BarcodeScanner({ onDetected, onClose }: { onDetected: (barcode: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "error">("starting");
  const [message, setMessage] = useState("");
  const [typed, setTyped] = useState("");

  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        // The scanning library is only downloaded when the scanner opens.
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
        if (cancelled || !video.current) return;
        const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]]]);
        const reader = new BrowserMultiFormatReader(hints);
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } }, audio: false },
          video.current,
          (result) => {
            if (!result) return;
            controls.stop();
            onDetected(result.getText());
          },
        );
        stop = () => controls.stop();
        if (cancelled) stop();
        else setStatus("scanning");
      } catch (cause) {
        if (cancelled) return;
        setStatus("error");
        const name = cause instanceof DOMException ? cause.name : "";
        setMessage(
          name === "NotAllowedError"
            ? "Camera access is blocked. Allow the camera for this app (iPhone Settings → Safari → Camera), or type the barcode below."
            : "The camera couldn't start. You can type the barcode below.",
        );
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [onDetected]);

  function submitTyped(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation(); // don't also submit the food form this scanner was opened from
    const digits = typed.replace(/\D/g, "");
    if (digits.length >= 8) onDetected(digits);
  }

  // Rendered at <body> level: the scanner has its own <form>, which must not sit inside the food form.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#000] pb-[max(env(safe-area-inset-bottom),16px)] pt-[env(safe-area-inset-top)] text-[#fff]">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold"><ScanBarcode size={18} /> Scan a barcode</p>
        <button onClick={onClose} className="rounded-xl border border-[#fff]/20 p-2" aria-label="Close scanner"><X size={18} /></button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={video} playsInline muted className="h-full w-full object-cover" />
        {/* Aiming guide */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-36 w-[78%] max-w-sm rounded-2xl border-2 border-[#C4F36A] shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        </div>
        <p className="absolute inset-x-0 bottom-4 px-6 text-center text-xs text-[#fff]/80">
          {status === "starting" ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Starting camera…</span> : status === "scanning" ? "Hold the barcode inside the box" : message}
        </p>
        {status === "error" && <Camera size={40} className="absolute left-1/2 top-1/3 -translate-x-1/2 opacity-30" />}
      </div>
      <form onSubmit={submitTyped} className="flex gap-2 px-4 pt-3">
        <input value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="numeric" placeholder="Or type the barcode number" className="min-h-11 w-full rounded-xl border border-[#fff]/20 bg-[#fff]/10 px-3 text-sm text-[#fff] outline-none placeholder:text-[#fff]/50" />
        <button disabled={typed.replace(/\D/g, "").length < 8} className="rounded-xl bg-[#C4F36A] px-4 text-xs font-bold text-[#111614] disabled:opacity-50">Look up</button>
      </form>
    </div>,
    document.body,
  );
}
