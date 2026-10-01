// Automated accessibility audit (axe-core, WCAG 2.1 A and AA plus best practice) over every screen, in light and dark,
// and over the dialogs, error states and tooltips that only exist after interaction. Any violation fails the build.
import AxeBuilder from "@axe-core/playwright";
import { expect, signInAs, test, tid } from "./fixtures.js";

// Animations off: a screen that is fading in is momentarily semi-transparent, and axe would measure that blend.
test.use({ reducedMotion: "reduce" });

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

async function audit(page, where) {
  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const report = violations.map((v) => `${v.id} [${v.impact}] ${v.help}\n    ${v.nodes.slice(0, 4).map((n) => `${n.target.join(" ")} — ${(n.failureSummary ?? "").split("\n")[1]?.trim()}`).join("\n    ")}`);
  expect(report, `accessibility violations on ${where}`).toEqual([]);
}

const SCREENS = {
  admin: ["home", "cashier", "tasks", "monitoring", "forecast", "procurement", "assistant", "warehouse", "analytics", "team", "profile"],
  staff: ["home", "cashier", "procurement"],
  customer: ["home", "list", "offers", "profile"],
};

for (const scheme of ["light", "dark"]) {
  test.describe(`${scheme} appearance`, () => {
    test.use({ colorScheme: scheme });

    test("landing page and sign-in", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await audit(page, "the landing page");
      await page.goto("/#/sign-in");
      await expect(page.getByRole("heading", { level: 1, name: "Sign in to RetailMind" })).toBeVisible();
      await audit(page, "sign-in");
    });

    for (const [role, routes] of Object.entries(SCREENS)) {
      test(`every ${role} screen`, async ({ page }) => {
        await signInAs(page, role);
        for (const route of routes) {
          await page.goto(`/#/${route}`);
          await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
          await page.waitForTimeout(400); // data and charts settle
          await audit(page, `${role} → ${route}`);
        }
      });
    }

    test("dialogs, forms and states that only appear after interaction", async ({ page }) => {
      await signInAs(page, "admin");

      // the notification sheet
      await tid(page, "home.bell").click();
      await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
      await audit(page, "the notifications sheet");
      await tid(page, "home.notifications.close").click();

      // a form sheet with its error banner showing
      await tid(page, "nav.team").click();
      await tid(page, "team.add").click();
      await tid(page, "team.form.submit").click();
      await expect(page.getByText("Enter a name and an email address.")).toBeVisible();
      await audit(page, "the add-member form with an error");
      await tid(page, "team.form.cancel").click();

      // a confirmation sheet
      await page.getByRole("button", { name: "Remove Aisha Khan" }).click();
      await expect(page.getByRole("dialog", { name: "Remove this team member?" })).toBeVisible();
      await audit(page, "a confirmation sheet");
      await tid(page, "team.remove-confirm.cancel").click();

      // a chart being inspected, and each forecasting method
      await tid(page, "nav.forecast").click();
      await tid(page, "forecast.chart.scrub").focus();
      await expect(page.locator(".xy__tip")).toBeVisible();
      await audit(page, "a chart tooltip");
      for (const method of ["xgboost", "lstm", "tft"]) {
        await tid(page, `forecast.method.${method}`).click();
        await expect(page.locator(".chart-legend")).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(/% MAPE/)).toBeVisible({ timeout: 30_000 });
      }
      await audit(page, "the forecast with the attention method");

      // procurement forms
      await tid(page, "nav.home").click();
      await tid(page, "home.tile.procurement").click();
      await tid(page, "procurement.tab.suppliers").click();
      await tid(page, "procurement.add-supplier").click();
      await tid(page, "procurement.supplier-form.save").click();
      await expect(page.getByText("Enter the supplier's name.")).toBeVisible();
      await audit(page, "the supplier form with an error");
      await tid(page, "procurement.supplier-form.cancel").click();
      await tid(page, "procurement.tab.products").click();
      await tid(page, "procurement.add-product").click();
      await audit(page, "the product form");
      await tid(page, "procurement.product-form.cancel").click();

      // the register: search results, a populated cart, a member and a receipt
      await tid(page, "nav.cashier").click();
      await tid(page, "cashier.search").fill("milk");
      await audit(page, "register search results");
      await tid(page, "cashier.add-product").first().click();
      await tid(page, "cashier.customer-search").fill("layla");
      await tid(page, "cashier.attach-customer").first().click();
      await tid(page, "cashier.payment").filter({ hasText: "Cash" }).click();
      await tid(page, "cashier.tendered").fill("5");
      await audit(page, "the register with a cart, a member and a short cash tender");
      await tid(page, "cashier.tendered").fill("50");
      await tid(page, "cashier.complete").click();
      await expect(page.locator(".receipt-card")).toBeVisible();
      await audit(page, "the receipt");

      // the assistant with a conversation
      await tid(page, "nav.home").click();
      await tid(page, "home.tile.assistant").click();
      await tid(page, "assistant.suggestion").first().click();
      await expect(page.locator(".bubble--assistant")).toHaveCount(1);
      await audit(page, "the assistant after an answer");
    });

    test("the customer's find-a-product sheet and a checkout receipt", async ({ page }) => {
      await signInAs(page, "customer");
      await tid(page, "customer-home.find").click();
      await tid(page, "find-product.search").fill("milk");
      await tid(page, "find-product.result").first().click();
      await audit(page, "a product's details");
      await tid(page, "find-product.close").click();
      await tid(page, "nav.list").click();
      await tid(page, "list.checkout").click();
      await expect(page.locator(".receipt")).toBeVisible();
      await audit(page, "the list after checking out");
    });
  });
}
