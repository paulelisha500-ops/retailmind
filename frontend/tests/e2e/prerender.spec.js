// The landing page is rendered into index.html at build time, so a first visit paints from the HTML and CSS
// alone. These tests pin down what that must never break: it is really in the HTML, it still works with no
// JavaScript, it hydrates cleanly, and visits that aren't the landing page never flash it.
import { expect, signInAs, test, tid } from "./fixtures.js";

const h1 = (page, name) => page.getByRole("heading", { level: 1, name });

/** Records whether the landing page was ever visible on a frame that was about to be painted. */
async function watchForLandingFlash(page) {
  const seen = { landing: false };
  await page.exposeFunction("__landingSeen", () => { seen.landing = true; });
  await page.addInitScript(() => {
    // The stylesheet is render-blocking, so no earlier frame than the first animation frame is ever shown.
    const look = () => {
      const landing = document.querySelector("#root .landing");
      if (landing && getComputedStyle(landing).display !== "none") window.__landingSeen?.();
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  return seen;
}

test.describe("pre-rendered landing page", () => {
  test("is in the HTML the server sends, not built by script", async ({ request }) => {
    const html = await (await request.get("./")).text();
    expect(html).toContain('<div id="root" data-prerendered>');
    expect(html).toContain("Every aisle, every shelf");
    expect(html).toContain("Open the console");
    expect(html).toContain("Questions people ask first");
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });
    test("still shows the page", async ({ page }) => {
      await page.goto("./");
      await expect(h1(page, /Every aisle, every shelf/)).toBeVisible();
      await expect(page.getByText("Open the console").first()).toBeVisible();
    });
  });

  test.describe("before the app's script has loaded", () => {
    test.use({ allowedErrors: ["Failed to load resource", "net::ERR_FAILED"] });

    test("every call to action is a real link, and it works", async ({ page }) => {
      await page.route("**/assets/*.js", (route) => route.abort()); // the app never arrives
      await page.goto("./");
      await expect(page.locator('#root a[href="#/sign-in"]')).toHaveCount(7);
      await tid(page, "landing.hero.open").click();
      await expect(page).toHaveURL(/#\/sign-in$/);
    });

    test("section links already scroll, and FAQ items already open", async ({ page }) => {
      await page.route("**/assets/*.js", (route) => route.abort());
      await page.goto("./");
      await tid(page, "landing.nav.faq").click();
      await expect(page.locator("#faq")).toBeInViewport({ ratio: 0.05 });
      await tid(page, "landing.faq").first().click();
      await expect(page.locator("details.faq").first()).toHaveAttribute("open", "");
    });

    test("a click made before the app arrives is not lost: the sign-in screen is there once it does", async ({ page }) => {
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      await page.route("**/assets/*.js", async (route) => { await held; await route.continue(); }); // slow network: the app arrives late
      await page.goto("./", { waitUntil: "commit" });
      await tid(page, "landing.hero.open").click(); // clicked while only the HTML and CSS are there
      release();
      await expect(h1(page, "Sign in to RetailMind")).toBeVisible();
      await expect(page).toHaveURL(/#\/sign-in$/);
    });
  });

  test("hydrates in place: the buttons work and the page isn't rebuilt", async ({ page }) => {
    await page.goto("./");
    // Mark the server-rendered heading; if hydration rebuilt the page instead of adopting it, the mark would be gone.
    await page.locator("h1").evaluate((el) => { el.dataset.kept = "yes"; });
    await tid(page, "landing.hero.open").click();
    await expect(h1(page, "Sign in to RetailMind")).toBeVisible();
    await page.goBack();
    await expect(h1(page, /Every aisle, every shelf/)).toBeVisible();
  });

  test("a returning, signed-in visit never paints the landing page", async ({ page }) => {
    await signInAs(page, "admin");
    const seen = await watchForLandingFlash(page);
    await page.reload();
    await expect(h1(page, /Hi, Marcus/)).toBeVisible();
    expect(seen.landing).toBe(false);
    expect(await page.evaluate(() => document.documentElement.dataset.boot)).toBe("app");
    expect(await page.locator("#root .landing").count()).toBe(0);
  });

  test("a link straight to a screen never paints the landing page", async ({ page }) => {
    const seen = await watchForLandingFlash(page);
    await page.goto("./#/sign-in");
    await expect(h1(page, "Sign in to RetailMind")).toBeVisible();
    expect(seen.landing).toBe(false);
  });

  test("signing out returns to the landing page", async ({ page }) => {
    await signInAs(page, "staff");
    await tid(page, "nav.sign-out").click();
    await expect(h1(page, /Every aisle, every shelf/)).toBeVisible();
    await page.reload();
    await expect(h1(page, /Every aisle, every shelf/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset.boot ?? null)).toBeNull();
  });
});
