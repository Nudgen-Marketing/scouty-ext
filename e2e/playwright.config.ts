import { defineConfig } from "@playwright/test";

// The browser end-to-end layer: Playwright's bundled Chromium with dist/e2e loaded, a mock
// LinkedIn and a stub of the capture API. Each test starts its own servers and browser profile.
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 240_000,
  expect: { timeout: 120_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  outputDir: "../test-results/e2e",
});
