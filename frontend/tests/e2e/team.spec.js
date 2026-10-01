import { expect, signInAs, test, tid } from "./fixtures.js";

const h1 = (page, name) => page.getByRole("heading", { level: 1, name });
const toast = (page, text) => page.locator(".toast", { hasText: text }).last();
const sheet = (page, name) => page.getByRole("dialog", { name });
// A person on the team list (the same name can also appear in the sidebar or a toast).
const member = (page, name) => page.locator("#main .list-row", { hasText: name });

test.use({ permissions: ["camera", "clipboard-read", "clipboard-write"] });

async function openTeam(page) {
  await signInAs(page, "admin");
  await tid(page, "nav.team").click();
  await expect(h1(page, "Team & Access")).toBeVisible();
}

async function addMember(page, { name, email, department, title, level, responsibilities = [], store } = {}) {
  await tid(page, "team.add").click();
  await expect(sheet(page, "Add team member")).toBeVisible();
  if (name != null) await tid(page, "team.form.name").fill(name);
  if (email != null) await tid(page, "team.form.email").fill(email);
  if (department) await tid(page, "team.form.department").selectOption(department);
  if (title != null) await tid(page, "team.form.title").fill(title);
  if (store) await tid(page, "team.form.store").selectOption({ label: store });
  if (level) await tid(page, `team.form.level.${level}`).click();
  for (const r of responsibilities) await tid(page, "team.form.responsibility").filter({ hasText: r }).click();
}

test.describe("deployment mode", () => {
  test("single store shows the home store's team; enterprise adds a store switcher", async ({ page }) => {
    await openTeam(page);
    await expect(page.getByRole("heading", { name: "4 team members · Downtown Central" })).toBeVisible();
    await expect(tid(page, "team.store")).toHaveCount(0);

    await tid(page, "team.mode.enterprise").click();
    await expect(tid(page, "team.mode.enterprise")).toHaveAttribute("aria-pressed", "true");
    const chips = tid(page, "team.store");
    await expect(chips).toHaveCount(4);

    await chips.filter({ hasText: "Riverside Mall" }).click();
    await expect(page.getByRole("heading", { name: "1 team member · Riverside Mall" })).toBeVisible();
    await expect(member(page, "Hana Saeed")).toBeVisible();
    await chips.filter({ hasText: "North Hills" }).click();
    await expect(member(page, "Tariq Mahmoud")).toBeVisible();
    await chips.filter({ hasText: "Airport Plaza" }).click();
    await expect(member(page, "Sofia Petrov")).toBeVisible();
    await chips.filter({ hasText: "Downtown Central" }).click();
    await expect(member(page, "Marcus Tan")).toBeVisible();

    await tid(page, "team.mode.single").click();
    await expect(tid(page, "team.store")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /^4 team members · Downtown Central/ })).toBeVisible();
  });

  test("the chosen mode and store carry over to the other screens", async ({ page }) => {
    await openTeam(page);
    await tid(page, "team.mode.enterprise").click();
    await tid(page, "team.store").filter({ hasText: "Riverside Mall" }).click();
    await tid(page, "nav.monitoring").click();
    await expect(page.locator(".screen-header, header").getByText("Riverside Mall").first()).toBeVisible();
    await expect(page.getByText(/Shelf space 71% empty — Baby Spinach/)).toBeVisible();
  });
});

test.describe("adding a team member", () => {
  test.beforeEach(async ({ page }) => { await openTeam(page); });

  test("the form can be dismissed by Cancel, the close button, the backdrop and Escape", async ({ page }) => {
    for (const how of ["cancel", "close", "backdrop", "escape"]) {
      await tid(page, "team.add").click();
      await expect(sheet(page, "Add team member")).toBeVisible();
      if (how === "escape") await page.keyboard.press("Escape");
      else if (how === "backdrop") await tid(page, "team.form.backdrop").click({ position: { x: 6, y: 6 } });
      else await tid(page, `team.form.${how}`).click();
      await expect(sheet(page, "Add team member")).toHaveCount(0);
    }
  });

  test("asks for a name and an email before it will submit", async ({ page }) => {
    await tid(page, "team.add").click();
    await tid(page, "team.form.submit").click();
    await expect(page.getByText("Enter a name and an email address.")).toBeVisible();
    await tid(page, "team.form.name").fill("Only A Name");
    await tid(page, "team.form.submit").click();
    await expect(page.getByText("Enter a name and an email address.")).toBeVisible();
  });

  test("rejects a malformed email and a title that is missing, with the server's own message", async ({ page }) => {
    await addMember(page, { name: "Nadia Rahman", email: "not-an-email", title: "Produce Lead" });
    await tid(page, "team.form.submit").click();
    await expect(sheet(page, "Add team member").getByRole("alert")).toContainText(/email/i);
    await tid(page, "team.form.email").fill("nadia@retailmind.app");
    await tid(page, "team.form.title").fill("");
    await tid(page, "team.form.submit").click();
    await expect(sheet(page, "Add team member").getByRole("alert")).toContainText(/title/i);
  });

  test("adds a member, shows the one-time password once, and lets it be copied or dismissed", async ({ page }) => {
    await addMember(page, {
      name: "Nadia Rahman", email: "nadia@retailmind.app", department: "Procurement & Suppliers", title: "Produce Lead", level: "manager",
      responsibilities: ["Supplier Management", "Purchase Approvals"],
    });
    // Every access level can be picked; the last choice stands.
    for (const level of ["admin", "staff", "manager"]) {
      await tid(page, `team.form.level.${level}`).click();
      await expect(tid(page, `team.form.level.${level}`)).toHaveAttribute("aria-pressed", "true");
    }
    // A responsibility toggles off again.
    const approvals = tid(page, "team.form.responsibility").filter({ hasText: "Purchase Approvals" });
    await expect(approvals).toHaveAttribute("aria-pressed", "true");
    await approvals.click();
    await expect(approvals).toHaveAttribute("aria-pressed", "false");
    await expect(tid(page, "team.form.level.manager")).toHaveAttribute("aria-pressed", "true");

    await tid(page, "team.form.submit").click();
    await expect(toast(page, "Nadia Rahman added to the team")).toBeVisible();
    await expect(sheet(page, "Add team member")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "5 team members · Downtown Central" })).toBeVisible();
    const row = page.locator(".list-row", { hasText: "Nadia Rahman" });
    await expect(row).toContainText("Produce Lead · Procurement & Suppliers");
    await expect(row).toContainText("1 module assigned");
    await expect(row.getByText("manager", { exact: true })).toBeVisible();

    const code = page.locator(".issued__code");
    await expect(code).toBeVisible();
    const password = (await code.innerText()).trim();
    expect(password.length).toBeGreaterThanOrEqual(10);

    await tid(page, "team.copy-password").click();
    await expect(toast(page, "Password copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(password);

    await tid(page, "team.dismiss-password").click();
    await expect(code).toHaveCount(0);
  });

  test("the new member can sign in with the one-time password, and sees only what a manager should", async ({ page }) => {
    await addMember(page, { name: "Nadia Rahman", email: "nadia@retailmind.app", title: "Produce Lead", level: "manager" });
    await tid(page, "team.form.submit").click();
    const password = (await page.locator(".issued__code").innerText()).trim();

    await tid(page, "nav.sign-out").click();
    await page.goto("./#/sign-in");
    await tid(page, "signin.email").fill("nadia@retailmind.app");
    await tid(page, "signin.password").fill(password);
    await tid(page, "signin.submit").click();
    await expect(h1(page, "Hi, Nadia")).toBeVisible();
    await expect(tid(page, "nav.team")).toHaveCount(0);
    await expect(page.locator(".brand__tag")).toHaveText("Manager console");
  });

  test("refuses a second account with the same email", async ({ page }) => {
    await addMember(page, { name: "Second Marcus", email: "MARCUS@retailmind.app", title: "Duplicate" });
    await tid(page, "team.form.submit").click();
    await expect(sheet(page, "Add team member").getByRole("alert")).toHaveText("A user with that email already exists");
    await expect(sheet(page, "Add team member")).toBeVisible();
  });

  test("a member added to another store appears only when that store is shown", async ({ page }) => {
    await tid(page, "team.mode.enterprise").click();
    await addMember(page, { name: "Omar Aziz", email: "omar.aziz@retailmind.app", title: "Shift Lead", store: "Airport Plaza #087", level: "staff" });
    await tid(page, "team.form.submit").click();
    await expect(toast(page, "Omar Aziz added to the team")).toBeVisible();
    await expect(member(page, "Omar Aziz")).toHaveCount(0); // the list is still Downtown Central's
    await tid(page, "team.store").filter({ hasText: "Airport Plaza" }).click();
    await expect(member(page, "Omar Aziz")).toBeVisible();
    await expect(page.getByRole("heading", { name: "2 team members · Airport Plaza" })).toBeVisible();
  });
});

test.describe("removing a team member", () => {
  test.beforeEach(async ({ page }) => { await openTeam(page); });

  test("the confirmation can be cancelled, closed or dismissed without removing anyone", async ({ page }) => {
    for (const how of ["cancel", "close", "backdrop"]) {
      await page.getByRole("button", { name: "Remove Aisha Khan" }).click();
      const dialog = sheet(page, "Remove this team member?");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Aisha Khan will lose access to RetailMind");
      if (how === "backdrop") await tid(page, "team.remove-confirm.backdrop").click({ position: { x: 6, y: 6 } });
      else await tid(page, `team.remove-confirm.${how}`).click();
      await expect(dialog).toHaveCount(0);
    }
    await expect(member(page, "Aisha Khan")).toBeVisible();
  });

  test("removes a member who has nothing on record, and tells you why others can't be removed", async ({ page }) => {
    await addMember(page, { name: "Temp Hire", email: "temp.hire@retailmind.app", title: "Seasonal" });
    await tid(page, "team.form.submit").click();
    await expect(page.getByRole("heading", { name: "5 team members · Downtown Central" })).toBeVisible();

    await page.getByRole("button", { name: "Remove Temp Hire" }).click();
    await tid(page, "team.remove-confirm.confirm").click();
    await expect(toast(page, "Temp Hire removed")).toBeVisible();
    await expect(page.getByRole("heading", { name: "4 team members · Downtown Central" })).toBeVisible();
    await expect(member(page, "Temp Hire")).toHaveCount(0);

    // Marcus can't remove himself.
    await page.getByRole("button", { name: "Remove Marcus Tan" }).click();
    await tid(page, "team.remove-confirm.confirm").click();
    await expect(page.getByRole("alert").filter({ hasText: "You can't remove your own account" })).toBeVisible();

    // Priya has alerts and approvals assigned, so removing her would orphan them.
    await page.getByRole("button", { name: "Remove Priya Sharma" }).click();
    await tid(page, "team.remove-confirm.confirm").click();
    await expect(page.getByRole("alert").filter({ hasText: /on record/ })).toBeVisible();
    await expect(member(page, "Priya Sharma")).toBeVisible();
  });
});

test.describe("access", () => {
  test("a manager can't open Team & Access even by address", async ({ page }) => {
    await signInAs(page, "manager");
    await page.goto("./#/team");
    await expect(h1(page, /Hi, Priya/)).toBeVisible();
  });
});
