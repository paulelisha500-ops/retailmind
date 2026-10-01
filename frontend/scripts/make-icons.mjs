// Renders the app icon (public/icon.svg) to the PNG sizes iOS, Android and the install prompt need.
// Uses the locally installed Chrome, so nothing is downloaded:  node scripts/make-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const svg = readFileSync("public/icon.svg", "utf8");
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();

async function render(file, size, { maskable = false, bg = false } = {}) {
  // Maskable icons get full-bleed colour and a smaller glyph so platform masks never clip it.
  const inner = maskable
    ? `<div style="width:${size}px;height:${size}px;background:linear-gradient(135deg,#3a9a62,#1c5e3a);display:flex;align-items:center;justify-content:center"><div style="width:${size * 0.66}px;height:${size * 0.66}px">${svg.replace(/<rect[^>]*\/>/, "").replace("<svg ", '<svg width="100%" height="100%" ')}</div></div>`
    : `<div style="width:${size}px;height:${size}px;${bg ? "background:#fff" : ""}">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</div>`;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${inner}</body></html>`);
  await page.screenshot({ path: file, omitBackground: !bg && !maskable, clip: { x: 0, y: 0, width: size, height: size } });
  console.log("wrote", file);
}

await render("public/icon-192.png", 192);
await render("public/icon-512.png", 512);
await render("public/icon-maskable-512.png", 512, { maskable: true });
await render("public/apple-touch-icon.png", 180, { bg: true });
await browser.close();
writeFileSync("public/.gitkeep", "");
