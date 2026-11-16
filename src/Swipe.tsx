import { Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode, TouchEvent } from "react";

const REVEAL = 88; // px of red "Delete" area shown while swiping
const TRIGGER = 120; // swipe further than this and release to delete

/**
 * Swipe left to delete, like iOS lists: drag partly to reveal a Delete button, or swipe all
 * the way to delete straight away. Deleting is undoable (the caller shows an Undo toast),
 * so there is no "Are you sure?" pop-up.
 */
export function SwipeToDelete({ onDelete, children, className = "", contentClassName = "bg-panel", label = "Delete" }: { onDelete: () => void; children: ReactNode; className?: string; contentClassName?: string; label?: string }) {
  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);
  const start = useRef<{ x: number; y: number; base: number } | null>(null);
  const horizontal = useRef<boolean | null>(null);
  const moved = useRef(false);

  function onTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    start.current = { x: touch.clientX, y: touch.clientY, base: offset };
    horizontal.current = null;
    moved.current = false;
    setAnimating(false);
  }

  function onTouchMove(event: TouchEvent) {
    if (!start.current) return;
    const touch = event.touches[0];
    const dx = touch.clientX - start.current.x;
    const dy = touch.clientY - start.current.y;
    // Decide once per gesture whether this is a sideways swipe or a normal vertical scroll.
    if (horizontal.current === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      horizontal.current = Math.abs(dx) > Math.abs(dy);
    }
    if (!horizontal.current) return;
    moved.current = true;
    setOffset(Math.min(0, Math.max(-220, start.current.base + dx)));
  }

  function onTouchEnd() {
    if (!start.current) return;
    start.current = null;
    setAnimating(true);
    if (!horizontal.current) return;
    if (offset <= -TRIGGER) {
      setOffset(-window.innerWidth);
      window.setTimeout(onDelete, 160);
    } else {
      setOffset(offset < -REVEAL / 2 ? -REVEAL : 0);
    }
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {offset < 0 && (
      <button
        type="button"
        onClick={onDelete}
        className="absolute inset-y-0 right-0 flex items-center justify-end gap-1.5 rounded-[inherit] bg-red-400 pr-5 text-xs font-semibold text-[#fff]"
        style={{ width: Math.max(REVEAL, -offset) }}
      >
        <Trash2 size={15} /> {label}
      </button>
      )}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        // A swipe shouldn't also count as a tap on whatever is underneath the finger.
        onClickCapture={(event) => {
          if (moved.current) { event.preventDefault(); event.stopPropagation(); moved.current = false; }
          else if (offset) { event.preventDefault(); event.stopPropagation(); setAnimating(true); setOffset(0); }
        }}
        className={`relative touch-pan-y ${contentClassName}`}
        style={{ transform: `translateX(${offset}px)`, transition: animating ? "transform 0.18s ease-out" : "none" }}
      >
        {children}
      </div>
    </div>
  );
}
