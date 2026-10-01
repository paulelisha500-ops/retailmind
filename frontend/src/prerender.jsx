// Rendered once at build time (scripts/prerender.mjs): the landing page as plain HTML, so the first paint
// needs only the HTML and CSS and doesn't wait for any JavaScript.
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import App from "./App.jsx";

export const renderLanding = () => renderToString(<StrictMode><App /></StrictMode>);
