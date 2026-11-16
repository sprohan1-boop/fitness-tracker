// Per-device display preferences (not fitness data, so not part of backups).
import { useSyncExternalStore } from "react";

export type Unit = "kg" | "lb";
export type ThemePref = "system" | "dark" | "light";
export type Prefs = { unit: Unit; theme: ThemePref };

const KEY = "display-prefs";
const DEFAULTS: Prefs = { unit: "kg", theme: "system" };

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULTS;
  } catch {
    return DEFAULTS; // private mode / blocked storage: fall back to defaults
  }
}

let current = read();
const listeners = new Set<() => void>();

export function setPrefs(change: Partial<Prefs>) {
  current = { ...current, ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* preference just won't persist */
  }
  applyTheme();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, () => current);
}

// ---------- theme ----------

const darkQuery = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

export function resolvedTheme(theme: ThemePref = current.theme): "dark" | "light" {
  if (theme !== "system") return theme;
  return darkQuery && !darkQuery.matches ? "light" : "dark";
}

/** Sets data-theme on <html> (CSS variables switch on it) and the browser UI colour. */
export function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#F5F6F2" : "#111614");
}

darkQuery?.addEventListener("change", () => {
  if (current.theme === "system") {
    applyTheme();
    listeners.forEach((listener) => listener());
  }
});

/** Chart colours (SVG attributes can't read CSS variables). */
export function chartColors(theme: "dark" | "light") {
  return theme === "light"
    ? { lime: "#4D7C0F", mint: "#047857", amber: "#B45309", grid: "#DEE2DB", muted: "#626E67", tooltipBg: "#FFFFFF", tooltipBorder: "#DEE2DB", tooltipText: "#141A17", tooltipLabel: "#3C443F", cursor: "rgba(0,0,0,.04)", violet: "#6D28D9", sky: "#0369A1" }
    : { lime: "#C4F36A", mint: "#8BE0B0", amber: "#FCD34D", grid: "#2C3530", muted: "#87938C", tooltipBg: "#202824", tooltipBorder: "#35413A", tooltipText: "#F5F7F2", tooltipLabel: "#B7C0BA", cursor: "rgba(255,255,255,.03)", violet: "#C4B5FD", sky: "#7DD3FC" };
}

// ---------- units (data is always stored in kg) ----------

const LB_PER_KG = 2.2046226218;

/** kg -> number in the chosen unit, rounded for display/editing. */
export function fromKg(kg: number, unit: Unit): number {
  return unit === "lb" ? Math.round(kg * LB_PER_KG * 10) / 10 : kg;
}

/** Number typed in the chosen unit -> kg (kept to 2 decimals). */
export function toKg(value: number, unit: Unit): number {
  return unit === "lb" ? Math.round((value / LB_PER_KG) * 100) / 100 : value;
}

// The kg/lb setting also picks metric or imperial for lengths and distances (stored in cm and km).
const CM_PER_IN = 2.54;
const KM_PER_MI = 1.609344;
export const lengthUnit = (unit: Unit) => (unit === "lb" ? "in" : "cm");
export const distanceUnit = (unit: Unit) => (unit === "lb" ? "mi" : "km");
export const fromCm = (cm: number, unit: Unit) => (unit === "lb" ? Math.round((cm / CM_PER_IN) * 10) / 10 : cm);
export const toCm = (value: number, unit: Unit) => (unit === "lb" ? Math.round(value * CM_PER_IN * 10) / 10 : value);
export const fromKm = (km: number, unit: Unit) => (unit === "lb" ? Math.round((km / KM_PER_MI) * 100) / 100 : km);
export const toKm = (value: number, unit: Unit) => (unit === "lb" ? Math.round(value * KM_PER_MI * 1000) / 1000 : value);
