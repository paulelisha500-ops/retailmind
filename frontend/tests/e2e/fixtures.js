// Shared test fixtures: a `page` that (1) records which test ids were rendered and which were
// exercised, feeding the coverage gate, and (2) fails the test on any console error or uncaught
// exception, so a silently broken screen can't pass.
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test as base } from "@playwright/test";

export { expect };

export const test = base.extend({
  // Messages a test expects to see in the console (e.g. a deliberately unreachable camera URL).
  allowedErrors: [[], { option: true }],

  page: async ({ page, allowedErrors }, use, testInfo) => {
    // Coverage is collected on the Node side. A page reload or a new document would wipe anything kept in
    // the page, and a test that clicks a button which reloads the page (or navigates away) is exactly the
    // kind that must still count — so every hit and every rendered id is forwarded as it happens.
    const hits = new Set();
    const seen = new Set();
    await page.exposeFunction("__rmRecord", (kind, id) => { (kind === "hit" ? hits : seen).add(id); });
    await page.addInitScript(() => {
      window.__rm = { saves: 0, lastSave: 0 };
      // The engine announces every save of the workspace on this channel (other tabs listen to it too).
      try { new BroadcastChannel("retailmind-workspace").onmessage = () => { window.__rm.saves += 1; window.__rm.lastSave = performance.now(); }; } catch { /* no BroadcastChannel */ }

      const sent = { hit: new Set(), seen: new Set() };
      const send = (kind, id) => {
        if (!id || sent[kind].has(id)) return;
        sent[kind].add(id);
        window.__rmRecord?.(kind, id);
      };
      const record = (e) => {
        const id = e.target?.closest?.("[data-tid]")?.getAttribute("data-tid");
        // Browsers fire synthetic pointer moves when layout shifts under a resting cursor, so moving the pointer
        // only counts on the controls that are actually operated by hovering: chart scrubbers and legends.
        if (e.type === "pointermove" && !/\.(scrub|legend)$/.test(id ?? "")) return;
        send("hit", id);
      };
      for (const type of ["click", "change", "input", "keydown", "pointerdown", "pointermove"]) document.addEventListener(type, record, true);
      const scan = () => document.querySelectorAll("[data-tid]").forEach((el) => send("seen", el.getAttribute("data-tid")));
      addEventListener("DOMContentLoaded", () => {
        scan();
        new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
      });
    });

    const problems = [];
    page.on("pageerror", (e) => problems.push(`uncaught: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const text = m.text();
      if (!allowedErrors.some((a) => text.includes(a))) problems.push(`console.error: ${text}`);
    });

    await use(page);

    mkdirSync("test-results/coverage", { recursive: true });
    writeFileSync(`test-results/coverage/${testInfo.project.name}-${testInfo.testId}-${testInfo.retry}.json`, JSON.stringify({ hits: [...hits], seen: [...seen] }));
    expect(problems, "console errors / uncaught exceptions").toEqual([]);
  },
});

/** The element carrying a given test id. */
export const tid = (page, id) => page.locator(`[data-tid="${id}"]`);

const ACCOUNT = { admin: "Marcus", manager: "Priya", staff: "Diego", customer: "Layla" };

/**
 * Signs in through the workspace-account list (localhost test workspace) and waits for the first screen. The first
 * sign-in in a fresh page boots the in-page engine and checks a password hash, which a loaded or slower machine can
 * stretch well past the default assertion wait.
 */
export async function signInAs(page, role) {
  await page.goto("./#/sign-in");
  await tid(page, `signin.account.${role}`).click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`Hi, ${ACCOUNT[role]}`) })).toBeVisible({ timeout: 20_000 });
}

/** Opens a screen by its nav entry and waits for its heading. */
export async function openScreen(page, route, heading) {
  await page.goto(`./#/${route}`);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

/**
 * Runs `action`, then waits until the workspace has been written to storage. Changes are saved a moment
 * after they happen, so a test that reloads straight after one must wait for that save.
 */
export async function saved(page, action) {
  const before = await page.evaluate(() => window.__rm.saves);
  await action();
  await page.waitForFunction((n) => window.__rm.saves > n, before);
  // A save that was already under way when the action ran can announce first; the one that carries the action's own
  // change follows within the engine's 150 ms debounce plus the write itself. Reloading in between would lose it, so
  // wait until storage has been quiet for well over that.
  await page.waitForFunction(() => performance.now() - window.__rm.lastSave > 600, null, { polling: 100 });
}

export const money = (text) => Number(String(text).replace(/[^0-9.]/g, ""));
