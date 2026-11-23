import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "gallery.spec.ts",
  timeout: 180_000,
  reporter: [["list"]],
  outputDir: "../test-results/gallery",
  use: { channel: "chromium", headless: true, viewport: { width: 1000, height: 900 } },
});
