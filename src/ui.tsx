// Small building blocks shared by the app's screens and forms.
import { Minus, Plus, X } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import type { Serving } from "./types";
import { formatNumber, normalizeServing } from "./utils";

export function ModalShell({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode }) {
  return (
    // Sized to the visible area (see main.tsx), so the sheet sits just above the iPhone keyboard.
    <div className="fixed inset-x-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-5" style={{ top: "var(--vv-top, 0px)", height: "var(--vv-height, 100dvh)" }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="relative max-h-[calc(var(--vv-height,100dvh)_-_env(safe-area-inset-top)_-_12px)] w-full overflow-y-auto overflow-x-hidden overscroll-contain rounded-t-3xl border border-line bg-panel p-5 pb-[max(env(safe-area-inset-bottom),20px)] shadow-2xl sm:max-h-[94dvh] sm:max-w-[540px] sm:rounded-3xl sm:p-6">
        <div className="mb-5 flex items-start justify-between">
          <div><p className="text-[9px] font-bold tracking-[.2em] text-lime">{eyebrow}</p><h2 className="mt-1.5 text-xl font-semibold">{title}</h2></div>
          <button onClick={onClose} className="rounded-xl border border-line p-2 text-muted transition hover:bg-panel-raised hover:text-white" aria-label="Close"><X size={16} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-medium text-zinc-300">{label}{required && <span className="ml-1 text-red-300">*</span>}</span>{children}</label>;
}

export function NumberField({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <Field label={label} required={required}><input type="number" min="0" step="any" required={required} value={value} onChange={(event) => onChange(event.target.value)} placeholder={required ? "Required" : "Not set"} className="input-dark" /></Field>;
}

export function FormError({ message }: { message: string }) {
  return <p role="alert" className="rounded-xl border border-red-300/15 bg-red-300/5 px-3 py-2 text-[11px] leading-5 text-red-200">{message}</p>;
}

/**
 * An amount as "quantity × unit", where the unit is grams or one of the food's servings
 * (e.g. 2 × "1 biscuit (8.5 g)"). Always reports grams to the parent.
 */
export function AmountInput({ grams, servings: rawServings, onChange, label = "Amount", preferGrams = false }: { grams: string; servings: Serving[]; onChange: (grams: string) => void; label?: string; preferGrams?: boolean }) {
  const servings = rawServings.map(normalizeServing);
  // Start on a serving when the grams are a whole or half number of it (e.g. 17 g = 2 biscuits).
  const initial = (() => {
    const g = Number(grams);
    if (g > 0 && !preferGrams) { // a typed weight ("200g") stays in grams
      for (let i = 0; i < servings.length; i++) {
        const ratio = g / servings[i].grams;
        if (Math.abs(ratio * 2 - Math.round(ratio * 2)) < 0.01) return { unit: i, qty: String(Math.round(ratio * 2) / 2) };
      }
    }
    return { unit: -1, qty: grams };
  })();
  const [unit, setUnit] = useState(initial.unit); // -1 = grams
  const [qty, setQty] = useState(initial.qty);
  const serving = unit >= 0 ? servings[unit] : null;

  function report(nextQty: string, nextUnit: number) {
    const amount = Number(nextQty);
    const per = nextUnit >= 0 ? servings[nextUnit].grams : 1;
    onChange(nextQty.trim() === "" || !Number.isFinite(amount) ? "" : String(Math.round(amount * per * 10) / 10));
  }
  function changeQty(value: string) {
    setQty(value);
    report(value, unit);
  }
  function step(direction: 1 | -1) {
    const size = unit >= 0 ? (Number(qty) % 1 ? 0.5 : 1) : 10;
    const next = Math.max(unit >= 0 ? 0.5 : 1, Math.round(((Number(qty) || 0) + direction * size) * 10) / 10);
    changeQty(String(next));
  }
  function changeUnit(next: number) {
    // Switching to a serving starts at 1 of it; switching to grams keeps the same total.
    const nextQty = next >= 0 ? "1" : grams || "100";
    setUnit(next);
    setQty(nextQty);
    report(nextQty, next);
  }

  return (
    <div>
      <div className="flex gap-2">
        <div className="flex min-w-0 flex-1 items-center rounded-xl border border-line bg-night">
          <button type="button" onClick={() => step(-1)} className="px-3 py-2.5 text-muted" aria-label="Less"><Minus size={15} /></button>
          <input type="number" inputMode="decimal" min="0" step="any" value={qty} onChange={(e) => changeQty(e.target.value)} className="min-w-0 flex-1 bg-transparent py-2 text-center text-sm font-semibold outline-none" aria-label={label} />
          <button type="button" onClick={() => step(1)} className="px-3 py-2.5 text-muted" aria-label="More"><Plus size={15} /></button>
        </div>
        {servings.length > 0 ? (
          <select value={unit} onChange={(e) => changeUnit(Number(e.target.value))} className="input-dark !w-auto max-w-[48%] !px-2.5" aria-label="Unit">
            <option value={-1}>grams</option>
            {servings.map((item, index) => <option key={item.label} value={index}>{item.label.replace(/^1\s+/, "")} ({formatNumber(item.grams)} g)</option>)}
          </select>
        ) : (
          <span className="flex items-center px-2 text-xs text-muted">g</span>
        )}
      </div>
      {serving && Number(qty) > 0 && <p className="mt-1 text-[10px] text-muted">= {formatNumber(Math.round(Number(qty) * serving.grams * 10) / 10)} g</p>}
    </div>
  );
}
