import { expect, signInAs, test, tid } from "./fixtures.js";

test.describe("landing page", () => {
  test("every section link scrolls its section into view", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Every aisle, every shelf");
    for (const id of ["platform", "roles", "editions", "faq"]) {
      await tid(page, `landing.nav.${id}`).click();
      await expect(page.locator(`#${id}`)).toBeInViewport({ ratio: 0.05 });
    }
  });

  test("every call to action opens the sign-in screen", async ({ page }) => {
    for (const id of ["landing.nav.sign-in", "landing.nav.open", "landing.hero.open", "landing.hero.sign-in", "landing.editions.open", "landing.cta.open", "landing.footer.sign-in"]) {
      await page.goto("/");
      await tid(page, id).scrollIntoViewIfNeeded();
      await tid(page, id).click();
      await expect(page.getByRole("heading", { level: 1, name: "Sign in to RetailMind" }), id).toBeVisible();
      await expect(page).toHaveURL(/#\/sign-in$/);
    }
  });

  test("FAQ items expand and collapse", async ({ page }) => {
    await page.goto("/");
    const items = tid(page, "landing.faq");
    const count = await items.count();
    expect(count).toBe(6);
    for (let i = 0; i < count; i++) {
      await items.nth(i).scrollIntoViewIfNeeded();
      await items.nth(i).click();
      await expect(page.locator("details.faq").nth(i)).toHaveAttribute("open", "");
    }
    await items.nth(0).click();
    await expect(page.locator("details.faq").nth(0)).not.toHaveAttribute("open", "");
  });

  test("source links point at the repository and open in a new tab", async ({ page, context }) => {
    // Answer with a stub page so the test never touches the real site (and the tracer has a normal page to record).
    await context.route("https://github.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>repository</title>" }));
    await page.goto("/");
    for (const id of ["landing.editions.source", "landing.footer.source"]) {
      const link = tid(page, id);
      await expect(link).toHaveAttribute("href", "https://github.com/paulelisha500-ops/retailmind");
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /noopener/);
      await link.scrollIntoViewIfNeeded();
      const [popup] = await Promise.all([context.waitForEvent("page"), link.click()]);
      await popup.close();
    }
  });

  test("shows no stock photography or web-font requests", async ({ page }) => {
    const external = [];
    page.on("request", (r) => { if (!r.url().startsWith("http://localhost")) external.push(r.url()); });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(external).toEqual([]);
  });
});

test.describe("sign in", () => {
  test("the back button returns to the landing page", async ({ page }) => {
    await page.goto("/#/sign-in");
    await tid(page, "signin.back").click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Every aisle, every shelf");
  });

  test("requires both fields before it will submit", async ({ page }) => {
    await page.goto("/#/sign-in");
    await tid(page, "signin.submit").click();
    await expect(tid(page, "signin.email")).toHaveJSProperty("validity.valueMissing", true);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in to RetailMind" })).toBeVisible();
  });

  test("rejects a wrong password with a clear message", async ({ page }) => {
    await page.goto("/#/sign-in");
    await tid(page, "signin.email").fill("marcus@retailmind.app");
    await tid(page, "signin.password").fill("not-the-password");
    await tid(page, "signin.submit").click();
    await expect(page.getByRole("alert")).toHaveText("Incorrect email or password");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in to RetailMind" })).toBeVisible();
  });

  test("rejects an unknown or malformed email", async ({ page }) => {
    await page.goto("/#/sign-in");
    await tid(page, "signin.email").fill("nobody@retailmind.app");
    await tid(page, "signin.password").fill("retailmind");
    await tid(page, "signin.submit").click();
    await expect(page.getByRole("alert")).toHaveText("Incorrect email or password");
  });

  test("signs in with typed credentials and lands on Home", async ({ page }) => {
    await page.goto("/#/sign-in");
    await tid(page, "signin.email").fill("priya@retailmind.app");
    await tid(page, "signin.password").fill("retailmind");
    await tid(page, "signin.submit").click();
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Priya" })).toBeVisible();
    await expect(page).toHaveURL(/#\/home$/);
  });

  for (const [role, name, console_] of [["admin", "Marcus", "Admin console"], ["manager", "Priya", "Manager console"], ["staff", "Diego", "Staff console"], ["customer", "Layla", "Customer"]]) {
    test(`the ${role} workspace account signs in and sees its own console`, async ({ page }) => {
      await signInAs(page, role);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Hi, ${name}`);
      await expect(page.locator(".brand__tag")).toHaveText(console_);
      // Sign out from the sidebar returns to the landing page and forgets the session.
      await tid(page, "nav.sign-out").click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Every aisle, every shelf");
      await page.goto("/#/home");
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Every aisle, every shelf");
    });
  }

  test("a signed-in session survives a reload", async ({ page }) => {
    await signInAs(page, "admin");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Marcus" })).toBeVisible();
  });

  test("signed-out visitors can't open app routes directly", async ({ page }) => {
    await page.goto("/#/procurement");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Every aisle, every shelf");
  });
});
