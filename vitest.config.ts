import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __SCOUTY_BUILD__: JSON.stringify({
      apiOrigin: "https://scouty.to",
      linkedinOrigin: "https://www.linkedin.com",
      clientId: "scouty-ext-chrome",
      browser: "chrome",
      version: "0.1.0",
      debugClicks: true,
      dev: false,
    }),
    __SCOUTY_ENTRY__: "false",
  },
  test: {
    environment: "jsdom",
    include: ["**/*.test.ts"], exclude: ["**/node_modules/**", "e2e/**", "gallery/**", "dist/**"],
    restoreMocks: false,
    setupFiles: ["./test/helpers/setup.ts"],
    testTimeout: 20000,
  },
});
