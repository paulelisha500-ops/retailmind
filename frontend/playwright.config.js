import { defineConfig } from "@playwright/test";

const CI = !!process.env.CI;
const PORT = 4173;

// E2E_BASE_URL points the whole suite at an already-deployed site instead of the local production build, e.g.
//   E2E_BASE_URL=https://paulelisha500-ops.github.io/retailmind/ npm run test:e2e
// The tests only use relative addresses, so a site served from a sub-path works the same as one served from "/".
const LIVE = process.env.E2E_BASE_URL ? process.env.E2E_BASE_URL.replace(/\/?$/, "/") : "";
// A few tests type an email and a password into the sign-in form. Against a deployed site they are skipped unless
// E2E_LIVE_CREDENTIALS=1 is set by whoever owns it; every other test signs in with the one-click workspace accounts.
const TYPES_CREDENTIALS = /rejects a wrong password|rejects an unknown or malformed email|signs in with typed credentials|can sign in with the one-time password/;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/artifacts",
  // A deployed site is reached over the internet, so the longest audits need more headroom than a local server does.
  timeout: LIVE ? 180_000 : 60_000,
  expect: { timeout: LIVE ? 15_000 : 8_000 },
  grepInvert: LIVE && !process.env.E2E_LIVE_CREDENTIALS ? TYPES_CREDENTIALS : undefined,
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Kept below the core count: a saturated machine makes the preview server miss deadlines and turns into flaky timeouts.
  workers: CI ? 2 : 3,
  reporter: CI ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]] : [["list"]],
  use: {
    baseURL: LIVE || `http://localhost:${PORT}`,
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
  webServer: LIVE ? undefined : {
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
