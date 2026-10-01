import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/shell.css";
import "./styles/screens.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline-first: cache the app shell so repeat visits open instantly (production builds only).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", async () => {
    const hadController = !!navigator.serviceWorker.controller;
    try {
      await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
      // A new version took over while this page was open: offer a reload instead of leaving a stale tab.
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) window.dispatchEvent(new Event("rm:update-ready")); });
    } catch { /* the app works fine without it */ }
  });
}
