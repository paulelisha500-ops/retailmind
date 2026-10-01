// Renders the landing page into dist/index.html, so a first visit paints from the HTML and CSS alone instead of
// waiting for ~75 kB of JavaScript to download, run and lay the page out (the slow part on a phone).
//
//   node scripts/prerender.mjs [--mode server]     (run after `vite build`)
//
// The page is rendered from the same component tree the browser hydrates, so the two always agree. Visits that
// start somewhere else (a saved session, a deep link) are not hydrated; see src/main.jsx and index.html.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const modeIndex = process.argv.indexOf("--mode");
const mode = modeIndex > -1 ? process.argv[modeIndex + 1] : "production";
const out = join(process.cwd(), ".prerender");
const page = join(process.cwd(), "dist", "index.html");
if (!existsSync(page)) throw new Error("dist/index.html not found - run `vite build` first");

try {
  await build({
    configFile: false,
    mode,
    logLevel: "error",
    plugins: [react()],
    build: { ssr: "src/prerender.jsx", outDir: out, emptyOutDir: true, minify: false, target: "node20" },
  });
  const { renderLanding } = await import(pathToFileURL(join(out, "prerender.js")).href);
  const markup = renderLanding();

  const html = readFileSync(page, "utf8");
  const slot = '<div id="root"></div>';
  if (!html.includes(slot)) throw new Error("index.html no longer has an empty #root to fill");
  writeFileSync(page, html.replace(slot, `<div id="root" data-prerendered>${markup}</div>`));
  console.log(`prerendered the landing page into dist/index.html (${(markup.length / 1024).toFixed(1)} kB of markup)`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
