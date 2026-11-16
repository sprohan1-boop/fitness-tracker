// Small building blocks shared by the app's screens and forms.
import { X } from "lucide-react";
import type { ReactNode } from "react";

export function ModalShell({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="relative max-h-[calc(100dvh_-_env(safe-area-inset-top)_-_12px)] w-full overflow-y-auto overflow-x-hidden overscroll-contain rounded-t-3xl border border-line bg-panel p-5 pb-[max(env(safe-area-inset-bottom),20px)] shadow-2xl sm:max-h-[94dvh] sm:max-w-[540px] sm:rounded-3xl sm:p-6">
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
