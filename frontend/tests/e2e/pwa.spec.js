// The installable, offline-capable side of the app. Service workers are blocked in every other spec so
// they exercise the network path; here they are switched back on, against the production build.
import { expect, saved, signInAs, test, tid } from "./fixtures.js";

test.use({ serviceWorkers: "allow" });

const h1 = (page, name) => page.getByRole("heading", { level: 1, name });

/** Waits until the service worker is active and controlling this page (it claims clients on activation). */
async function controlled(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15_000 });
}

test.describe("installability", () => {
  test("ships a complete web app manifest and the icons it points at", async ({ page, request }) => {
    await page.goto("./");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    const manifest = await (await request.get(new URL(href, page.url()).href)).json();
    expect(manifest).toMatchObject({ name: "RetailMind", display: "standalone" });
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.theme_color).toMatch(/^#/);
    expect(manifest.background_color).toMatch(/^#/);
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((i) => (i.purpose ?? "").includes("maskable"))).toBe(true);
    for (const icon of manifest.icons) {
      const res = await request.get(new URL(icon.src, new URL(href, page.url())).href);
      expect(res.status(), icon.src).toBe(200);
      expect(res.headers()["content-type"]).toContain("image/");
    }
  });

  test("declares a theme colour for both appearances, an iOS icon and a viewport that respects the notch", async ({ page, request }) => {
    await page.goto("./");
    expect(await page.locator('meta[name="theme-color"]').count()).toBeGreaterThanOrEqual(1);
    const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
    expect((await request.get(new URL(touch, page.url()).href)).status()).toBe(200);
    expect(await page.locator('meta[name="viewport"]').getAttribute("content")).toContain("viewport-fit=cover");
    expect(await page.locator('meta[name="apple-mobile-web-app-capable"], meta[name="mobile-web-app-capable"]').count()).toBeGreaterThanOrEqual(1);
  });
});

test.describe("offline", () => {
  test("registers a service worker that precaches the whole app", async ({ page }) => {
    await page.goto("./");
    await controlled(page);
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const cache = await caches.open(names.find((n) => n.startsWith("rm-")));
      return { names, urls: (await cache.keys()).map((r) => new URL(r.url).pathname) };
    });
    expect(cached.names.some((n) => n.startsWith("rm-"))).toBe(true);
    expect(cached.urls.length).toBeGreaterThan(25);
    expect(cached.urls.some((u) => u.endsWith("/index.html") || u.endsWith("/"))).toBe(true);
    expect(cached.urls.filter((u) => /\/assets\/.+\.js$/.test(u)).length).toBeGreaterThan(15);
    // First install is not an "update": no prompt appears.
    await expect(page.getByText("A new version of RetailMind is ready.")).toHaveCount(0);
  });

  test("reopens, signs in and works across every screen with no network at all", async ({ page, context }) => {
    await page.goto("./");
    await controlled(page);
    await context.setOffline(true);

    await page.reload();
    await expect(h1(page, /Every aisle, every shelf/)).toBeVisible();

    await signInAs(page, "admin");
    for (const [route, title] of [["cashier", "Cashier"], ["monitoring", "Monitoring"], ["forecast", "Forecast"], ["procurement", "Procurement"], ["assistant", "Ask RetailMind"], ["warehouse", "Warehouse"], ["analytics", "Analytics"], ["team", "Team & Access"], ["tasks", "Tasks"]]) {
      await page.goto(`./#/${route}`);
      await expect(h1(page, title)).toBeVisible();
    }
    // The forecasts train in the browser, so they work offline too.
    await page.goto("./#/forecast");
    await tid(page, "forecast.method.lstm").click();
    await expect(page.getByText(/% MAPE/)).toBeVisible({ timeout: 30_000 });
    await context.setOffline(false);
  });

  test("keeps what you change across a reload, offline or not", async ({ page, context }) => {
    await page.goto("./");
    await controlled(page);
    await context.setOffline(true);
    await signInAs(page, "staff");
    await tid(page, "nav.tasks").click();
    await expect(page.getByText("5 open today")).toBeVisible();
    await saved(page, async () => {
      await tid(page, "tasks.toggle").first().click();
      await expect(page.getByText("4 open today")).toBeVisible();
    });
    await page.reload();
    await expect(page.getByText("4 open today")).toBeVisible();
    await context.setOffline(false);
  });
});
