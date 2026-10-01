// Visual QA helper: signs in as a role and screenshots routes at a chosen size and colour scheme.
//   node scripts/shots.mjs --role admin --scheme light --size 1280x800 --out shots home cashier tasks
// Uses the locally installed Chrome, so nothing is downloaded.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i === -1 ? fallback : args[i + 1]; };
const routes = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

const BASE = flag("base", "http://localhost:3002");
const role = flag("role", "admin");
const scheme = flag("scheme", "light");
const [width, height] = flag("size", "1280x800").split("x").map(Number);
const out = flag("out", "shots");
const full = flag("full", "1") === "1";
const mobile = width < 700;

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
const page = await context.newPage();
const problems = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => problems.push(`[pageerror] ${e.message}`));

const anonymous = role === "none";
if (!anonymous) {
  await page.goto(`${BASE}/#/sign-in`);
  await page.locator(`[data-tid="signin.account.${role}"]`).click();
  await page.waitForSelector("h1");
  await page.waitForTimeout(700);
}

for (const route of routes.length ? routes : ["home"]) {
  if (anonymous) {
    await page.goto(`${BASE}/#${route === "landing" ? "/" : `/${route}`}`);
    await page.waitForSelector("h1");
    await page.waitForTimeout(1800);
    const anon = `${out}/${role}-${scheme}-${width}-${route}.png`;
    await page.screenshot({ path: anon, fullPage: full });
    console.log("saved", anon);
    continue;
  }
  await page.goto(`${BASE}/#/${route}`);
  // Wait for the route to actually render (screens are lazy chunks) and any loading skeleton to clear.
  await page.waitForFunction((r) => location.hash === `#/${r}` && document.querySelector("h1") && !document.querySelector('[aria-busy="true"]') && document.title.toLowerCase().startsWith(r === "home" ? "home" : r), route, { timeout: 30000 });
  await page.waitForTimeout(1600);
  const file = `${out}/${role}-${scheme}-${width}-${route}.png`;
  await page.screenshot({ path: file, fullPage: full });
  console.log("saved", file);
}
if (problems.length) console.log("CONSOLE PROBLEMS:\n" + [...new Set(problems)].join("\n"));
await browser.close();
