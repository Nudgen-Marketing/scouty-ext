// @vitest-environment node
// Each built manifest must equal the expected one exactly: least privilege is asserted, not assumed.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { manifestFor } from "../../build.mjs";

const root = process.cwd();
const read = (file: string): string => readFileSync(path.join(root, file), "utf8");
const manifest = (target: string): Record<string, unknown> => JSON.parse(read(`dist/${target}/manifest.json`)) as Record<string, unknown>;
const version = (JSON.parse(read("package.json")) as { version: string }).version;

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src https://scouty.to; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const SHARED = {
  manifest_version: 3,
  default_locale: "en",
  name: "__MSG_extName__",
  description: "__MSG_extDescription__",
  // The public page every store listing also names as homepage and support (app plan linkedin-extension-page.md).
  homepage_url: "https://scouty.to/linkedin-extension",
  permissions: ["scripting", "storage", "identity"],
  host_permissions: ["https://www.linkedin.com/in/*", "https://scouty.to/*"],
  action: { default_title: "Scouty LinkedIn Capture", default_popup: "popup.html" },
  content_security_policy: { extension_pages: CSP },
  icons: { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" },
  version,
};
const CHROMIUM = { ...SHARED, background: { service_worker: "background.js", type: "module" }, minimum_chrome_version: "116" };
const FIREFOX = {
  ...SHARED,
  background: { scripts: ["background.js"], type: "module" },
  browser_specific_settings: {
    gecko: { id: "linkedin-capture@scouty.to", strict_min_version: "140.0", data_collection_permissions: { required: ["websiteContent", "personallyIdentifyingInfo", "authenticationInfo"] } },
  },
};

describe("manifests", () => {
  it.each([["chrome", CHROMIUM], ["edge", CHROMIUM], ["firefox", FIREFOX]] as const)("dist/%s/manifest.json is exactly the expected manifest", (target, expected) => {
    expect(manifest(target)).toEqual(expected);
  });

  it.each(["chrome", "edge", "firefox"])("%s: least privilege", (target) => {
    const m = manifest(target);
    expect(m.permissions).toEqual(["scripting", "storage", "identity"]);
    for (const key of ["content_scripts", "web_accessible_resources", "externally_connectable", "optional_permissions", "optional_host_permissions", "key", "update_url", "sandbox", "devtools_page", "options_page", "side_panel", "sidebar_action", "commands", "oauth2"]) expect(m, key).not.toHaveProperty(key);
    const text = read(`dist/${target}/manifest.json`);
    for (const word of ["tabs", "cookies", "webRequest", "activeTab", "<all_urls>", "unlimitedStorage", "nativeMessaging", "downloads", "history", "*://*"]) expect(text, word).not.toContain(`"${word}"`);
    expect(text).not.toMatch(/linkedin\.test|scouty\.test|localhost|unsafe-inline|unsafe-eval|https?:\/\/\*/);
    for (const pattern of m.host_permissions as string[]) expect(pattern, pattern).not.toMatch(/:\d+\//);
    expect((m.content_security_policy as { extension_pages: string }).extension_pages).toContain("script-src 'self'");
  });

  it("Firefox has no service worker and no Android key; Chromium has no background scripts", () => {
    const firefox = manifest("firefox");
    expect(firefox.background).not.toHaveProperty("service_worker");
    expect((firefox.browser_specific_settings as Record<string, unknown>)).not.toHaveProperty("gecko_android");
    expect(manifest("chrome").background).not.toHaveProperty("scripts");
    expect(manifest("chrome")).not.toHaveProperty("browser_specific_settings");
  });

  it("each build carries its own OAuth client id and browser name", () => {
    for (const target of ["chrome", "edge", "firefox"]) {
      const background = read(`dist/${target}/background.js`);
      expect(background).toContain(`clientId: "scouty-ext-${target}"`);
      expect(background).toContain(`browser: "${target}"`);
      expect(background).toContain(`version: "${version}"`);
    }
  });

  it("the name and description come from the locale file", () => {
    const messages = JSON.parse(read("dist/chrome/_locales/en/messages.json")) as Record<string, { message: string }>;
    expect(messages.extName!.message).toBe("Scouty LinkedIn Capture");
    expect(messages.extDescription!.message).toBe("Captures the LinkedIn profile you choose, when you press Capture, and sends it to your Scouty workspace. Never acts on LinkedIn.");
    expect(messages.extDescription!.message.length).toBeLessThanOrEqual(132);
  });

  it("a development build for a local app declares http://localhost/* with no port, in every target", async () => {
    for (const target of ["chrome", "edge", "firefox"] as const) {
      const dev = await manifestFor(target, { apiOrigin: "http://localhost:3000", linkedinOrigin: "https://www.linkedin.com", version });
      expect(dev.host_permissions).toEqual(["https://www.linkedin.com/in/*", "http://localhost/*"]);
      expect((dev.content_security_policy as { extension_pages: string }).extension_pages).toContain("connect-src http://localhost:3000;");
      expect(dev).not.toHaveProperty("key");
    }
  });
});

describe("the e2e build differs from the Chrome build in exactly the documented points", () => {
  const e2e = manifest("e2e");
  const chrome = manifest("chrome");
  const key = (JSON.parse(read("e2e/build/key.json")) as { key: string }).key;
  const toReal = (text: string): string => text.split("http://linkedin.test").join("https://www.linkedin.com").split("http://scouty.test").join("https://scouty.to");

  it("manifest: test origins and a fixed key, nothing else", () => {
    expect(e2e).toEqual({
      ...chrome,
      host_permissions: ["http://linkedin.test/in/*", "http://scouty.test/*"],
      content_security_policy: { extension_pages: CSP.replace("https://scouty.to", "http://scouty.test") },
      key,
    });
  });

  it("background, reader and overlay are the Chrome bundles with the two origins swapped", () => {
    for (const file of ["background.js", "reader.js", "overlay.js"]) expect(toReal(read(`dist/e2e/${file}`)), file).toBe(read(`dist/chrome/${file}`));
  });

  it("the popup differs only by the module that names the tab to capture", () => {
    const chromePopup = read("dist/chrome/popup.js");
    const e2ePopup = read("dist/e2e/popup.js");
    expect(e2ePopup).toContain('get("tabId")');
    expect(chromePopup).not.toContain('get("tabId")');
    expect(chromePopup).not.toContain("location.search");
    expect(Math.abs(e2ePopup.length - chromePopup.length)).toBeLessThan(400);
    expect(read("dist/e2e/popup.css")).toBe(read("dist/chrome/popup.css"));
    expect(read("dist/e2e/popup.html")).toBe(read("dist/chrome/popup.html"));
  });

  it("the store builds contain none of the test code or origins", () => {
    for (const target of ["chrome", "edge", "firefox"]) {
      for (const file of ["background.js", "reader.js", "overlay.js", "popup.js", "manifest.json"]) {
        expect(read(`dist/${target}/${file}`), `${target}/${file}`).not.toMatch(/linkedin\.test|scouty\.test|E2E BUILD ONLY/);
      }
    }
    expect(read("tools/package.mjs")).not.toMatch(/["']e2e["']/);
  });
});
