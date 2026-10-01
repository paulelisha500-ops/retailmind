import { defineConfig } from "@playwright/test";

const CI = !!process.env.CI;
const PORT = 4173;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/artifacts",
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Kept below the core count: a saturated machine makes the preview server miss deadlines and turns into flaky timeouts.
  workers: CI ? 2 : 3,
  reporter: CI ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Locally the installed Chrome is used (nothing to download); CI installs Playwright's Chromium.
    channel: CI ? undefined : "chrome",
    serviceWorkers: "block", // most tests want the network path; pwa.spec.js opts back in
    // A synthetic camera, so the Monitoring screen's "This device" source can be exercised for real.
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
    permissions: ["camera"],
    colorScheme: "light",
    trace: "on-first-retry", // screencast tracing on every test slows a laptop enough to cause timeouts; failures still keep a screenshot + DOM snapshot
    screenshot: "only-on-failure",
  },
  // The suite runs against the production build — exactly what gets deployed. In CI the build is made once, by an
  // earlier job, and handed to every test shard (PREBUILT=1), so the bytes that were tested are the bytes published.
  webServer: {
    command: process.env.PREBUILT ? "npm run preview -- --strictPort" : "npm run build && npm run preview -- --strictPort",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 240_000,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } }, testIgnore: /mobile\.spec/ },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, testMatch: /mobile\.spec/ },
  ],
});
