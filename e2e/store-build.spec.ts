// The real store builds (not the e2e build) load in Chromium: the background starts, and the popup
// draws its first screen under the strict CSP with no error. dist/edge runs on the same engine,
// so this is as far as Edge can be automated; the branded browsers are checked by hand.
import { chromium, expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");

for (const target of ["chrome", "edge"] as const) {
  test(`dist/${target} loads: background running, popup drawn, no CSP violation`, async () => {
    const dist = path.join(root, "dist", target);
    const manifest = JSON.parse(await readFile(path.join(dist, "manifest.json"), "utf8")) as { host_permissions: string[]; key?: string };
    expect(manifest.host_permissions).toEqual(["https://www.linkedin.com/in/*", "https://scouty.to/*"]);
    expect(manifest.key).toBeUndefined();
    const profile = await mkdtemp(path.join(os.tmpdir(), "scouty-ext-store-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: true, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
      const extensionId = worker.url().split("/")[2]!;
      expect(worker.url()).toBe(`chrome-extension://${extensionId}/background.js`);
      const facts = await worker.evaluate(async () => ({
        name: chrome.runtime.getManifest().name,
        permissions: (await chrome.permissions.getAll()).permissions?.sort(),
        origins: (await chrome.permissions.getAll()).origins?.sort(),
        redirect: chrome.identity.getRedirectURL(),
        locks: typeof navigator.locks?.request,
        sessionStorage: typeof chrome.storage.session?.get,
      }));
      expect(facts.name).toBe("Scouty Extension");
      expect(facts.permissions).toEqual(["identity", "scripting", "storage"]);
      // Chromium grants host permissions per host: it drops the /in/ path of the manifest pattern.
      // The extension therefore never relies on the permission to stay on /in/ pages; the background
      // and the reader both check the address themselves (see docs/BROWSER-FACTS.md).
      expect(facts.origins).toEqual(["https://scouty.to/*", "https://www.linkedin.com/*"]);
      expect(facts.redirect).toBe(`https://${extensionId}.chromiumapp.org/`);
      expect(facts.locks).toBe("function");
      expect(facts.sessionStorage).toBe("function");

      const problems: string[] = [];
      const popup = await context.newPage();
      popup.on("console", (message) => { if (message.type() === "error") problems.push(message.text()); });
      popup.on("pageerror", (error) => problems.push(error.message));
      await popup.addInitScript(() => document.addEventListener("securitypolicyviolation", (event) => console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`)));
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await expect(popup.getByRole("heading", { level: 1 })).toHaveText("Get started with Scouty");
      await expect(popup.getByRole("button", { name: "Create account", exact: true })).toBeVisible();
      await expect(popup.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
      // No developer disclosure in a store build.
      await expect(popup.getByText("Developer")).toHaveCount(0);
      await expect(popup).toHaveTitle("Scouty Extension");
      // The compiled Tailwind stylesheet applied: the primary button is the app's near-black.
      expect(await popup.getByRole("button", { name: "Create account", exact: true }).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(24, 24, 27)");
      expect(await popup.evaluate(() => document.body.getBoundingClientRect().width)).toBe(360);
      expect(problems).toEqual([]);
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
