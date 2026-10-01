// Renders public/social-preview.png (1200 x 630): the card shown when a link to the site is shared.
// It is a screenshot of the real landing page, so it can never drift from what the site looks like.
//
//   npm run build && npx vite preview --port 4195 --strictPort &
//   node scripts/make-social-preview.mjs http://localhost:4195
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const url = process.argv[2] ?? "http://localhost:4195";
const browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome" });
const context = await browser.newContext({ viewport: { width: 1200, height: 630 }, colorScheme: "dark", reducedMotion: "reduce", serviceWorkers: "block" });
const page = await context.newPage();
await page.goto(url, { waitUntil: "load" });
await page.getByRole("heading", { level: 1 }).waitFor();
await page.waitForTimeout(600);
writeFileSync(new URL("../public/social-preview.png", import.meta.url), await page.screenshot({ type: "png" }));
await browser.close();
console.log("wrote public/social-preview.png");
