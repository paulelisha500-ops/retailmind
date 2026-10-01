import { expect, signInAs, test, tid } from "./fixtures.js";

const h1 = (page, name) => page.getByRole("heading", { level: 1, name });
const toast = (page, text) => page.locator(".toast", { hasText: text }).last();
const sheet = (page, name) => page.getByRole("dialog", { name });
const line = (page, name) => page.locator(".list-row", { hasText: name }).filter({ has: tid(page, "cashier.qty.plus") });
const totals = (page) => page.locator(".totals");
const receipt = (page) => page.locator(".receipt-card");
const complete = (page) => tid(page, "cashier.complete");

async function openCashier(page, role = "staff") {
  await signInAs(page, role);
  await tid(page, "nav.cashier").click();
  await expect(h1(page, "Cashier")).toBeVisible();
}

/** Searches the catalogue and adds the first matching result. */
async function addProduct(page, query, name) {
  await tid(page, "cashier.search").fill(query);
  await tid(page, "cashier.add-product").filter({ hasText: name }).first().click();
  await expect(line(page, name)).toBeVisible();
}

test.describe("building a sale", () => {
  test.beforeEach(async ({ page }) => { await openCashier(page); });

  test("starts empty, with nothing to complete", async ({ page }) => {
    await expect(page.getByText("Search above to add items to this sale.")).toBeVisible();
    await expect(complete(page)).toBeDisabled();
    await expect(totals(page)).toContainText("AED 0.00");
  });

  test("searches by name, SKU and barcode, and says when nothing matches", async ({ page }) => {
    const search = tid(page, "cashier.search");
    await search.fill("milk");
    await expect(tid(page, "cashier.add-product").first()).toContainText("Whole Milk (2L)");
    await expect(tid(page, "cashier.add-product").first()).toContainText("SKU-1101 · Dairy & Chilled");
    await search.fill("SKU-1201");
    await expect(tid(page, "cashier.add-product")).toHaveCount(1);
    await expect(tid(page, "cashier.add-product")).toContainText("Frozen Peas (1kg)");
    await search.fill("8901000003029");
    await expect(tid(page, "cashier.add-product")).toContainText("Croissants (4-pack)");
    await search.fill("zzzz-not-a-product");
    await expect(page.getByText("No matches.")).toBeVisible();
  });

  test("a scanner's Enter adds an exact barcode or SKU, or a single match, and ignores anything else", async ({ page }) => {
    const search = tid(page, "cashier.search");
    await search.fill("8901000001018");
    await search.press("Enter");
    await expect(line(page, "Whole Milk (2L)")).toBeVisible();
    await expect(search).toHaveValue("");

    await search.fill("sku-1001");
    await search.press("Enter");
    await expect(line(page, "Gala Apples (kg)")).toBeVisible();

    await search.fill("croissant");
    await search.press("Enter");
    await expect(line(page, "Croissants (4-pack)")).toBeVisible();

    await search.fill("qqq");
    await search.press("Enter");
    await expect(page.locator(".list-row").filter({ has: tid(page, "cashier.qty.plus") })).toHaveCount(3);
    // Scanning something already in the cart bumps its quantity instead of adding a second line.
    await search.fill("8901000001018");
    await search.press("Enter");
    await expect(line(page, "Whole Milk (2L)").locator(".stepper span")).toHaveText("2");
    await expect(page.getByRole("heading", { name: "Cart · 4 items" })).toBeVisible();
  });

  test("quantities step up and down, lines can be removed, and the totals follow", async ({ page }) => {
    await addProduct(page, "milk", "Whole Milk (2L)");
    await addProduct(page, "yogurt", "Greek Yogurt (500g)");
    const milk = line(page, "Whole Milk (2L)");
    await expect(totals(page)).toContainText("AED 24.40"); // 12.50 + 11.90
    await expect(milk.getByRole("button", { name: /Decrease/ })).toBeDisabled();

    await tid(page, "cashier.qty.plus").first().click();
    await expect(milk.locator(".stepper span")).toHaveText("2");
    await expect(milk).toContainText("AED 25.00");
    await expect(totals(page)).toContainText("AED 36.90");
    await tid(page, "cashier.qty.plus").first().click();
    await tid(page, "cashier.qty.minus").first().click();
    await expect(milk.locator(".stepper span")).toHaveText("2");

    await page.getByRole("button", { name: "Remove Greek Yogurt (500g)" }).click();
    await expect(line(page, "Greek Yogurt (500g)")).toHaveCount(0);
    await expect(totals(page)).toContainText("AED 25.00");
    await tid(page, "cashier.remove-line").click();
    await expect(page.getByText("Search above to add items to this sale.")).toBeVisible();
    await expect(complete(page)).toBeDisabled();
  });

  test("a sale can't be completed until a payment method is chosen", async ({ page }) => {
    await addProduct(page, "milk", "Whole Milk (2L)");
    await expect(complete(page)).toBeDisabled();
    await tid(page, "cashier.payment").filter({ hasText: "Card" }).click();
    await expect(complete(page)).toBeEnabled();
    await expect(complete(page)).toContainText("Complete sale · AED 12.50");
  });
});

test.describe("taking payment", () => {
  test.beforeEach(async ({ page }) => { await openCashier(page); });

  test("cash needs enough tendered, and shows the change due", async ({ page }) => {
    await addProduct(page, "milk", "Whole Milk (2L)");
    await tid(page, "cashier.qty.plus").first().click();
    await tid(page, "cashier.payment").filter({ hasText: "Cash" }).click();
    await expect(tid(page, "cashier.tendered")).toBeVisible();
    await expect(complete(page)).toBeDisabled(); // nothing tendered yet

    await tid(page, "cashier.tendered").fill("10");
    await expect(page.getByText("Tendered amount is below the total due.")).toBeVisible();
    await expect(complete(page)).toBeDisabled();

    await tid(page, "cashier.tendered").fill("50");
    await expect(totals(page)).toContainText("Change due");
    await expect(totals(page)).toContainText("AED 25.00");
    await expect(complete(page)).toBeEnabled();
    await complete(page).click();

    await expect(toast(page, "Sale complete — AED 25.00")).toBeVisible();
    await expect(receipt(page)).toContainText("Sale complete");
    await expect(receipt(page)).toContainText("AED 25.00");
    await expect(receipt(page)).toContainText("Guest · Cash · Change due AED 25.00");
    await expect(receipt(page)).toContainText("2× Whole Milk (2L)");
  });

  test("every payment method can be selected, and rings up with its own name on the receipt", async ({ page }) => {
    const methods = ["Cash", "Card", "Apple Pay", "Google Pay", "Samsung Pay", "Tabby"];
    await expect(tid(page, "cashier.payment")).toHaveCount(methods.length);
    for (const method of methods) {
      await addProduct(page, "peas", "Frozen Peas (1kg)");
      await tid(page, "cashier.payment").filter({ hasText: method }).click();
      await expect(tid(page, "cashier.payment").filter({ hasText: method })).toHaveAttribute("aria-pressed", "true");
      if (method === "Cash") await tid(page, "cashier.tendered").fill("6.2");
      else await expect(tid(page, "cashier.tendered")).toHaveCount(0);
      await complete(page).click();
      await expect(receipt(page)).toContainText(`Guest · ${method}`);
      await expect(receipt(page)).toContainText("AED 6.20");
      await tid(page, "cashier.new-sale").click();
      await expect(page.getByText("Search above to add items to this sale.")).toBeVisible();
    }
  });

  test("choosing another method replaces the first", async ({ page }) => {
    await addProduct(page, "milk", "Whole Milk (2L)");
    await tid(page, "cashier.payment").filter({ hasText: "Tabby" }).click();
    await tid(page, "cashier.payment").filter({ hasText: "Card" }).click();
    await expect(tid(page, "cashier.payment").filter({ hasText: "Tabby" })).toHaveAttribute("aria-pressed", "false");
    await expect(tid(page, "cashier.payment").filter({ hasText: "Card" })).toHaveAttribute("aria-pressed", "true");
  });

  test("a sale draws stock down, so the item can drop into 'needs reordering'", async ({ page }) => {
    // Sourdough is already below its reorder point; selling more must not break that or the shelf figures.
    await addProduct(page, "sourdough", "Sourdough Loaf");
    await tid(page, "cashier.payment").filter({ hasText: "Card" }).click();
    await complete(page).click();
    await expect(receipt(page)).toContainText("1× Sourdough Loaf");
    await tid(page, "nav.profile").click();
    await tid(page, "nav.home").click();
    await tid(page, "home.tile.procurement").click();
    await tid(page, "procurement.tab.suppliers").click();
    await expect(page.getByText(/Sourdough Loaf/).first()).toBeVisible();
    await expect(page.getByText(/31 on hand/)).toBeVisible();
  });
});

test.describe("loyalty customers at the register", () => {
  test.beforeEach(async ({ page }) => { await openCashier(page); });

  test("finds a member by name or phone, attaches them, and can change", async ({ page }) => {
    await tid(page, "cashier.customer-search").fill("zzz");
    await expect(page.getByText("No match — ring it up as a walk-in, or enroll them.")).toBeVisible();
    await tid(page, "cashier.customer-search").fill("layla");
    await tid(page, "cashier.attach-customer").filter({ hasText: "Layla Hassan" }).click();
    await expect(page.locator(".member")).toContainText("Layla Hassan");
    await expect(page.locator(".member")).toContainText("1240 pts");
    await tid(page, "cashier.change-customer").click();
    await expect(tid(page, "cashier.customer-search")).toHaveValue("");

    await tid(page, "cashier.customer-search").fill("+971-55-200-2003");
    await tid(page, "cashier.attach-customer").filter({ hasText: "Fatima Al Zaabi" }).click();
    await expect(page.locator(".member")).toContainText(/\d{4} pts/); // her seeded balance plus what her orders earned
  });

  test("redeems points against the total, and earns new ones on what is paid", async ({ page }) => {
    await addProduct(page, "milk", "Whole Milk (2L)");
    await tid(page, "cashier.qty.plus").first().click();
    await addProduct(page, "yogurt", "Greek Yogurt (500g)"); // 36.90
    await tid(page, "cashier.customer-search").fill("layla");
    await tid(page, "cashier.attach-customer").click();

    await tid(page, "cashier.redeem").fill("500");
    await expect(totals(page)).toContainText("Points discount");
    await expect(totals(page)).toContainText("−AED 5.00");
    await expect(complete(page)).toContainText("AED 31.90");

    // More than she has is capped at what she has (1,240 points = AED 12.40).
    await tid(page, "cashier.redeem").fill("99999");
    await expect(totals(page)).toContainText("−AED 12.40");
    await tid(page, "cashier.redeem").fill("500");

    await tid(page, "cashier.payment").filter({ hasText: "Card" }).click();
    await complete(page).click();
    await expect(receipt(page)).toContainText("Layla Hassan · Card");
    await expect(receipt(page)).toContainText("31 loyalty points earned · 500 redeemed");
    await tid(page, "cashier.new-sale").click();

    // 1,240 − 500 + 31
    await tid(page, "cashier.tab.customers").click();
    await tid(page, "directory.search").fill("layla");
    await expect(tid(page, "directory.open").filter({ hasText: "Layla Hassan" })).toContainText("771 pts");
  });

  test("enrolls a new member from the register; the sheet closes four ways and validates", async ({ page }) => {
    for (const how of ["cancel", "close", "backdrop", "escape"]) {
      await tid(page, "cashier.new-customer").click();
      await expect(sheet(page, "New loyalty member")).toBeVisible();
      if (how === "escape") await page.keyboard.press("Escape");
      else if (how === "backdrop") await tid(page, "cashier.enroll.backdrop").click({ position: { x: 6, y: 6 } });
      else await tid(page, `cashier.enroll.${how}`).click();
      await expect(sheet(page, "New loyalty member")).toHaveCount(0);
    }

    await tid(page, "cashier.new-customer").click();
    await tid(page, "cashier.enroll.submit").click();
    await expect(page.getByText("Enter a name and a phone number.")).toBeVisible();
    await tid(page, "cashier.enroll.name").fill("Maryam Al Nuaimi");
    await tid(page, "cashier.enroll.submit").click();
    await expect(page.getByText("Enter a name and a phone number.")).toBeVisible();
    await tid(page, "cashier.enroll.phone").fill("+971-50-777-0101");
    await tid(page, "cashier.enroll.email").fill("maryam@members.retailmind.app");
    await tid(page, "cashier.enroll.submit").click();

    await expect(toast(page, "Maryam Al Nuaimi enrolled")).toBeVisible();
    await expect(page.locator(".member")).toContainText("Maryam Al Nuaimi");
    await expect(page.locator(".member")).toContainText("0 pts");
    await expect(tid(page, "cashier.redeem")).toHaveCount(0); // nothing to redeem yet
  });

  test("a phone number that is already on file brings back that member instead of a duplicate", async ({ page }) => {
    await tid(page, "cashier.new-customer").click();
    await tid(page, "cashier.enroll.name").fill("Someone Else");
    await tid(page, "cashier.enroll.phone").fill("+971-55-200-2001");
    await tid(page, "cashier.enroll.submit").click();
    await expect(page.locator(".member")).toContainText("Layla Hassan");
  });

  test("the server's own message shows when an email is already taken", async ({ page }) => {
    await tid(page, "cashier.new-customer").click();
    await tid(page, "cashier.enroll.name").fill("Email Clash");
    await tid(page, "cashier.enroll.phone").fill("+971-50-777-0202");
    await tid(page, "cashier.enroll.email").fill("layla@members.retailmind.app");
    await tid(page, "cashier.enroll.submit").click();
    await expect(sheet(page, "New loyalty member").getByRole("alert")).toHaveText("An account with that email already exists");
  });
});

test.describe("customer directory", () => {
  test.beforeEach(async ({ page }) => {
    await openCashier(page);
    await tid(page, "cashier.tab.customers").click();
    await expect(tid(page, "cashier.tab.customers")).toHaveAttribute("aria-pressed", "true");
  });

  test("lists members, filters them, and says when nobody matches", async ({ page }) => {
    await expect(tid(page, "directory.open")).toHaveCount(5);
    await tid(page, "directory.search").fill("fatima");
    await expect(tid(page, "directory.open")).toHaveCount(1);
    await tid(page, "directory.search").fill("+971-55-200-2005");
    await expect(tid(page, "directory.open")).toContainText("Noora Hassan");
    await tid(page, "directory.search").fill("nobody-here");
    await expect(page.getByText("No customers found.")).toBeVisible();
    await tid(page, "directory.search").fill("");
    await expect(tid(page, "directory.open")).toHaveCount(5);
  });

  test("opens a member's profile with their order history, and goes back", async ({ page }) => {
    await tid(page, "directory.open").filter({ hasText: "Layla Hassan" }).click();
    await expect(page.getByText("Gold tier · 1240 pts")).toBeVisible();
    await expect(page.getByText(/Member since/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Order history" })).toBeVisible();
    await expect(page.locator("#main .list-row").first()).toContainText(/AED \d+\.\d{2} · \d+ items?/);
    await tid(page, "directory.back").click();
    await expect(tid(page, "directory.open")).toHaveCount(5);

    await tid(page, "directory.open").filter({ hasText: "Noora Hassan" }).click();
    await expect(page.getByText("No orders yet.")).toBeVisible();
    await tid(page, "directory.back").click();
  });

  test("enrolls a new member and lands on their profile", async ({ page }) => {
    await tid(page, "directory.new").click();
    await tid(page, "cashier.enroll.name").fill("Khalid Rahman");
    await tid(page, "cashier.enroll.phone").fill("+971-50-777-0303");
    await tid(page, "cashier.enroll.submit").click();
    await expect(toast(page, "Khalid Rahman enrolled")).toBeVisible();
    await expect(page.getByText("Bronze tier · 0 pts")).toBeVisible();
    await tid(page, "directory.back").click();
    await expect(tid(page, "directory.open")).toHaveCount(6);
  });

  test("switching back to Checkout keeps the register ready", async ({ page }) => {
    await tid(page, "cashier.tab.checkout").click();
    await expect(page.getByText("Search above to add items to this sale.")).toBeVisible();
  });
});

test.describe("access", () => {
  test("customers can't reach the register", async ({ page }) => {
    await signInAs(page, "customer");
    await page.goto("./#/cashier");
    await expect(h1(page, /Hi, Layla/)).toBeVisible();
  });
});
