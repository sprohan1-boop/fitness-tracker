/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        night: "#111614",
        panel: "#191F1C",
        "panel-raised": "#202824",
        line: "#2C3530",
        muted: "#87938C",
        lime: "#C4F36A",
        mint: "#8BE0B0",
      },
      boxShadow: {
        glow: "0 0 34px rgba(196, 243, 106, 0.12)",
      },
    },
  },
  plugins: [],
};
