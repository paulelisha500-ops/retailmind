import { expect, signInAs, test, tid } from "./fixtures.js";

const h1 = (page, name) => page.getByRole("heading", { level: 1, name });
const toast = (page, text) => page.locator(".toast", { hasText: text }).last();
const sheet = (page, name) => page.getByRole("dialog", { name });
const csv = (name, text) => ({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
const supplierCard = (page, name) => page.locator("article.card", { hasText: name }).filter({ has: tid(page, "procurement.edit-supplier") });
const productRow = (page, name) => page.locator(".list-row", { hasText: name });

async function openProcurement(page, role = "admin", tab = "orders") {
  await signInAs(page, role);
  await tid(page, "home.tile.procurement").click();
  await expect(h1(page, "Procurement")).toBeVisible();
  if (tab !== "orders") {
    await tid(page, `procurement.tab.${tab}`).click();
    await expect(tid(page, `procurement.tab.${tab}`)).toHaveAttribute("aria-pressed", "true");
  }
}

test.describe("purchase orders", () => {
  test("an admin approves a draft, and it moves to history as sent", async ({ page }) => {
    await openProcurement(page);
    await expect(page.getByText("PO-1042")).toBeVisible();
    await expect(page.getByText("340× Whole Milk (2L)")).toBeVisible();
    await expect(page.getByText(/AI-drafted|forecast/i).first()).toBeVisible();
    await tid(page, "procurement.approve").click();
    await expect(toast(page, "PO-1042 approved")).toBeVisible();
    await expect(page.getByText("No drafts waiting — all caught up.")).toBeVisible();
    await expect(page.locator(".list-row", { hasText: "PO-1042" }).getByText("Sent to supplier")).toBeVisible();
  });

  test("rejecting a draft records it as rejected", async ({ page }) => {
    await signInAs(page, "admin");
    await tid(page, "nav.team").click();
    await tid(page, "team.mode.enterprise").click();
    await tid(page, "team.store").filter({ hasText: "Riverside Mall" }).click();
    await tid(page, "nav.home").click();
    await tid(page, "home.tile.procurement").click();
    await expect(page.getByText("PO-1043")).toBeVisible();
    await tid(page, "procurement.reject").click();
    await expect(toast(page, "PO-1043 rejected")).toBeVisible();
    await expect(page.locator(".list-row", { hasText: "PO-1043" }).getByText("Rejected")).toBeVisible();
    await expect(tid(page, "procurement.reject")).toHaveCount(0);
  });

  test("someone without approval rights sees the order but not the buttons", async ({ page }) => {
    await openProcurement(page, "staff");
    await expect(page.getByText("PO-1042")).toBeVisible();
    await expect(page.getByText("Pending admin approval")).toBeVisible();
    await expect(tid(page, "procurement.approve")).toHaveCount(0);
    await expect(tid(page, "procurement.reject")).toHaveCount(0);
  });

  test("the three sections each open, and Back returns home", async ({ page }) => {
    await openProcurement(page);
    for (const tab of ["suppliers", "products", "orders"]) {
      await tid(page, `procurement.tab.${tab}`).click();
      await expect(tid(page, `procurement.tab.${tab}`)).toHaveAttribute("aria-pressed", "true");
    }
    await tid(page, "procurement.back").click();
    await expect(h1(page, /Hi, Marcus/)).toBeVisible();
  });
});

test.describe("suppliers", () => {
  test.beforeEach(async ({ page }) => { await openProcurement(page, "admin", "suppliers"); });

  test("lists every supplier, best performer first", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "5 suppliers" })).toBeVisible();
    const names = await page.locator("article.card .t-headline").allInnerTexts();
    const ranked = names.filter((n) => ["Polar Cold Logistics", "Fresh Farms Co.", "Prime Cut Meats", "Nordic Dairy Direct", "Golden Wheat Bakers"].includes(n));
    expect(ranked).toEqual(["Polar Cold Logistics", "Fresh Farms Co.", "Prime Cut Meats", "Nordic Dairy Direct", "Golden Wheat Bakers"]);
  });

  test("flags items below their reorder point and logs an email or a call to the supplier", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Needs reordering (1)" })).toBeVisible();
    await expect(page.getByText(/Sourdough Loaf/).first()).toBeVisible();
    await expect(page.getByText(/reorder point 55/)).toBeVisible();

    await tid(page, "procurement.notify-email").click();
    await expect(toast(page, "Email to Golden Wheat Bakers logged")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Outreach log" })).toBeVisible();
    const entries = page.locator("#main .list-row", { hasText: "Golden Wheat Bakers" });
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText("Logged · not sent");
    await expect(entries.first()).toContainText("Sourdough Loaf is low on stock");

    await tid(page, "procurement.notify-call").click();
    await expect(toast(page, "Call to Golden Wheat Bakers logged")).toBeVisible();
    await expect(entries).toHaveCount(2);
  });

  test("every form can be dismissed without saving", async ({ page }) => {
    for (const how of ["cancel", "close", "backdrop", "escape"]) {
      await tid(page, "procurement.add-supplier").click();
      await expect(sheet(page, "Add supplier")).toBeVisible();
      if (how === "escape") await page.keyboard.press("Escape");
      else if (how === "backdrop") await tid(page, "procurement.supplier-form.backdrop").click({ position: { x: 6, y: 6 } });
      else await tid(page, `procurement.supplier-form.${how}`).click();
      await expect(sheet(page, "Add supplier")).toHaveCount(0);
    }
    await expect(page.getByRole("heading", { name: "5 suppliers" })).toBeVisible();
  });

  test("a supplier needs a name and a plausible email", async ({ page }) => {
    await tid(page, "procurement.add-supplier").click();
    await tid(page, "procurement.supplier-form.save").click();
    await expect(page.getByText("Enter the supplier's name.")).toBeVisible();
    await tid(page, "procurement.supplier-form.name").fill("Blue Harbour Seafood");
    await tid(page, "procurement.supplier-form.email").fill("orders-at-blueharbour");
    await tid(page, "procurement.supplier-form.save").click();
    await expect(page.getByText("Contact email doesn't look like a valid email address.")).toBeVisible();
  });

  test("adds a supplier with every field, then edits it", async ({ page }) => {
    await tid(page, "procurement.add-supplier").click();
    await tid(page, "procurement.supplier-form.name").fill("Blue Harbour Seafood");
    await tid(page, "procurement.supplier-form.category").fill("Meat & Seafood");
    await tid(page, "procurement.supplier-form.email").fill("orders@blueharbour.internal");
    await tid(page, "procurement.supplier-form.phone").fill("+971 4 555 0199");
    await tid(page, "procurement.supplier-form.licence").fill("DED-882211");
    await tid(page, "procurement.supplier-form.trn").fill("100987654300003");
    await tid(page, "procurement.supplier-form.terms").fill("Net 15");
    for (const chain of ["ambient", "chilled", "frozen", "mixed"]) {
      await tid(page, `procurement.supplier-form.cold-chain.${chain}`).click();
      await expect(tid(page, `procurement.supplier-form.cold-chain.${chain}`)).toHaveAttribute("aria-pressed", "true");
    }
    await tid(page, "procurement.supplier-form.cold-chain.chilled").click();
    await tid(page, "procurement.supplier-form.status").selectOption("compliance_review");
    await tid(page, "procurement.supplier-form.save").click();

    await expect(toast(page, "Blue Harbour Seafood added")).toBeVisible();
    await expect(page.getByRole("heading", { name: "6 suppliers" })).toBeVisible();
    const card = supplierCard(page, "Blue Harbour Seafood");
    await expect(card).toContainText("Licence DED-882211 · TRN 100987654300003");
    await expect(card).toContainText("compliance review");
    await expect(card).toContainText("Net 15");
    await expect(card).toContainText("chilled");

    await card.getByRole("button", { name: "Edit" }).click();
    await expect(sheet(page, "Edit supplier")).toBeVisible();
    await expect(tid(page, "procurement.supplier-form.name")).toHaveValue("Blue Harbour Seafood");
    await tid(page, "procurement.supplier-form.name").fill("Blue Harbour Fisheries");
    await tid(page, "procurement.supplier-form.terms").fill("Net 45");
    await tid(page, "procurement.supplier-form.status").selectOption("approved");
    await tid(page, "procurement.supplier-form.save").click();
    await expect(toast(page, "Supplier updated")).toBeVisible();
    const renamed = supplierCard(page, "Blue Harbour Fisheries");
    await expect(renamed).toContainText("Net 45");
    await expect(renamed).toContainText("approved");
    await expect(page.getByText("Blue Harbour Seafood")).toHaveCount(0);
  });

  test("a supplier nothing refers to can be deleted; one with products is protected", async ({ page }) => {
    await tid(page, "procurement.add-supplier").click();
    await tid(page, "procurement.supplier-form.name").fill("Temporary Vendor");
    await tid(page, "procurement.supplier-form.save").click();
    await expect(toast(page, "Temporary Vendor added")).toBeVisible();

    // Cancelling, closing and the backdrop leave it alone.
    for (const how of ["cancel", "close", "backdrop"]) {
      await supplierCard(page, "Temporary Vendor").getByRole("button", { name: "Delete" }).click();
      await expect(sheet(page, "Delete supplier?")).toBeVisible();
      if (how === "backdrop") await tid(page, "procurement.delete-confirm.backdrop").click({ position: { x: 6, y: 6 } });
      else await tid(page, `procurement.delete-confirm.${how}`).click();
      await expect(sheet(page, "Delete supplier?")).toHaveCount(0);
    }
    await expect(supplierCard(page, "Temporary Vendor")).toBeVisible();

    await supplierCard(page, "Temporary Vendor").getByRole("button", { name: "Delete" }).click();
    await tid(page, "procurement.delete-confirm.confirm").click();
    await expect(toast(page, "Temporary Vendor deleted")).toBeVisible();
    await expect(page.getByRole("heading", { name: "5 suppliers" })).toBeVisible();

    await supplierCard(page, "Fresh Farms Co.").getByRole("button", { name: "Delete" }).click();
    await tid(page, "procurement.delete-confirm.confirm").click();
    await expect(page.getByRole("alert").filter({ hasText: /Can't delete — this supplier has products/ })).toBeVisible();
    await expect(supplierCard(page, "Fresh Farms Co.")).toBeVisible();
  });

  test("imports suppliers from a CSV: creates, updates, and reports rows it skipped", async ({ page }) => {
    await tid(page, "procurement.import-suppliers").setInputFiles(csv("suppliers.csv", [
      "name,category,contact_email,payment_terms,onboarding_status",
      "Blue Harbour Seafood,Meat & Seafood,orders@blueharbour.internal,Net 15,approved",
      "Polar Cold Logistics,Frozen,orders@polarcold.internal,Net 60,approved",
      "No Email Co,Produce,not-an-email,Net 30,pending",
      ",Produce,,,",
    ].join("\n")));
    const result = page.locator(".banner", { hasText: "Imported:" });
    await expect(result).toContainText("1 created, 1 updated");
    await expect(result).toContainText("2 row issues");
    await expect(result).toContainText("contact_email is not a valid email");
    await expect(page.getByRole("heading", { name: "6 suppliers" })).toBeVisible();
    await expect(supplierCard(page, "Polar Cold Logistics")).toContainText("Net 60");
  });

  test("rejects a file that isn't a CSV or is missing required columns", async ({ page }) => {
    await tid(page, "procurement.import-suppliers").setInputFiles({ name: "suppliers.txt", mimeType: "text/plain", buffer: Buffer.from("name,category\nX,Y") });
    await expect(page.getByRole("alert").filter({ hasText: "Please upload a .csv file" })).toBeVisible();
    await tid(page, "procurement.import-suppliers").setInputFiles(csv("suppliers.csv", "name,contact_email\nX,x@y.internal"));
    await expect(page.getByRole("alert").filter({ hasText: "CSV is missing required column(s): category" })).toBeVisible();
  });
});

test.describe("products", () => {
  test.beforeEach(async ({ page }) => { await openProcurement(page, "admin", "products"); });

  test("lists the catalogue with price, reorder point and margin", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "15 products" })).toBeVisible();
    await expect(productRow(page, "Whole Milk (2L)")).toContainText(/SKU-1101 · Dairy & Chilled · AED 12\.50 · reorder at 70 · \d+% margin/);
  });

  test("every form can be dismissed without saving", async ({ page }) => {
    for (const how of ["cancel", "close", "backdrop", "escape"]) {
      await tid(page, "procurement.add-product").click();
      await expect(sheet(page, "Add product")).toBeVisible();
      if (how === "escape") await page.keyboard.press("Escape");
      else if (how === "backdrop") await tid(page, "procurement.product-form.backdrop").click({ position: { x: 6, y: 6 } });
      else await tid(page, `procurement.product-form.${how}`).click();
      await expect(sheet(page, "Add product")).toHaveCount(0);
    }
  });

  test("validates before it saves, one rule at a time", async ({ page }) => {
    await tid(page, "procurement.add-product").click();
    const save = tid(page, "procurement.product-form.save");
    await save.click();
    await expect(page.getByText("SKU and name are required.")).toBeVisible();

    await tid(page, "procurement.product-form.sku").fill("SKU-9001");
    await tid(page, "procurement.product-form.name").fill("Olive Oil (1L)");
    await tid(page, "procurement.product-form.price").fill("0");
    await save.click();
    await expect(page.getByText("Price must be greater than 0.")).toBeVisible();

    await tid(page, "procurement.product-form.price").fill("32.5");
    await tid(page, "procurement.product-form.cost").fill("-1");
    await save.click();
    await expect(page.getByText("Cost price can't be negative.")).toBeVisible();

    await tid(page, "procurement.product-form.cost").fill("24");
    await tid(page, "procurement.product-form.threshold").fill("-3");
    await save.click();
    await expect(page.getByText("Reorder threshold must be 0 or more.")).toBeVisible();
  });

  test("refuses a duplicate SKU with the server's message", async ({ page }) => {
    await tid(page, "procurement.add-product").click();
    await tid(page, "procurement.product-form.sku").fill("SKU-1001");
    await tid(page, "procurement.product-form.name").fill("Another Apple");
    await tid(page, "procurement.product-form.price").fill("5");
    await tid(page, "procurement.product-form.save").click();
    await expect(sheet(page, "Add product").getByRole("alert")).toHaveText("SKU SKU-1001 already exists");
  });

  test("adds a product with every field, then edits it (the SKU stays fixed)", async ({ page }) => {
    await tid(page, "procurement.add-product").click();
    await tid(page, "procurement.product-form.sku").fill("SKU-9001");
    await tid(page, "procurement.product-form.name").fill("Olive Oil (1L)");
    await tid(page, "procurement.product-form.category").fill("Pantry");
    await tid(page, "procurement.product-form.unit").fill("L");
    await tid(page, "procurement.product-form.price").fill("32.5");
    await tid(page, "procurement.product-form.cost").fill("24");
    await tid(page, "procurement.product-form.threshold").fill("20");
    await tid(page, "procurement.product-form.supplier").selectOption({ label: "Fresh Farms Co." });
    await tid(page, "procurement.product-form.save").click();

    await expect(toast(page, "Olive Oil (1L) added")).toBeVisible();
    await expect(page.getByRole("heading", { name: "16 products" })).toBeVisible();
    await expect(productRow(page, "Olive Oil (1L)")).toContainText("SKU-9001 · Pantry · AED 32.50 · reorder at 20 · 26% margin");

    await productRow(page, "Olive Oil (1L)").getByRole("button", { name: "Edit" }).click();
    await expect(sheet(page, "Edit product")).toBeVisible();
    await expect(tid(page, "procurement.product-form.sku")).toBeDisabled();
    await tid(page, "procurement.product-form.price").fill("30");
    await tid(page, "procurement.product-form.cost").fill("");
    await tid(page, "procurement.product-form.supplier").selectOption("");
    await tid(page, "procurement.product-form.save").click();
    await expect(toast(page, "Product updated")).toBeVisible();
    await expect(productRow(page, "Olive Oil (1L)")).toContainText("AED 30.00 · reorder at 20 · no cost on file");
  });

  test("a product with no history can be deleted; one with stock behind it is protected", async ({ page }) => {
    await tid(page, "procurement.add-product").click();
    await tid(page, "procurement.product-form.sku").fill("SKU-9002");
    await tid(page, "procurement.product-form.name").fill("Seasonal Special");
    await tid(page, "procurement.product-form.price").fill("9.9");
    await tid(page, "procurement.product-form.save").click();
    await expect(toast(page, "Seasonal Special added")).toBeVisible();

    await productRow(page, "Seasonal Special").getByRole("button", { name: "Delete" }).click();
    await expect(sheet(page, "Delete product?")).toContainText("Seasonal Special will be removed");
    await tid(page, "procurement.delete-confirm.confirm").click();
    await expect(toast(page, "Seasonal Special deleted")).toBeVisible();
    await expect(page.getByRole("heading", { name: "15 products" })).toBeVisible();

    await productRow(page, "Whole Milk (2L)").getByRole("button", { name: "Delete" }).click();
    await tid(page, "procurement.delete-confirm.confirm").click();
    await expect(page.getByRole("alert").filter({ hasText: /Can't delete — this product has batches/ })).toBeVisible();
    await expect(productRow(page, "Whole Milk (2L)")).toBeVisible();
  });

  test("imports products from a CSV: creates, updates, and reports rows it skipped", async ({ page }) => {
    await tid(page, "procurement.import-products").setInputFiles(csv("products.csv", [
      "sku,name,category,price,cost_price,reorder_threshold,supplier_name,unit",
      "SKU-9101,Tahini (500g),Pantry,18.5,12,15,Fresh Farms Co.,each",
      "SKU-1001,Gala Apples (kg),Produce,9.5,6,60,Fresh Farms Co.,kg",
      "SKU-9102,Broken Row,Pantry,not-a-price,,,,",
      ",No Sku,Pantry,5,,,,",
    ].join("\n")));
    const result = page.locator(".banner", { hasText: "Imported:" });
    await expect(result).toContainText("1 created, 1 updated");
    await expect(result).toContainText("2 row issues");
    await expect(page.getByRole("heading", { name: "16 products" })).toBeVisible();
    await expect(productRow(page, "Tahini (500g)")).toContainText("AED 18.50");
    await expect(productRow(page, "Gala Apples (kg)")).toContainText("AED 9.50");
  });

  test("rejects a CSV that is missing required columns", async ({ page }) => {
    await tid(page, "procurement.import-products").setInputFiles(csv("products.csv", "sku,name\nSKU-1,Thing"));
    await expect(page.getByRole("alert").filter({ hasText: "CSV is missing required column(s): category, price" })).toBeVisible();
  });
});
