// First-visit load benchmark. Serves one or more builds the way a static host does (gzip, short cache) and loads each
// in a fresh browser context under several network and CPU conditions, interleaving the builds so drift in the
// machine's load affects them equally. Prints the median first paint, largest paint, transfer size and JavaScript.
//
//   node scripts/bench-load.mjs original=../old/frontend/dist current=dist
//   node scripts/bench-load.mjs --runs 9 a=dist-a b=dist-b
//
// To measure an older revision: `git worktree add ../old <commit>`, build it there, and pass its dist as a label.
// The GPU is disabled so software compositing is the same every run; the numbers compare builds with one another and
// are not a promise about any particular phone.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const runsAt = args.indexOf("--runs");
const RUNS = runsAt > -1 ? Number(args[runsAt + 1]) : 7;
const targets = args.filter((a, i) => a.includes("=") && args[i - 1] !== "--runs").map((a) => {
  const [label, dir] = a.split("=");
  return { label, root: normalize(resolve(dir)) };
});
if (targets.length < 1) { console.error("usage: node scripts/bench-load.mjs label=dist [label=dist ...] [--runs N]"); process.exit(2); }

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

function serve(root, port) {
  const cache = new Map();
  return new Promise((done) => createServer((req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (path.endsWith("\\") || path.endsWith("/")) path = join(path, "index.html");
    const file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    const headers = { "Content-Type": type, "Cache-Control": "public, max-age=600" };
    if (/text|javascript|svg|manifest/.test(type)) {
      if (!cache.has(file)) cache.set(file, gzipSync(readFileSync(file), { level: 9 }));
      const body = cache.get(file);
      res.writeHead(200, { ...headers, "Content-Encoding": "gzip", "Content-Length": body.length });
      res.end(body);
    } else {
      res.writeHead(200, { ...headers, "Content-Length": statSync(file).size });
      createReadStream(file).pipe(res);
    }
  }).listen(port, done));
}
await Promise.all(targets.map((t, i) => serve(t.root, (t.port = 4300 + i))));

const kbps = (k) => (k * 1024) / 8;
const PROFILES = {
  "desktop, fast network": { cpu: 1, net: null },
  "slow 3G: 400 kbps, 400 ms RTT": { cpu: 1, net: { offline: false, downloadThroughput: kbps(400), uploadThroughput: kbps(400), latency: 400 } },
  "phone: 4x CPU, 1.6 Mbps, 150 ms RTT": { cpu: 4, net: { offline: false, downloadThroughput: kbps(1600), uploadThroughput: kbps(750), latency: 150 } },
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome", args: ["--disable-gpu"] });
{ const warm = await browser.newContext(); await (await warm.newPage()).goto("about:blank"); await warm.close(); }

async function once(url, profile) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  if (profile.net) await cdp.send("Network.emulateNetworkConditions", profile.net);
  if (profile.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
  await page.addInitScript(() => { window.__lcp = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true }); });
  let bytes = 0;
  let scriptBytes = 0;
  page.on("response", async (response) => {
    try {
      const sizes = await response.request().sizes();
      bytes += sizes.responseBodySize + sizes.responseHeadersSize;
      if (/javascript/.test(response.headers()["content-type"] ?? "")) scriptBytes += sizes.responseBodySize;
    } catch { /* aborted */ }
  });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => performance.getEntriesByName("first-contentful-paint").length > 0 && window.__lcp > 0, null, { timeout: 90_000, polling: 50 });
  await page.waitForTimeout(2500); // let the largest paint settle
  const timing = await page.evaluate(() => ({ fcp: performance.getEntriesByName("first-contentful-paint")[0].startTime, lcp: window.__lcp }));
  await context.close();
  return { fcp: Math.round(timing.fcp), lcp: Math.round(timing.lcp), kB: Math.round(bytes / 1024), jsKB: Math.round(scriptBytes / 1024) };
}

const rows = [];
for (const [profileName, profile] of Object.entries(PROFILES)) {
  const samples = Object.fromEntries(targets.map((t) => [t.label, []]));
  for (let i = 0; i <= RUNS; i++) {
    for (const t of targets) {
      const result = await once(`http://localhost:${t.port}/`, profile);
      if (i > 0) samples[t.label].push(result); // the first round is a warm-up
    }
  }
  for (const t of targets) {
    const pick = (key) => median(samples[t.label].map((s) => s[key]));
    rows.push({ conditions: profileName, build: t.label, "first paint ms": pick("fcp"), "largest paint ms": pick("lcp"), "transferred kB": pick("kB"), "JavaScript kB": pick("jsKB") });
  }
}
await browser.close();
console.table(rows);
process.exit(0);
