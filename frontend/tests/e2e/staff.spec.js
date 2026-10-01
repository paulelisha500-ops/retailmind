import { expect, signInAs, test, tid } from "./fixtures.js";

const h1 = (page, name) => page.getByRole("heading", { level: 1, name });
const toast = (page, text) => page.locator(".toast", { hasText: text }).last();

// A 1×1 PNG, served in place of a real camera stream.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test.describe("home", () => {
  test("every tile opens its screen, and every back button returns home", async ({ page }) => {
    await signInAs(page, "admin");
    const tiles = [
      ["cashier", "Cashier"], ["tasks", "Tasks"], ["monitoring", "Monitoring"], ["forecast", "Forecast"], ["procurement", "Procurement"],
      ["assistant", "Ask RetailMind"], ["warehouse", "Warehouse"], ["team", "Team & Access"], ["analytics", "Analytics"],
    ];
    for (const [id, title] of tiles) {
      await tid(page, "nav.home").click();
      await tid(page, `home.tile.${id}`).click();
      await expect(h1(page, title)).toBeVisible();
      if (await tid(page, `${id}.back`).count()) {
        await tid(page, `${id}.back`).click();
        await expect(h1(page, /Hi, Marcus/)).toBeVisible();
      }
    }
  });

  test("tiles show how many tasks and alerts are open", async ({ page }) => {
    await signInAs(page, "admin");
    await expect(tid(page, "home.tile.tasks").getByLabel(/open$/)).toHaveText("5");
    await expect(tid(page, "home.tile.monitoring").getByLabel(/open$/)).toHaveText("3");
  });

  test("a store employee sees seven tiles and no admin ones", async ({ page }) => {
    await signInAs(page, "staff");
    await expect(page.locator('[data-tid^="home.tile."]')).toHaveCount(7);
    for (const id of ["team", "analytics"]) await expect(tid(page, `home.tile.${id}`)).toHaveCount(0);
  });

  test("the task preview lists three tasks and 'See all' opens Tasks", async ({ page }) => {
    await signInAs(page, "admin");
    await expect(page.getByText("Review purchase order PO-1042")).toBeVisible();
    await tid(page, "home.all-tasks").click();
    await expect(h1(page, "Tasks")).toBeVisible();
  });

  test("the bell lists what needs attention and the sheet closes three ways", async ({ page }) => {
    await signInAs(page, "admin");
    await tid(page, "home.bell").click();
    const sheet = page.getByRole("dialog", { name: "Notifications" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/Loss prevention alert · Checkout Zone/)).toBeVisible();
    await tid(page, "home.notifications.close").click();
    await expect(sheet).toHaveCount(0);

    await tid(page, "home.bell").click();
    await tid(page, "home.notifications.backdrop").click({ position: { x: 6, y: 6 } });
    await expect(sheet).toHaveCount(0);

    await tid(page, "home.bell").click();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });

  test("enterprise mode is called out on Home", async ({ page }) => {
    await signInAs(page, "admin");
    await tid(page, "nav.team").click();
    await tid(page, "team.mode.enterprise").click();
    await tid(page, "nav.home").click();
    await expect(page.getByText(/Enterprise mode — viewing/)).toBeVisible();
  });
});

test.describe("tasks", () => {
  test("completing every task empties the list, and reopening brings one back", async ({ page }) => {
    await signInAs(page, "staff");
    await tid(page, "nav.tasks").click();
    await expect(page.getByText("5 open today")).toBeVisible();
    const alreadyDone = await tid(page, "tasks.reopen").count(); // the workspace starts with one finished task
    for (let left = 5; left > 0; left--) {
      await tid(page, "tasks.toggle").first().click();
      await expect(page.getByText(`${left - 1} open today`)).toBeVisible();
    }
    await expect(page.getByText("Nothing open — great work today.")).toBeVisible();
    await expect(tid(page, "tasks.reopen")).toHaveCount(alreadyDone + 5);

    await tid(page, "tasks.reopen").first().click();
    await expect(page.getByText("1 open today")).toBeVisible();
    await expect(tid(page, "tasks.reopen")).toHaveCount(alreadyDone + 4);
    await expect(tid(page, "tasks.toggle")).toHaveCount(1);
  });
});

test.describe("monitoring", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "admin");
    await tid(page, "nav.monitoring").click();
    await expect(h1(page, "Monitoring")).toBeVisible();
  });

  test("shows shelf fill and the open alerts, and 'Mark reviewed' moves each one to Reviewed", async ({ page }) => {
    await expect(page.locator(".fill").filter({ hasText: "Aisle 11" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Alerts (3 open)" })).toBeVisible();
    await expect(page.getByText("Reviewed (")).toHaveCount(0);
    for (let open = 3; open > 0; open--) {
      await tid(page, "monitoring.resolve").first().click();
      await expect(toast(page, "Alert marked as reviewed")).toBeVisible();
      await expect(page.getByRole("heading", { name: `Alerts (${open - 1} open)` })).toBeVisible();
    }
    await expect(page.getByText("No open alerts — all clear.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviewed (3)" })).toBeVisible();
  });

  test("the camera source can be off, this device, or an IP camera — and is remembered", async ({ page }) => {
    await page.route("http://camera.test/**", (route) => route.fulfill({ contentType: "image/png", body: PIXEL }));

    // This device (a synthetic camera stands in for a webcam).
    await tid(page, "monitoring.camera.webcam").click();
    await expect(page.getByLabel("Live camera")).toBeVisible();
    await expect(tid(page, "monitoring.camera.webcam")).toHaveAttribute("aria-pressed", "true");

    // IP camera: the form validates before it connects.
    await tid(page, "monitoring.camera.url").click();
    await tid(page, "monitoring.camera-save").click();
    await expect(page.getByText("Enter a full http:// or https:// camera URL.")).toBeVisible();
    await tid(page, "monitoring.camera-url").fill("rtsp://camera.test/stream");
    await tid(page, "monitoring.camera-save").click();
    await expect(page.getByText("Enter a full http:// or https:// camera URL.")).toBeVisible();
    await tid(page, "monitoring.camera-url").fill("http://camera.test/live.png");
    await tid(page, "monitoring.camera-save").click();
    await expect(page.getByAltText("Live camera feed")).toBeVisible();
    await expect(page.getByText("Enter a full http:// or https:// camera URL.")).toHaveCount(0);

    // The choice survives a reload.
    await page.reload();
    await expect(page.getByAltText("Live camera feed")).toBeVisible();
    await expect(tid(page, "monitoring.camera.url")).toHaveAttribute("aria-pressed", "true");

    // Off removes the feed.
    await tid(page, "monitoring.camera.off").click();
    await expect(page.getByAltText("Live camera feed")).toHaveCount(0);
    await expect(page.getByLabel("Live camera")).toHaveCount(0);
  });

  test.describe("an unreachable stream", () => {
    test.use({ allowedErrors: ["Failed to load resource"] });
    test("is explained instead of showing a broken picture", async ({ page }) => {
      await page.route("http://camera.test/**", (route) => route.abort());
      await tid(page, "monitoring.camera.url").click();
      await tid(page, "monitoring.camera-url").fill("http://camera.test/offline.mjpg");
      await tid(page, "monitoring.camera-save").click();
      await expect(page.getByText(/Couldn't load that stream/)).toBeVisible();
    });
  });
});

test.describe("forecast", () => {
  test("every category loads its own chart and a recommendation", async ({ page }) => {
    await signInAs(page, "admin");
    await tid(page, "nav.forecast").click();
    const categories = ["Produce", "Dairy & Chilled", "Frozen", "Bakery", "Meat & Seafood"];
    const chips = tid(page, "forecast.category");
    await expect(chips).toHaveCount(categories.length);
    for (const name of categories) {
      await chips.filter({ hasText: name }).click();
      await expect(page.getByRole("group", { name: new RegExp(`^${name} demand`) })).toBeVisible();
      await expect(page.locator(".reco-card")).toBeVisible();
    }
  });

  test("all four methods produce a forecast with an accuracy figure", async ({ page }) => {
    await signInAs(page, "admin");
    await tid(page, "nav.forecast").click();
    const methods = [["prophet", /Trend plus weekly seasonality/], ["xgboost", /Learns from recent sales/], ["lstm", /recurrent network/], ["tft", /Transformer-style attention/]];
    for (const [id, description] of methods) {
      await tid(page, `forecast.method.${id}`).click();
      await expect(tid(page, `forecast.method.${id}`)).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".method-desc")).toHaveText(description);
      await expect(page.locator(".chart-legend")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/% MAPE/)).toBeVisible({ timeout: 30_000 });
    }
    // The two neural methods are scored on days they never saw.
    await expect(page.getByText(/Backtest error .*% MAPE · last 7 days held out/)).toBeVisible();
  });

  test("scrubbing the chart shows values by pointer and by keyboard", async ({ page }) => {
    await signInAs(page, "admin");
    await tid(page, "nav.forecast").click();
    const scrub = tid(page, "forecast.chart.scrub");
    await expect(scrub).toBeVisible();
    const tip = page.locator(".xy__tip");
    await scrub.hover({ position: { x: (await scrub.boundingBox()).width * 0.2, y: 60 } });
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("Actual");
    await scrub.hover({ position: { x: (await scrub.boundingBox()).width * 0.95, y: 60 } });
    await expect(tip).toContainText("Forecast");
    await page.mouse.move(5, 5);
    await expect(tip).toHaveCount(0);

    await scrub.focus();
    await expect(tip).toBeVisible();
    const start = Number(await scrub.getAttribute("aria-valuenow"));
    await page.keyboard.press("ArrowLeft");
    await expect(scrub).toHaveAttribute("aria-valuenow", String(start - 1));
    await page.keyboard.press("Home");
    await expect(scrub).toHaveAttribute("aria-valuenow", "0");
    await page.keyboard.press("End");
    await expect(scrub).not.toHaveAttribute("aria-valuenow", "0");
    await page.keyboard.press("ArrowRight");
    await scrub.blur();
    await expect(tip).toHaveCount(0);
  });

  test("a store with no sales history says so instead of failing", async ({ page }) => {
    await signInAs(page, "admin");
    await tid(page, "nav.team").click();
    await tid(page, "team.mode.enterprise").click();
    await tid(page, "nav.forecast").click();
    await expect(h1(page, "Forecast")).toBeVisible();
    await expect(page.getByRole("group", { name: /demand/ })).toBeVisible();
  });
});

test.describe("assistant", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "admin");
    await tid(page, "home.tile.assistant").click();
    await expect(h1(page, "Ask RetailMind")).toBeVisible();
  });

  test("each suggested question gets an answer built from the store's data", async ({ page }) => {
    const suggestions = tid(page, "assistant.suggestion");
    const count = await suggestions.count();
    expect(count).toBe(5);
    for (let i = 0; i < count; i++) {
      const question = await suggestions.nth(i).innerText();
      await suggestions.nth(i).click();
      await expect(page.locator(".bubble--user").nth(i)).toHaveText(question);
      await expect(page.locator(".bubble--assistant").nth(i)).toBeVisible();
      await expect(suggestions.first()).toBeEnabled(); // re-enabled once the answer lands
    }
    await expect(page.locator(".bubble--assistant")).toHaveCount(count);
  });

  test("typed questions work by button and by Enter; empty ones can't be sent", async ({ page }) => {
    const send = tid(page, "assistant.send");
    await expect(send).toBeDisabled();
    await tid(page, "assistant.input").fill("   ");
    await expect(send).toBeDisabled();

    await tid(page, "assistant.input").fill("What should I restock first?");
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.locator(".bubble--user").first()).toHaveText("What should I restock first?");
    await expect(page.locator(".bubble--assistant")).toHaveCount(1);
    await expect(tid(page, "assistant.input")).toHaveValue("");

    await tid(page, "assistant.input").fill("Which supplier performs best?");
    await tid(page, "assistant.input").press("Enter");
    await expect(page.locator(".bubble--assistant")).toHaveCount(2);
  });

  test("a question it can't ground still gets an honest reply", async ({ page }) => {
    await tid(page, "assistant.input").fill("qwertyuiop");
    await tid(page, "assistant.send").click();
    await expect(page.locator(".bubble--assistant")).toHaveCount(1);
    await expect(page.locator(".bubble--assistant")).not.toBeEmpty();
  });
});

test.describe("warehouse", () => {
  test("shows zones, a pick route and floor traffic, and the traffic chart can be scrubbed", async ({ page }) => {
    await signInAs(page, "admin");
    await tid(page, "home.tile.warehouse").click();
    await expect(h1(page, "Warehouse")).toBeVisible();
    await expect(page.getByText("Storage utilisation")).toBeVisible();
    await expect(page.locator(".meter, [role=progressbar]").first()).toBeVisible();
    await expect(page.getByText(/Pick route · \d+ stops/)).toBeVisible();
    await expect(page.getByText(/Recommended .* floor staff/)).toBeVisible();

    const scrub = tid(page, "warehouse.traffic.scrub");
    await scrub.hover({ position: { x: (await scrub.boundingBox()).width * 0.5, y: 60 } });
    await expect(page.locator(".xy__tip")).toContainText("Avg transactions/hr");
    await scrub.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await scrub.blur();
  });
});

test.describe("analytics", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "admin");
    await tid(page, "home.tile.analytics").click();
    await expect(h1(page, "Analytics")).toBeVisible();
  });

  test("Overview shows KPIs, fast movers, the sales trend and the category mix", async ({ page }) => {
    await expect(page.locator(".kpi").first()).toBeVisible();
    await expect(page.getByText("Selling out fast · last 14 days")).toBeVisible();
    await expect(page.getByText("Food waste by category")).toBeVisible();

    const scrub = tid(page, "analytics.trend.scrub");
    await scrub.hover({ position: { x: (await scrub.boundingBox()).width * 0.6, y: 60 } });
    await expect(page.locator(".xy__tip")).toContainText("Revenue");
    await scrub.focus();
    await page.keyboard.press("ArrowLeft");
    await scrub.blur();

    const legend = tid(page, "analytics.mix.legend");
    const slices = await legend.count();
    expect(slices).toBe(5);
    for (let i = 0; i < slices; i++) {
      await legend.nth(i).hover();
      await expect(legend.nth(i)).toHaveClass(/is-active/);
      await legend.nth(i).focus();
    }
  });

  test("Profit & Loss computes margin from orders and landed cost", async ({ page }) => {
    await tid(page, "analytics.tab.pnl").click();
    await expect(tid(page, "analytics.tab.pnl")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/Trading P&L, last 30 days/)).toBeVisible();
    await expect(page.getByText("Revenue to profit")).toBeVisible();
    await expect(page.getByText("Margin by category")).toBeVisible();
    await expect(page.getByText("Business position")).toBeVisible();

    const scrub = tid(page, "analytics.pnl-trend.scrub");
    await scrub.hover({ position: { x: (await scrub.boundingBox()).width * 0.5, y: 60 } });
    await expect(page.locator(".xy__tip")).toContainText("Gross profit");
    await scrub.focus();
    await page.keyboard.press("ArrowRight");
    await scrub.blur();

    await tid(page, "analytics.tab.overview").click();
    await expect(page.getByText("Selling out fast · last 14 days")).toBeVisible();
  });

  test("enterprise mode compares stores", async ({ page }) => {
    await tid(page, "nav.team").click();
    await tid(page, "team.mode.enterprise").click();
    await tid(page, "nav.home").click();
    await tid(page, "home.tile.analytics").click();
    await expect(page.getByText(/All stores · last 7 days/)).toBeVisible();
    await expect(page.getByText("Regional comparison")).toBeVisible();
    await expect(page.getByText("Riverside Mall")).toBeVisible();
    await tid(page, "analytics.tab.pnl").click();
    await expect(page.getByText("Margin by store")).toBeVisible();
  });
});
