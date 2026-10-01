import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/shell.css";
import "./styles/screens.css";
import App from "./App.jsx";

function savedSession() {
  try { return !!localStorage.getItem("retailmind_token"); } catch { return false; }
}

const container = document.getElementById("root");
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);
// The build places the landing page's HTML in #root. A visit that shows the landing page adopts it (hydrates);
// a visit that doesn't (saved session, deep link: index.html marks those data-boot="app") renders from scratch.
// "Where the visit is" is read now, not at page start: a link on the pre-rendered page may already have been used.
const onLanding = (!location.hash || location.hash === "#" || location.hash === "#/") && !savedSession();
if (container.hasAttribute("data-prerendered") && onLanding) {
  hydrateRoot(container, app);
} else {
  container.removeAttribute("data-prerendered"); // it was only a marker for the rule that hides the landing page
  container.replaceChildren();
  createRoot(container).render(app);
}

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
