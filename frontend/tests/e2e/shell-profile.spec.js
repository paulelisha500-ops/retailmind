import { expect, saved, signInAs, test, tid } from "./fixtures.js";

const heading = (page, name) => page.getByRole("heading", { level: 1, name });
// Toasts stack (three at most), so a repeated message can be on screen more than once; the newest is last.
const toast = (page, text) => page.locator(".toast", { hasText: text }).last();

test.describe("navigation", () => {
  test("the admin sidebar reaches every tab", async ({ page }) => {
    await signInAs(page, "admin");
    for (const [id, name] of [["cashier", "Cashier"], ["monitoring", "Monitoring"], ["forecast", "Forecast"], ["team", "Team & Access"], ["profile", "Profile"], ["home", /Hi, Marcus/]]) {
      await tid(page, `nav.${id}`).click();
      await expect(heading(page, name)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`#/${id}$`));
      await expect(tid(page, `nav.${id}`)).toHaveAttribute("aria-current", "page");
    }
  });

  test("the staff sidebar shows tasks but not admin-only screens", async ({ page }) => {
    await signInAs(page, "staff");
    await expect(tid(page, "nav.team")).toHaveCount(0);
    for (const [id, name] of [["cashier", "Cashier"], ["tasks", "Tasks"], ["monitoring", "Monitoring"], ["forecast", "Forecast"], ["profile", "Profile"], ["home", /Hi, Diego/]]) {
      await tid(page, `nav.${id}`).click();
      await expect(heading(page, name)).toBeVisible();
    }
    // Admin-only routes bounce back to Home.
    for (const route of ["team", "analytics"]) {
      await page.goto(`./#/${route}`);
      await expect(heading(page, /Hi, Diego/)).toBeVisible();
    }
  });

  test("the customer sidebar has the four shopper tabs", async ({ page }) => {
    await signInAs(page, "customer");
    for (const [id, name] of [["list", "Shopping List"], ["offers", "Offers"], ["profile", "Profile"], ["home", /Hi, Layla/]]) {
      await tid(page, `nav.${id}`).click();
      await expect(heading(page, name)).toBeVisible();
    }
    await page.goto("./#/cashier");
    await expect(heading(page, /Hi, Layla/)).toBeVisible();
  });

  test("the skip link moves focus to the main content", async ({ page }) => {
    await signInAs(page, "admin");
    await page.keyboard.press("Tab");
    await expect(tid(page, "shell.skip")).toBeFocused();
    await tid(page, "shell.skip").click();
    await expect(page.locator("#main")).toBeFocused();
  });

  test("the browser back button walks back through screens", async ({ page }) => {
    await signInAs(page, "admin");
    await tid(page, "nav.cashier").click();
    await tid(page, "nav.forecast").click();
    await page.goBack();
    await expect(heading(page, "Cashier")).toBeVisible();
    await page.goBack();
    await expect(heading(page, /Hi, Marcus/)).toBeVisible();
  });

  test("an update prompt offers a reload", async ({ page }) => {
    await signInAs(page, "admin");
    await page.evaluate(() => window.dispatchEvent(new Event("rm:update-ready")));
    await expect(page.getByText("A new version of RetailMind is ready.")).toBeVisible();
    await Promise.all([page.waitForEvent("load"), tid(page, "app.update-reload").click()]);
    await expect(heading(page, /Hi, Marcus/)).toBeVisible();
  });
});

test.describe("profile — admin", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "admin");
    await tid(page, "nav.profile").click();
    await expect(heading(page, "Profile")).toBeVisible();
  });

  test("shows who is signed in", async ({ page }) => {
    await expect(page.getByText("Marcus Tan", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Store Incharge").first()).toBeVisible();
  });

  test("Business summarises the last 30 days and links to Profit & Loss", async ({ page }) => {
    await tid(page, "profile.payments").click();
    await expect(page.getByText(/Whole business, last 30 days/)).toBeVisible();
    await expect(page.getByText(/net sales$/)).toBeVisible();
    await tid(page, "profile.open-pnl").click();
    await expect(heading(page, "Analytics")).toBeVisible();
    await expect(page).toHaveURL(/#\/analytics\?tab=pnl$/);
    await expect(page.getByRole("button", { name: "Profit & Loss" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/Trading P&L, last 30 days/)).toBeVisible();
  });

  test("notification switches save, persist across a reload, and change the bell", async ({ page }) => {
    await tid(page, "profile.notifications").click();
    for (const key of ["notify_restock", "notify_security", "notify_orders"]) {
      const sw = tid(page, `profile.pref.${key}`);
      await expect(sw).toBeChecked();
      await saved(page, () => sw.click());
      await expect(toast(page, "Notification settings saved")).toBeVisible();
      await expect(sw).not.toBeChecked();
    }
    await page.reload();
    await tid(page, "profile.notifications").click();
    for (const key of ["notify_restock", "notify_security", "notify_orders"]) await expect(tid(page, `profile.pref.${key}`)).not.toBeChecked();
    // With every alert type off, the bell on Home has nothing to report.
    await tid(page, "nav.home").click();
    await tid(page, "home.bell").click();
    await expect(page.getByText("All clear — nothing needs attention.")).toBeVisible();
    await tid(page, "home.notifications.close").click();
    // …and turning one back on brings items back.
    await tid(page, "nav.profile").click();
    await tid(page, "profile.notifications").click();
    await tid(page, "profile.pref.notify_security").click();
    await expect(tid(page, "profile.pref.notify_security")).toBeChecked();
    await tid(page, "nav.home").click();
    await tid(page, "home.bell").click();
    await expect(page.getByText(/Loss prevention alert · Checkout Zone/)).toBeVisible();
  });

  test("Store explains the assignment and links to Team & Access", async ({ page }) => {
    await tid(page, "profile.store").click();
    await expect(page.getByText(/You're assigned to/)).toContainText("Downtown Central #104");
    await tid(page, "profile.go-team").click();
    await expect(heading(page, "Team & Access")).toBeVisible();
  });

  test("Appearance switches between automatic, light and dark and remembers the choice", async ({ page }) => {
    await tid(page, "profile.appearance").click();
    const theme = () => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    await tid(page, "profile.theme.dark").click();
    expect(await theme()).toBe("dark");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 0, 0)");
    await tid(page, "profile.theme.light").click();
    expect(await theme()).toBe("light");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(242, 242, 247)");
    await tid(page, "profile.theme.dark").click();
    await page.reload();
    expect(await theme()).toBe("dark");
    await tid(page, "profile.appearance").click();
    await tid(page, "profile.theme.auto").click();
    expect(await theme()).toBeNull();
  });

  test("reset workspace: cancel, close, backdrop and Escape leave data alone; confirm restores the original", async ({ page }) => {
    // Make a change worth resetting: complete a task.
    await tid(page, "nav.home").click();
    await tid(page, "home.all-tasks").click();
    await tid(page, "tasks.toggle").first().click();
    await expect(page.getByText("4 open today")).toBeVisible();

    await tid(page, "nav.profile").click();
    for (const dismiss of ["profile.reset-confirm.cancel", "profile.reset-confirm.close"]) {
      await tid(page, "profile.reset").click();
      await expect(page.getByRole("dialog", { name: "Reset workspace data?" })).toBeVisible();
      await tid(page, dismiss).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    await tid(page, "profile.reset").click();
    await expect(page.getByRole("dialog", { name: "Reset workspace data?" })).toBeVisible();
    await tid(page, "profile.reset-confirm.backdrop").click({ position: { x: 6, y: 6 } }); // the dimmed backdrop
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await tid(page, "profile.reset").click();
    await expect(page.getByRole("dialog", { name: "Reset workspace data?" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await tid(page, "profile.reset").click();
    await tid(page, "profile.reset-confirm.confirm").click();
    await expect(heading(page, "Sign in to RetailMind")).toBeVisible();
    await expect(page.getByText("Workspace reset to its original data — sign in again.")).toBeVisible();

    await signInAs(page, "admin");
    await tid(page, "nav.home").click();
    await tid(page, "home.all-tasks").click();
    await expect(page.getByText("5 open today")).toBeVisible();
  });

  test("Sign out ends the session", async ({ page }) => {
    await tid(page, "profile.sign-out").click();
    await expect(heading(page, /Every aisle, every shelf/)).toBeVisible();
  });
});

test.describe("profile — other roles", () => {
  test("a manager sees notifications and store but no business summary or reset", async ({ page }) => {
    await signInAs(page, "manager");
    await tid(page, "nav.profile").click();
    await expect(tid(page, "profile.payments")).toHaveCount(0);
    await expect(tid(page, "profile.reset")).toHaveCount(0);
    await tid(page, "profile.notifications").click();
    await tid(page, "profile.pref.notify_orders").click();
    await expect(tid(page, "profile.pref.notify_orders")).not.toBeChecked();
    await tid(page, "profile.store").click();
    await expect(page.getByText(/You're assigned to/)).toContainText("Downtown Central #104");
    await expect(tid(page, "profile.go-team")).toHaveCount(0);
    await expect(page.getByText(/managed from Team & Access by an admin/)).toBeVisible();
  });

  test("a customer sees receipts, picks a preferred store and has no notification settings", async ({ page }) => {
    await signInAs(page, "customer");
    await tid(page, "nav.profile").click();
    await expect(tid(page, "profile.notifications")).toHaveCount(0);

    await tid(page, "profile.payments").click();
    await expect(page.getByText(/RetailMind never stores card numbers/)).toBeVisible();
    await expect(page.getByText(/AED \d+\.\d{2} · \d+ items? · \+\d+ pts/).first()).toBeVisible(); // her past orders

    await tid(page, "profile.store").click();
    const choices = tid(page, "profile.store.choose");
    await expect(choices).toHaveCount(4);
    await choices.filter({ hasText: "Riverside Mall" }).click();
    await expect(toast(page, "Preferred store updated")).toBeVisible();
    await expect(choices.filter({ hasText: "Riverside Mall" }).getByLabel("Selected")).toBeVisible();
    await tid(page, "nav.list").click();
    await expect(page.getByText("Checking out at Riverside Mall")).toBeVisible();
  });
});
