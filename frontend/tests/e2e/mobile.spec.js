// Runs in the "mobile" project (390 × 844, touch): the phone layout — tab bar, bottom sheets, no sideways scroll.
import { expect, signInAs, test, tid } from "./fixtures.js";

const h1 = (page, name) => page.getByRole("heading", { level: 1, name });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const TABS = {
  customer: [["home", /Hi, Layla/], ["list", "Shopping List"], ["offers", "Offers"], ["profile", "Profile"]],
  staff: [["home", /Hi, Diego/], ["cashier", "Cashier"], ["tasks", "Tasks"], ["monitoring", "Monitoring"], ["forecast", "Forecast"], ["profile", "Profile"]],
  admin: [["home", /Hi, Marcus/], ["cashier", "Cashier"], ["monitoring", "Monitoring"], ["forecast", "Forecast"], ["team", "Team & Access"], ["profile", "Profile"]],
};

test.describe("tab bar", () => {
  for (const [role, tabs] of Object.entries(TABS)) {
    test(`the ${role} tab bar reaches every tab by touch`, async ({ page }) => {
      await signInAs(page, role);
      for (const [id, title] of [...tabs].reverse()) {
        await tid(page, `tab.${id}`).tap();
        await expect(h1(page, title)).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`#/${id}$`));
        await expect(tid(page, `tab.${id}`)).toHaveAttribute("aria-current", "page");
      }
    });
  }

  test("it replaces the sidebar, sits on the bottom edge, and each tab is a comfortable tap target", async ({ page }) => {
    await signInAs(page, "admin");
    await expect(tid(page, "nav.home")).toBeHidden();
    const viewport = page.viewportSize();
    for (const [id] of TABS.admin) {
      const box = await tid(page, `tab.${id}`).boundingBox();
      expect(box.height, `${id} height`).toBeGreaterThanOrEqual(44);
      expect(box.width, `${id} width`).toBeGreaterThanOrEqual(44);
      expect(box.y + box.height, `${id} bottom edge`).toBeCloseTo(viewport.height, -1);
    }
  });
});

test.describe("layout", () => {
  test("no screen scrolls sideways", async ({ page }) => {
    const visits = [
      ["customer", ["home", "list", "offers", "profile"]],
      ["admin", ["home", "cashier", "tasks", "monitoring", "forecast", "procurement", "assistant", "warehouse", "analytics", "team", "profile"]],
    ];
    for (const [role, routes] of visits) {
      await signInAs(page, role);
      for (const route of routes) {
        await page.goto(`/#/${route}`);
        await page.waitForLoadState("networkidle");
        await expect(page.locator("main h1").first()).toBeVisible();
        expect(await sideways(page), `${role} → ${route} overflows sideways`).toBeLessThanOrEqual(1);
      }
      await page.evaluate(() => { location.hash = "#/profile"; });
      await tid(page, "tab.profile").tap();
      await tid(page, "profile.sign-out").tap();
    }
  });

  test("the landing page and sign-in fit a phone too", async ({ page }) => {
    await page.goto("/");
    await expect(h1(page, /Every aisle, every shelf/)).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(1);
    await page.goto("/#/sign-in");
    await expect(h1(page, "Sign in to RetailMind")).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(1);
  });

  test("sheets rise from the bottom edge and span the screen", async ({ page }) => {
    await signInAs(page, "admin");
    await tid(page, "home.bell").tap();
    const panel = page.getByRole("dialog", { name: "Notifications" });
    await expect(panel).toBeVisible();
    const viewport = page.viewportSize();
    // The sheet springs up from below the screen; wait for it to settle on the bottom edge.
    await expect.poll(async () => { const b = await panel.boundingBox(); return Math.abs(b.y + b.height - viewport.height) <= 2; }, { timeout: 10_000 }).toBe(true);
    const box = await panel.boundingBox();
    expect(box.x).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(viewport.width - 2);
    await tid(page, "home.notifications.backdrop").tap({ position: { x: 20, y: 20 } });
    await expect(panel).toHaveCount(0);
  });

  test("the large title collapses into a compact navigation bar on scroll", async ({ page }) => {
    await signInAs(page, "admin");
    await tid(page, "tab.monitoring").tap(); // long enough to scroll (Team fits on one phone screen)
    await expect(h1(page, "Monitoring")).toBeVisible();
    await expect(page.locator(".navbar")).not.toHaveClass(/is-visible/);
    await page.evaluate(() => window.scrollTo({ top: 400 }));
    await expect(page.locator(".navbar")).toHaveClass(/is-visible/);
    await expect(page.locator(".navbar")).toContainText("Monitoring");
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await expect(page.locator(".navbar")).not.toHaveClass(/is-visible/);
  });

  test("forms are usable on a phone: the add-member sheet scrolls and submits", async ({ page }) => {
    await signInAs(page, "admin");
    await tid(page, "tab.team").tap();
    await tid(page, "team.add").tap();
    const dialog = page.getByRole("dialog", { name: "Add team member" });
    await expect(dialog).toBeVisible();
    await tid(page, "team.form.name").fill("Phone Hire");
    await tid(page, "team.form.email").fill("phone.hire@retailmind.app");
    await tid(page, "team.form.title").fill("Floor Associate");
    await tid(page, "team.form.submit").tap();
    await expect(page.locator(".toast", { hasText: "Phone Hire added to the team" })).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });
});

test.describe("touch", () => {
  test("a chart is inspected by touching it", async ({ page }) => {
    await signInAs(page, "admin");
    await tid(page, "tab.forecast").tap();
    const scrub = tid(page, "forecast.chart.scrub");
    await expect(scrub).toBeVisible();
    const box = await scrub.boundingBox();
    await scrub.tap({ position: { x: box.width * 0.5, y: 60 } });
    await expect(page.locator(".xy__tip")).toBeVisible();
  });

  test("the register works one-handed: add an item, pay by card, finish", async ({ page }) => {
    await signInAs(page, "staff");
    await tid(page, "tab.cashier").tap();
    await tid(page, "cashier.search").fill("milk");
    await tid(page, "cashier.add-product").first().tap();
    await tid(page, "cashier.payment").filter({ hasText: "Card" }).tap();
    await tid(page, "cashier.complete").tap();
    await expect(page.locator(".receipt-card")).toContainText("AED 12.50");
    await tid(page, "cashier.new-sale").tap();
  });

  test("a customer can find a product, add it to the list and check out", async ({ page }) => {
    await signInAs(page, "customer");
    await tid(page, "customer-home.find").tap();
    await tid(page, "find-product.search").fill("eggs");
    await tid(page, "find-product.result").tap();
    await tid(page, "find-product.add").tap();
    await expect(h1(page, "Shopping List")).toBeVisible();
    await expect(page.locator("#main .list-row", { hasText: "Free-range Eggs" }).locator(".stepper span")).toHaveText("2");
  });

  test("the update prompt can be tapped to reload", async ({ page }) => {
    await signInAs(page, "customer");
    await page.evaluate(() => window.dispatchEvent(new Event("rm:update-ready")));
    await expect(page.getByText("A new version of RetailMind is ready.")).toBeVisible();
    await Promise.all([page.waitForEvent("load"), tid(page, "app.update-reload").tap()]);
    await expect(h1(page, /Hi, Layla/)).toBeVisible();
  });
});
