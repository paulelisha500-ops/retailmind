import { expect, signInAs, test, tid } from "./fixtures.js";

const h1 = (page, name) => page.getByRole("heading", { level: 1, name });
const toast = (page, text) => page.locator(".toast", { hasText: text }).last();
const sheet = (page, name) => page.getByRole("dialog", { name });
const row = (page, name) => page.locator("#main .list-row", { hasText: name });
const checkout = (page) => tid(page, "list.checkout");

async function openFinder(page) {
  await tid(page, "customer-home.find").click();
  await expect(sheet(page, "Find a product")).toBeVisible();
}

test.describe("home", () => {
  test.beforeEach(async ({ page }) => { await signInAs(page, "customer"); });

  test("shows loyalty points, a couple of offers and personal recommendations", async ({ page }) => {
    await expect(page.locator(".loyalty")).toContainText("1,240");
    await expect(page.locator(".loyalty")).toContainText("Gold tier");
    await expect(page.getByRole("heading", { name: "For you today" })).toBeVisible();
    await expect(page.locator(".offer")).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "Recommended for you" })).toBeVisible();
    await expect(page.locator(".reco").first()).toContainText(/You've bought this \d+ times? before/);
  });

  test("'See all' opens every offer", async ({ page }) => {
    await tid(page, "customer-home.see-offers").click();
    await expect(h1(page, "Offers")).toBeVisible();
    await expect(page.locator(".offer--wide")).toHaveCount(3);
    await expect(page.getByText("20% off fresh berries")).toBeVisible();
    await expect(page.getByText("Frozen bundle deal")).toBeVisible();
    await expect(page.getByText("Bakery: buy 1 get 1")).toBeVisible();
    await expect(page.getByText("Weekends only · Bakery")).toBeVisible();
  });
});

test.describe("find a product", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "customer");
    await openFinder(page);
  });

  test("closes by the close button, the backdrop and Escape", async ({ page }) => {
    await tid(page, "find-product.close").click();
    await expect(sheet(page, "Find a product")).toHaveCount(0);
    await openFinder(page);
    await tid(page, "find-product.backdrop").click({ position: { x: 6, y: 6 } });
    await expect(sheet(page, "Find a product")).toHaveCount(0);
    await openFinder(page);
    await page.keyboard.press("Escape");
    await expect(sheet(page, "Find a product")).toHaveCount(0);
  });

  test("asks for two characters, then finds by name, says when nothing matches, and finds by barcode", async ({ page }) => {
    const search = tid(page, "find-product.search");
    await expect(page.getByText("Type at least two characters to search.")).toBeVisible();
    await search.fill("a");
    await expect(page.getByText("Type at least two characters to search.")).toBeVisible();

    await search.fill("apple");
    await expect(tid(page, "find-product.result")).toHaveCount(1);
    await expect(tid(page, "find-product.result")).toContainText("Gala Apples (kg)");
    await expect(tid(page, "find-product.result")).toContainText("AED 8.90");

    await search.fill("zzzzz");
    await expect(page.getByText("No products match “zzzzz”.")).toBeVisible();

    await search.fill("8901000001018");
    await expect(tid(page, "find-product.result")).toHaveCount(1);
    await expect(tid(page, "find-product.result")).toContainText("Whole Milk (2L)");
  });

  test("shows price, diet tags, allergens and nutrition, and goes back to the results", async ({ page }) => {
    await tid(page, "find-product.search").fill("milk");
    await tid(page, "find-product.result").filter({ hasText: "Whole Milk (2L)" }).click();
    const dialog = sheet(page, "Whole Milk (2L)");
    await expect(dialog).toContainText("AED 12.50");
    await expect(dialog).toContainText("Contains milk");
    await expect(dialog).toContainText("61");
    await expect(dialog).toContainText("kcal");
    await tid(page, "find-product.back").click();
    await expect(sheet(page, "Find a product")).toBeVisible();
    await expect(tid(page, "find-product.search")).toHaveValue("milk");

    await tid(page, "find-product.search").fill("spinach");
    await tid(page, "find-product.result").click();
    await expect(sheet(page, "Baby Spinach (200g)")).toContainText("Keto-friendly");
  });

  test("adding a product puts it on the list and opens the list", async ({ page }) => {
    await tid(page, "find-product.search").fill("croissant");
    await tid(page, "find-product.result").click();
    await tid(page, "find-product.add").click();
    await expect(toast(page, "Croissants (4-pack) added to your list")).toBeVisible();
    await expect(h1(page, "Shopping List")).toBeVisible();
    await expect(row(page, "Croissants (4-pack)")).toBeVisible();
  });

  test("adding something already waiting on the list raises its quantity instead of duplicating it", async ({ page }) => {
    await tid(page, "find-product.search").fill("yogurt");
    await tid(page, "find-product.result").click();
    await tid(page, "find-product.add").click();
    await expect(h1(page, "Shopping List")).toBeVisible();
    await expect(page.locator("#main .list-row", { hasText: "Greek Yogurt (500g)" })).toHaveCount(1);
    await expect(row(page, "Greek Yogurt (500g)").locator(".stepper span")).toHaveText("2");
  });
});

test.describe("shopping list", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "customer");
    await tid(page, "nav.list").click();
    await expect(h1(page, "Shopping List")).toBeVisible();
  });

  test("starts with the saved list, the store it will check out at, and the total of what is ticked", async ({ page }) => {
    await expect(page.getByText("Checking out at Downtown Central")).toBeVisible();
    await expect(page.locator("#main .list-row")).toHaveCount(5);
    await expect(checkout(page)).toHaveText("Check out 2 items · AED 22.40");
    await expect(row(page, "Whole Milk (2L)").getByRole("checkbox")).toBeChecked();
    await expect(row(page, "Greek Yogurt (500g)").getByRole("checkbox")).not.toBeChecked();
  });

  test("ticking and unticking changes the total, and the button disappears when nothing is ticked", async ({ page }) => {
    await row(page, "Greek Yogurt (500g)").getByRole("checkbox").check();
    await expect(checkout(page)).toHaveText("Check out 3 items · AED 34.30");
    await row(page, "Whole Milk (2L)").getByRole("checkbox").uncheck();
    await row(page, "Sourdough Loaf").getByRole("checkbox").uncheck();
    await expect(checkout(page)).toHaveText("Check out 1 item · AED 11.90");
    await row(page, "Greek Yogurt (500g)").getByRole("checkbox").uncheck();
    await expect(checkout(page)).toHaveCount(0);
  });

  test("quantities step up and down, and the minimum is one", async ({ page }) => {
    const milk = row(page, "Whole Milk (2L)");
    await expect(milk.getByRole("button", { name: /Decrease/ })).toBeDisabled();
    await milk.getByRole("button", { name: /Increase/ }).click();
    await expect(milk.locator(".stepper span")).toHaveText("2");
    await expect(checkout(page)).toHaveText("Check out 2 items · AED 34.90"); // 2 × 12.50 + 9.90
    await milk.getByRole("button", { name: /Decrease/ }).click();
    await expect(milk.locator(".stepper span")).toHaveText("1");
    await expect(milk.getByRole("button", { name: /Decrease/ })).toBeDisabled();
  });

  test("items can be removed, down to an empty list", async ({ page }) => {
    await page.getByRole("button", { name: "Remove Baby Spinach (200g)" }).click();
    await expect(row(page, "Baby Spinach (200g)")).toHaveCount(0);
    for (let left = 4; left > 0; left--) {
      await tid(page, "list.remove").first().click();
      await expect(page.locator("#main .list-row")).toHaveCount(left - 1);
    }
    await expect(page.getByText("Your list is empty.")).toBeVisible();
    await expect(checkout(page)).toHaveCount(0);
  });

  test("checking out turns what is ticked into an order, earns points, and keeps the rest on the list", async ({ page }) => {
    await checkout(page).click();
    await expect(toast(page, "Checked out — AED 22.40")).toBeVisible();
    await expect(page.locator(".receipt")).toContainText("Thanks — AED 22.40");
    await expect(page.locator(".receipt")).toContainText("You earned 22 loyalty points on 2 items.");
    await expect(page.locator("#main .list-row")).toHaveCount(3);
    await expect(checkout(page)).toHaveCount(0);

    await tid(page, "nav.home").click();
    await expect(page.locator(".loyalty")).toContainText("1,262");
    await tid(page, "nav.profile").click();
    await tid(page, "profile.payments").click();
    await expect(page.getByText(/AED 22\.40 · 2 items · \+22 pts/)).toBeVisible();
  });

  test("a store chosen in Profile is the one the order is placed at", async ({ page }) => {
    await tid(page, "nav.profile").click();
    await tid(page, "profile.store").click();
    await tid(page, "profile.store.choose").filter({ hasText: "Airport Plaza" }).click();
    await tid(page, "nav.list").click();
    await expect(page.getByText("Checking out at Airport Plaza")).toBeVisible();
    await checkout(page).click();
    await expect(toast(page, "Checked out")).toBeVisible();
  });
});

test.describe("offers", () => {
  test("lists what is running", async ({ page }) => {
    await signInAs(page, "customer");
    await tid(page, "nav.offers").click();
    await expect(h1(page, "Offers")).toBeVisible();
    await expect(page.locator(".offer--wide")).toHaveCount(3);
  });
});
