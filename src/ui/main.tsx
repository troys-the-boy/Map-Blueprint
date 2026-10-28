// App entry point.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { store } from "./store";
import { sketchEditor } from "./sketchEditor";
import { canvasRef } from "./components/MapCanvas";
import "./styles.css";

// Bring back the last session from browser storage, if there is one.
const restored = store.restoreAutosave();
if (restored) {
  const when = new Date(restored.savedAt).toLocaleString();
  store.setNotice({
    kind: "info",
    text: restored.dirty
      ? `Restored your work from ${when} (browser autosave). It hasn't been saved to a file yet: use Save to keep it.`
      : `Reopened your project from ${when}.`,
  });
}

// Development only: expose the state for debugging in the browser console.
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__g3mb = { store, canvasRef, sketchEditor };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The hosted (installable) build registers a service worker so it works offline.
// The standalone single-file build has no service worker and doesn't need one.
if (import.meta.env.MODE === "web" && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  // The page opens from the offline copy, so right after an update it's still the
  // old version. When the new version has downloaded and taken over, say so.
  const hadVersion = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadVersion)
      store.setNotice({ kind: "info", text: "A new version of the app has downloaded. Reload the page (on iPad: close the app and open it again) to use it. Your work is kept." });
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Offline support unavailable; the app still works while online.
    });
  });
}
