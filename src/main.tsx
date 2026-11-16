import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { applyTheme } from "./prefs";
import "./index.css";

// A Home Screen app on iPhone is usually resumed rather than relaunched, so the browser
// rarely re-checks for a new version on its own. Check whenever the app comes to the
// foreground (and every 30 minutes while open). With registerType "autoUpdate", the page
// reloads into the new version as soon as it has downloaded.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => {
      if (navigator.onLine) void registration.update().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
    window.setInterval(check, 30 * 60 * 1000);
  },
});

applyTheme(); // before first paint, so there is no flash of the wrong theme

// The part of the screen actually visible: on iPhone the keyboard shrinks it and may shift
// the page up. Pop-ups size themselves to it so their text boxes stay above the keyboard.
const viewport = window.visualViewport;
if (viewport) {
  const syncViewport = () => {
    const root = document.documentElement.style;
    // Only while the keyboard is up: otherwise iPhone reports a height without the bottom edge,
    // which would leave a strip under the sheet. Without the variables, pop-ups fill the screen.
    if (window.innerHeight - viewport.height > 150 || viewport.offsetTop > 0) {
      root.setProperty("--vv-height", `${viewport.height}px`);
      root.setProperty("--vv-top", `${viewport.offsetTop}px`);
    } else {
      root.removeProperty("--vv-height");
      root.removeProperty("--vv-top");
    }
  };
  syncViewport();
  viewport.addEventListener("resize", syncViewport);
  viewport.addEventListener("scroll", syncViewport);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
