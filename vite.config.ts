import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves the app from /<repo-name>/; the deploy workflow sets BASE_PATH.
const base = process.env.BASE_PATH || "/";

// e.g. "2026-11-16 12:05 UTC": shown in Settings so you can tell which version the phone runs.
const version = `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false, // registered in src/main.tsx, with foreground update checks
      workbox: {
        // The ~1 MB food database isn't pre-downloaded with every update; it's cached the first
        // time you search, then works offline (refreshed in the background when online).
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith("/foods-db.json"),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "food-database", expiration: { maxEntries: 1 } },
          },
        ],
      },
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Fitness Tracker",
        short_name: "Fitness",
        description: "A personal diet and workout tracker. Data stays on your device.",
        theme_color: "#111614",
        background_color: "#111614",
        display: "standalone",
        start_url: base,
        scope: base,
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
  },
});
