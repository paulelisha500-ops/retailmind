// The "no untested button" gate. Merges what every end-to-end test touched and compares it with the
// census of interactive elements found in the source:
//   1. every test id the census expects must have been exercised at least once, and
//   2. every test id that was ever rendered must have been exercised (this is what makes sure each
//      option of a dynamic list — every tab, every segmented choice — was used, not just one).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const census = existsSync("test-results/census.json") ? JSON.parse(readFileSync("test-results/census.json", "utf8")) : null;
const dir = "test-results/coverage";
if (!census || !existsSync(dir)) {
  console.error("No census or coverage data — run `npm run census` and the end-to-end suite first.");
  process.exit(2);
}

const hits = new Set();
const seen = new Set();
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
for (const f of files) {
  const data = JSON.parse(readFileSync(join(dir, f), "utf8"));
  data.hits.forEach((h) => hits.add(h));
  data.seen.forEach((s) => seen.add(s));
}

const toRegex = (pattern) => new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".+")}$`);
const hit = (entry) => (entry.pattern ? [...hits].some((h) => toRegex(entry.id).test(h)) : hits.has(entry.id));

const missing = census.filter((e) => !hit(e));
const renderedButUntouched = [...seen].filter((s) => !hits.has(s)).sort();

console.log(`${files.length} test runs · ${census.length} ids expected · ${hits.size} exercised · ${seen.size} rendered`);
console.log(`coverage of expected ids: ${census.length - missing.length}/${census.length}`);

let failed = false;
if (missing.length) {
  failed = true;
  console.error(`\nNEVER EXERCISED (${missing.length}) — listed in the census but no test touched them:`);
  for (const m of missing) console.error(`  ${m.id}   (${m.at})`);
}
if (renderedButUntouched.length) {
  failed = true;
  console.error(`\nRENDERED BUT NEVER EXERCISED (${renderedButUntouched.length}):`);
  for (const s of renderedButUntouched) console.error(`  ${s}`);
}
if (failed) process.exit(1);
console.log("\nEvery interactive element in the app was exercised at least once.");
