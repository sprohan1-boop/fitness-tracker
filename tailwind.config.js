/** @type {import('tailwindcss').Config} */
// Colours are CSS variables (see src/index.css) so one set of classes serves both the dark and
// light themes. `<alpha-value>` keeps opacity modifiers like bg-lime/10 working.
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        night: v("night"),
        panel: v("panel"),
        "panel-raised": v("panel-raised"),
        line: v("line"),
        muted: v("muted"),
        lime: v("lime"),
        mint: v("mint"),
        white: v("fg"), // "text-white" means the main text colour in either theme
        zinc: { 200: v("zinc-200"), 300: v("zinc-300"), 500: v("zinc-500") },
        red: { 100: v("red-100"), 200: v("red-200"), 300: v("red-300"), 400: v("red-400") },
        amber: { 100: v("amber-100"), 200: v("amber-200"), 300: v("amber-300") },
        sky: { 300: v("sky-300") },
        violet: { 300: v("violet-300") },
      },
      boxShadow: {
        glow: "0 0 34px rgb(var(--c-lime) / 0.12)",
      },
    },
  },
  plugins: [],
};
