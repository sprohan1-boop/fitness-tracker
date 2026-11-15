import { Pause, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const PRESETS = [60, 90, 120, 180];
const DURATION_KEY = "rest-timer-seconds";
const AUTO_KEY = "rest-timer-auto";

// Per-device preferences only; the timer works without them (private mode, cleared storage).
function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

// iOS only allows sound from an AudioContext that was resumed inside a tap,
// so callers run this from their click handlers (Add set, preset buttons).
let audio: AudioContext | null = null;
export function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    audio = null;
  }
}

function chime() {
  if (!audio) return;
  const start = audio.currentTime;
  [0, 0.22, 0.44].forEach((offset, index) => {
    const oscillator = audio!.createOscillator();
    const gain = audio!.createGain();
    oscillator.frequency.value = index === 2 ? 1175 : 880;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.35, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.18);
    oscillator.connect(gain).connect(audio!.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.2);
  });
  navigator.vibrate?.([200, 100, 200]); // Android; iPhone Safari ignores this
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** `kick` changes each time a set is added; with auto-start on, that starts a rest. */
export function RestTimer({ kick }: { kick: number }) {
  const [duration, setDuration] = useState(() => readPref(DURATION_KEY, 90));
  const [auto, setAuto] = useState(() => readPref(AUTO_KEY, true));
  // Remaining time is derived from an end timestamp, so it stays correct if iOS pauses the page.
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [done, setDone] = useState(false);
  const firedFor = useRef<number | null>(null);

  function start(seconds = duration) {
    unlockAudio();
    setDuration(seconds);
    writePref(DURATION_KEY, seconds);
    setDone(false);
    setNow(Date.now());
    setEndsAt(Date.now() + seconds * 1000);
  }

  const lastKick = useRef(kick);
  useEffect(() => {
    if (kick === lastKick.current) return;
    lastKick.current = kick;
    if (auto) start();
  }, [kick]); // only react to new sets, not to preference changes

  useEffect(() => {
    if (endsAt === null) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= endsAt && firedFor.current !== endsAt) {
        firedFor.current = endsAt;
        chime();
        setDone(true);
        setEndsAt(null);
      }
    };
    const id = window.setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [endsAt]);

  const remaining = endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - now) / 1000));
  const progress = endsAt === null ? 0 : 1 - remaining / duration;

  return (
    <div className={`sticky bottom-0 -mx-5 mt-2 border-t px-5 pb-1 pt-3 backdrop-blur-xl sm:-mx-6 sm:px-6 ${done ? "border-lime/40 bg-lime/10" : "border-line bg-panel/95"}`}>
      {endsAt !== null ? (
        <div>
          <div className="flex items-center gap-3">
            <Timer size={16} className="shrink-0 text-mint" />
            <span className="text-2xl font-semibold tabular-nums">{clock(remaining)}</span>
            <span className="text-[10px] text-muted">rest</span>
            <div className="ml-auto flex gap-1.5">
              <button type="button" onClick={() => setEndsAt((end) => (end === null ? end : Math.max(Date.now() + 1000, end - 15_000)))} className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-muted">−15s</button>
              <button type="button" onClick={() => setEndsAt((end) => (end === null ? end : end + 15_000))} className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-muted">+15s</button>
              <button type="button" onClick={() => setEndsAt(null)} className="rounded-lg border border-line p-1.5 text-muted" aria-label="Stop timer"><Pause size={14} /></button>
            </div>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-night"><div className="h-full rounded-full bg-mint transition-[width] duration-200" style={{ width: `${progress * 100}%` }} /></div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`mr-1 flex items-center gap-1.5 text-[11px] font-medium ${done ? "text-lime" : "text-muted"}`}><Timer size={14} /> {done ? "Rest done, next set!" : "Rest"}</span>
          {PRESETS.map((seconds) => (
            <button key={seconds} type="button" onClick={() => start(seconds)} className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${seconds === duration ? "border-mint/50 text-mint" : "border-line text-muted"}`}>
              {clock(seconds)}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-[10px] text-muted">
            <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); writePref(AUTO_KEY, e.target.checked); }} className="accent-[#8BE0B0]" />
            Auto after Add set
          </label>
        </div>
      )}
    </div>
  );
}
