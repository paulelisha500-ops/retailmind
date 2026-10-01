// Interactive-element census.
//
// Parses every JSX file and lists each element a person can operate: buttons, links, inputs, selects,
// disclosure summaries, anything with a click/change/key/pointer handler, and the shared controls
// (Button, Segmented, Switch, Sheet…). Every one of them must carry a stable test id (`data-tid` on a
// DOM element, `tid` on a shared control). The end-to-end suite records which ids it actually
// exercised, and scripts/coverage-gate.mjs fails unless every id listed here was used.
//
//   node scripts/interactive-census.mjs          → prints a summary, exits 1 if an element has no test id
//   node scripts/interactive-census.mjs --json   → also writes test-results/census.json
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;
const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const HOST_TAGS = new Set(["button", "select", "textarea", "summary"]);
const HANDLERS = new Set(["onClick", "onChange", "onInput", "onKeyDown", "onPointerDown", "onPointerMove", "onMouseDown"]);
const ROLES = new Set(["button", "slider", "switch", "tab", "checkbox", "menuitem"]);

/** Shared controls → the extra ids they render from their `tid` prop (besides `tid` itself). */
const COMPONENTS = {
  Button: [""], IconButton: [""], Switch: [""], Check: [""], Chip: [""], Input: [""], Select: [""], IconInput: [""],
  Segmented: [".*"], Stepper: [".minus", ".plus"], XYChart: [".scrub"], Donut: [".legend"],
  Sheet: [".backdrop", ".close"], ConfirmSheet: [".backdrop", ".close", ".cancel", ".confirm"],
  ListRow: [""], // only when it has an onClick
  CsvImport: [""], // a file picker wrapped in a button-styled label
};

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : /\.(jsx|js)$/.test(name) ? [path] : [];
});

function attrMap(opening) {
  const map = new Map();
  for (const a of opening.attributes) if (a.type === "JSXAttribute" && a.name.type === "JSXIdentifier") map.set(a.name.name, a.value);
  return map;
}

/** String value of a tid attribute: { kind: "literal" | "pattern" | "dynamic", value }. */
function tidOf(node) {
  if (!node) return null;
  const expr = node.type === "JSXExpressionContainer" ? node.expression : node;
  if (expr.type === "StringLiteral") return { kind: "literal", value: expr.value };
  if (expr.type === "TemplateLiteral") {
    const value = expr.quasis.map((q, i) => q.value.cooked + (i < expr.expressions.length ? "*" : "")).join("");
    return { kind: value.includes("*") ? "pattern" : "literal", value };
  }
  return { kind: "dynamic", value: null };
}

const sites = [];
const problems = [];

for (const file of walk(SRC)) {
  const code = readFileSync(file, "utf8");
  const ast = parse(code, { sourceType: "module", plugins: ["jsx"] });
  traverse(ast, {
    // Test ids handed over as plain configuration — a header's `back={{ tid, onClick }}`, a toast's
    // `action: { tid, … }` — end up on a real button too, so they are expected just the same.
    ObjectProperty(path) {
      const { node } = path;
      const key = node.key.type === "Identifier" ? node.key.name : node.key.type === "StringLiteral" ? node.key.value : null;
      if (key !== "tid") return;
      const tid = tidOf(node.value);
      if (!tid || tid.kind === "dynamic") return; // `{ tid }` forwarding a prop — expanded where it's written out
      sites.push({ at: `${relative(ROOT, file).replaceAll("\\", "/")}:${node.loc.start.line}`, element: "config", ...tid });
    },
    JSXOpeningElement(path) {
      const { node } = path;
      if (node.name.type !== "JSXIdentifier") return;
      const name = node.name.name;
      const attrs = attrMap(node);
      const isComponent = /^[A-Z]/.test(name);
      let interactive = false;

      if (isComponent) {
        if (name === "ListRow") interactive = attrs.has("onClick");
        // Any component handed a test id is operable — and so is any component handed an event handler: if it
        // isn't one of the known shared controls and has no test id, it is reported below instead of slipping by.
        else interactive = name in COMPONENTS || attrs.has("tid") || [...attrs.keys()].some((k) => HANDLERS.has(k));
      } else {
        if (HOST_TAGS.has(name)) interactive = true;
        else if (name === "a") interactive = attrs.has("href");
        else if (name === "input") {
          const type = attrs.get("type");
          interactive = !(type?.type === "StringLiteral" && type.value === "hidden");
        } else if (name === "label") interactive = attrs.has("onClick");
        else interactive = [...attrs.keys()].some((k) => HANDLERS.has(k)) || (attrs.has("role") && ROLES.has(attrs.get("role")?.value)) || (attrs.has("tabIndex") && tidOf(attrs.get("tabIndex"))?.kind !== "dynamic" && false);
      }
      // A hidden file input is still operated (by the button-styled label that wraps it).
      if (!interactive) return;

      const attrName = isComponent ? "tid" : "data-tid";
      const at = `${relative(ROOT, file).replaceAll("\\", "/")}:${node.loc.start.line}`;
      if (!attrs.has(attrName)) { problems.push(`${at}  <${name}> has no ${attrName}`); return; }
      const tid = tidOf(attrs.get(attrName));
      sites.push({ at, element: name, ...tid });
    },
  });
}

// Expand shared controls into the ids they render.
const expected = new Map(); // id or pattern → where it comes from
for (const s of sites) {
  if (s.kind === "dynamic") continue; // a wrapper passing its own `tid` straight through
  // Inside a shared control, an id built from its own `tid` prop (`${tid}.close`) is expanded at each
  // place the control is used, so the bare wrapper pattern would only add noise.
  if (s.kind === "pattern" && s.value.startsWith("*")) continue;
  const suffixes = s.element in COMPONENTS ? COMPONENTS[s.element] : [""];
  for (const suffix of suffixes) {
    const id = s.value + suffix;
    if (!expected.has(id)) expected.set(id, s.at);
  }
}

const list = [...expected.entries()].map(([id, at]) => ({ id, at, pattern: id.includes("*") }));
console.log(`${sites.length} interactive elements found in ${new Set(sites.map((s) => s.at.split(":")[0])).size} files`);
console.log(`${list.length} distinct test ids to exercise (${list.filter((l) => l.pattern).length} of them patterns for dynamic lists)`);

if (process.argv.includes("--json")) {
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/census.json", JSON.stringify(list, null, 2));
  console.log("wrote test-results/census.json");
}

if (problems.length) {
  console.error(`\n${problems.length} interactive element(s) without a test id:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
