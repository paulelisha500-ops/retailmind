// Vite plugin: emits sw.js with a precache list built from the bundle that was just produced.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export function serviceWorkerPlugin() {
  let publicDir = "public";
  return {
    name: "retailmind-service-worker",
    apply: "build",
    configResolved(config) { publicDir = config.publicDir; },
    generateBundle(_options, bundle) {
      const publicFiles = readdirSync(publicDir).filter((f) => f !== "sw.js");
      const files = [...new Set([...Object.keys(bundle), ...publicFiles])]
        .filter((f) => f !== "sw.js" && !f.endsWith(".map") && f !== "social-preview.png") // the share card is for crawlers, not visitors
        .sort();
      const shell = bundle["index.html"]?.source ?? "";
      const template = readFileSync(resolve("scripts/sw.template.js"), "utf8");
      // The cache name changes with the files *and* with the worker's own logic, so fixing the worker rotates it too.
      const version = createHash("sha1").update(files.join("|")).update(String(shell)).update(template).digest("hex").slice(0, 10);
      const versionLine = /^const VERSION = .*;$/m;
      const precacheLine = /^const PRECACHE = .*;$/m;
      if (!versionLine.test(template) || !precacheLine.test(template)) throw new Error("sw.template.js is missing its VERSION / PRECACHE lines");
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: template
          .replace(versionLine, () => `const VERSION = ${JSON.stringify(version)};`)
          .replace(precacheLine, () => `const PRECACHE = ${JSON.stringify(["./", "index.html", ...files])};`), // Vite adds the HTML after this hook, so the shell is listed by hand
      });
    },
  };
}
