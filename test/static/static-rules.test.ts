// The read-only and network guarantees, checked on the source AND on every built bundle
// (plan 6.4). Run after `npm run build` (the test:static script builds first).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tokensCss } from "../../tools/tokens.mjs";

const root = process.cwd();
const read = (file: string): string => readFileSync(path.join(root, file), "utf8");
const walk = (dir: string): string[] => readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
/** Source without comments, so a rule can be named in a comment without tripping itself. */
const code = (file: string): string => read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const count = (text: string, pattern: RegExp): number => (text.match(new RegExp(pattern.source, "g")) ?? []).length;

const SRC = walk("src").filter((f) => /\.(ts|tsx)$/.test(f));
const TARGETS = ["chrome", "edge", "firefox"] as const;
const OWN_BUNDLES = ["background.js", "reader.js", "overlay.js"] as const;
const INJECTED = ["reader.js", "overlay.js"] as const;

const FETCH = /\bfetch\s*\(/;
const INTERACT: [string, RegExp][] = [
  [".click(", /\.click\s*\(/], ['["click"]', /\[\s*["'`]click["'`]\s*\]/], ["dispatchEvent", /dispatchEvent/], ["scrollBy", /scrollBy/], ["scrollTo", /scrollTo/],
  ["scrollIntoView", /scrollIntoView/], [".focus(", /\.focus\s*\(/],
];
const STORAGE = /\.storage\b/;
const BANNED: [string, RegExp][] = [
  [".submit(", /\.submit\s*\(/], ["requestSubmit", /requestSubmit/], ["XMLHttpRequest", /XMLHttpRequest/], ["sendBeacon", /sendBeacon/], ["WebSocket", /WebSocket/],
  ["EventSource", /EventSource/], ["new Image", /new\s+Image\b/], ["window.open", /window\.open\b/], ["location.assign", /location\.assign\b/],
  ["location.replace", /location\.replace\b/], ["location.href =", /location\.href\s*=[^=]/], ["location =", /\blocation\s*=[^=]/], ["document.cookie", /document\.cookie/],
  ["localStorage", /localStorage/], ["sessionStorage", /sessionStorage/], ["indexedDB", /indexedDB/], ["cookies API", /\.cookies\b/], ["webRequest API", /\.webRequest\b/],
  ["storage.sync", /storage\.sync\b/], ["innerHTML", /innerHTML/], ["outerHTML", /outerHTML/], ["insertAdjacentHTML", /insertAdjacentHTML/], ["eval(", /\beval\s*\(/],
  ["new Function", /new\s+Function\b/], ["dynamic import(", /\bimport\s*\(/], ["importScripts", /importScripts/], ["document.write", /document\.write/],
];
/** What still applies to the popup bundle, which contains React (a vetted dependency): the network and storage rules. */
const POPUP_BANNED = BANNED.filter(([name]) => ["XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "new Image", "document.cookie", "localStorage", "sessionStorage", "indexedDB", "cookies API", "webRequest API", "storage.sync", "eval(", "new Function", "dynamic import(", "importScripts", "window.open", "location.assign", "location.replace"].includes(name));

describe("source rules (src/)", () => {
  it("fetch is called only in background/api.ts", () => {
    expect(SRC.filter((f) => FETCH.test(code(f)))).toEqual(["src/background/api.ts"]);
  });

  it("clicking, scrolling and dispatching happen only in reader/interactions.ts", () => {
    for (const [name, pattern] of INTERACT) {
      // The popup is the extension's own page and may move focus to its own title; nothing that
      // runs in the LinkedIn page (reader, overlay) may, outside interactions.ts.
      const allowed = name === ".focus(" ? ["src/popup/PopupView.tsx"] : ["src/reader/interactions.ts"];
      const hits = SRC.filter((f) => pattern.test(code(f)));
      for (const hit of hits) expect(allowed, `${name} in ${hit}`).toContain(hit);
    }
    expect(count(code("src/reader/interactions.ts"), /\.click\s*\(/)).toBe(1);
    expect(count(code("src/reader/interactions.ts"), /scrollBy/)).toBe(1);
    expect(code("src/reader/interactions.ts")).not.toMatch(/dispatchEvent|scrollTo|scrollIntoView|\.focus\s*\(/);
  });

  it("storage APIs are used only under background/ and popup/", () => {
    const hits = SRC.filter((f) => STORAGE.test(code(f)));
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit).toMatch(/^src\/(background|popup)\//);
    // The popup itself asks the background; it holds no storage call either.
    expect(hits.filter((f) => f.startsWith("src/popup/"))).toEqual([]);
  });

  it.each(BANNED)("%s appears nowhere", (_name, pattern) => {
    expect(SRC.filter((f) => pattern.test(code(f)))).toEqual([]);
  });

  it("LinkedIn selectors and class names live only in reader/selectors.ts", () => {
    const marks = /feed-shared|scaffold-|artdeco-|pvs-|update-components|global-nav|inline-show-more|comments-comment/;
    expect(SRC.filter((f) => marks.test(code(f)))).toEqual(["src/reader/selectors.ts"]);
    expect(read("src/reader/selectors.ts")).not.toMatch(/contact-info|overlay\/contact/);
  });

  it("the code that runs inside LinkedIn and the background are framework-free", () => {
    for (const file of SRC.filter((f) => /^src\/(reader|overlay|background|ui)\//.test(f) || /^src\/[^/]+\.ts$/.test(f))) {
      expect(read(file), file).not.toMatch(/from "react|from "react-dom|\.tsx"/);
      expect(file.endsWith(".tsx"), file).toBe(false);
    }
  });

  it("the extension API namespace is read only in ext.ts", () => {
    const hits = SRC.filter((f) => /\b(chrome|browser)\.(runtime|tabs|storage|scripting|identity|permissions|i18n)\b/.test(code(f)));
    expect(hits).toEqual([]);
    expect(code("src/ext.ts")).toMatch(/scope\.browser \?\? scope\.chrome/);
  });
});

describe.each(TARGETS)("built bundles: dist/%s", (target) => {
  const bundle = (file: string): string => read(`dist/${target}/${file}`);

  it("exists", () => {
    for (const file of [...OWN_BUNDLES, "popup.js", "popup.css", "popup.html", "manifest.json", "_locales/en/messages.json", "icons/16.png", "icons/48.png", "icons/128.png", "THIRD_PARTY.md"]) {
      expect(existsSync(path.join(root, "dist", target, file)), file).toBe(true);
    }
  });

  it("fetch is absent from the injected bundles and the popup, and present once in the background", () => {
    for (const file of INJECTED) expect(FETCH.test(bundle(file)), file).toBe(false);
    expect(FETCH.test(bundle("popup.js"))).toBe(false);
    expect(count(bundle("background.js"), FETCH)).toBe(1);
  });

  it("no storage API in the injected bundles or the popup", () => {
    for (const file of [...INJECTED, "popup.js"]) expect(STORAGE.test(bundle(file)), file).toBe(false);
  });

  it("only the reader can click or scroll, through its one click and one scroll call", () => {
    expect(count(bundle("reader.js"), /\.click\s*\(/)).toBe(1);
    expect(count(bundle("reader.js"), /scrollBy/)).toBe(1);
    expect(bundle("reader.js")).not.toMatch(/dispatchEvent|scrollTo|scrollIntoView|\.focus\s*\(/);
    for (const file of ["overlay.js", "background.js"]) for (const [name, pattern] of INTERACT) expect(pattern.test(bundle(file)), `${name} in ${file}`).toBe(false);
  });

  it.each(BANNED)("%s is in none of the extension's own bundles", (_name, pattern) => {
    for (const file of OWN_BUNDLES) expect(pattern.test(bundle(file)), file).toBe(false);
  });

  it("the popup bundle (which contains React) makes no network or storage call of any kind", () => {
    for (const [name, pattern] of POPUP_BANNED) expect(pattern.test(bundle("popup.js")), name).toBe(false);
  });

  it("the injected and background bundles contain zero third-party code", () => {
    for (const file of OWN_BUNDLES) {
      const text = bundle(file);
      expect(text, file).not.toMatch(/node_modules|react-dom|react\/jsx|createRoot|--tw-|tailwindcss v|@layer/i);
      // esbuild names each bundled module in a comment; all of them are this repository's files.
      const modules = [...text.matchAll(/^\s*\/\/ ((?:src|inline-css:)[^\n]*)$/gm)].map((m) => m[1]!);
      expect(modules.length).toBeGreaterThan(2);
      for (const module of modules) expect(module).toMatch(/^(src\/|inline-css:)/);
      expect([...text.matchAll(/^\s*\/\/ (node_modules\/[^\n]*)$/gm)]).toEqual([]);
    }
    expect(bundle("overlay.js")).not.toMatch(/createRoot|jsx/);
  });

  it("names no host but Scouty and LinkedIn", () => {
    const hosts = (text: string): string[] => [...new Set([...text.matchAll(/\bhttps?:\/\/([A-Za-z0-9.-]+)/g)].map((m) => m[1]!))].sort();
    for (const file of OWN_BUNDLES) for (const host of hosts(bundle(file))) expect(["scouty.to", "www.linkedin.com"], `${host} in ${file}`).toContain(host);
    // React's bundle names its documentation site and XML namespaces in strings; it requests none of them.
    for (const host of hosts(bundle("popup.js"))) expect(["scouty.to", "www.linkedin.com", "react.dev", "www.w3.org"], `${host} in popup.js`).toContain(host);
    expect(bundle("background.js")).not.toMatch(/linkedin\.test|scouty\.test|localhost/);
  });

  it("the popup works under the strict CSP: no inline script or style, one static stylesheet", () => {
    const html = bundle("popup.html");
    expect(html).not.toMatch(/<style|style=|onclick=|javascript:/i);
    expect([...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => [m[1]!.trim(), m[2]!.trim()])).toEqual([['src="popup.js"', ""]]);
    expect(html).toContain('<link rel="stylesheet" href="popup.css">');
    expect(bundle("popup.css")).not.toMatch(/@import|url\(\s*["']?https?:/);
    // That nothing violates the CSP at run time is asserted in the browser run (e2e/capture.spec.ts).
  });

  it("store builds carry no click log", () => {
    expect(bundle("background.js")).toMatch(/debugClicks: false|"debugClicks":false/);
    expect(bundle("reader.js")).toMatch(/"debugClicks":false|debugClicks: false/);
  });
});

describe("repository rules", () => {
  const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string>; devDependencies: Record<string, string> };

  it("runtime dependencies are exactly the allow-list (React for the popup), pinned", () => {
    // Allow-list. Anything else must be justified and added here on purpose.
    const ALLOWED = ["react", "react-dom"];
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(ALLOWED);
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    expect(existsSync(path.join(root, "package-lock.json"))).toBe(true);
  });

  it("no secrets or internal hostnames in tracked files", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean).filter((f) => !/\.(png)$/.test(f) && f !== "package-lock.json");
    const forbidden = /BEGIN [A-Z ]*PRIVATE KEY|client_secret|rk_live|sk-[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|staging\.scouty/;
    // Internal hostnames are never named in this public repository: set PRIVATE_DENY_PATTERNS (a regex) locally or as a CI secret.
    const extra = process.env.PRIVATE_DENY_PATTERNS ? new RegExp(process.env.PRIVATE_DENY_PATTERNS, "i") : null;
    // This test and the CI scan that name the generic patterns are the only files allowed to contain them.
    const self = ["test/static/static-rules.test.ts", ".github/workflows/ci.yml"];
    expect(tracked.filter((f) => !self.includes(f) && existsSync(path.join(root, f)) && forbidden.test(read(f)))).toEqual([]);
    if (extra) expect(tracked.filter((f) => existsSync(path.join(root, f)) && extra.test(read(f)))).toEqual([]);
    for (const ignored of ["dist/", "release/", ".env.local", "*.pem", "*.zip", "node_modules/"]) expect(read(".gitignore")).toContain(ignored);
  });

  it("every synthetic fixture is labelled, and no font or logo file is in the repository", () => {
    for (const file of walk("fixtures/synthetic").filter((f) => f.endsWith(".html"))) expect(read(file).startsWith("<!-- SYNTHETIC: not captured from LinkedIn; structure is a best guess"), file).toBe(true);
    const all = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
    expect(all).not.toMatch(/\.(woff2?|ttf|otf|eot)$/m);
    expect(all).not.toMatch(/scouty-mark|logo/i);
  });
});

describe("tokens", () => {
  const tokens = JSON.parse(read("src/ui/tokens.json")) as Record<string, unknown>;
  const source = JSON.parse(read("src/ui/tokens.source.json")) as { file: string; commit: string; pills: string; note: string };

  it("tokens.css is exactly what tokens.json generates", () => {
    expect(read("src/ui/tokens.css")).toBe(tokensCss(tokens, source));
  });

  it("names its source file and app commit", () => {
    expect(read("src/ui/tokens.css")).toMatch(/src\/app\/globals\.css at commit [0-9a-f]{7}/);
    expect(source.file).toBe("src/app/globals.css");
    expect(Object.keys(tokens)).toEqual(["radius", "light", "dark", "pill"]); // the app's exported shape, nothing added
  });

  it("holds the app's palette: near-black action, soft white background, one blue accent", () => {
    expect(tokens.light).toMatchObject({ primary: "#18181b", "primary-hover": "#27272a", background: "#fafafa", ring: "#2558de", "muted-foreground": "#62626b", border: "#e4e4e7" });
    expect(tokens.radius).toBe("0.625rem");
    expect(Object.keys(tokens.pill as object)).toEqual(["light", "dark"]);
    expect(Object.keys((tokens.pill as { light: object }).light)).toEqual(["good", "active", "waiting", "problem", "neutral"]);
    expect(Object.keys(tokens.light as object)).toEqual(Object.keys(tokens.dark as object));
  });

  it("no colour literal outside tokens.css and tokens.json", () => {
    const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/;
    const files = [...walk("src").filter((f) => /\.(ts|tsx|css|html)$/.test(f)), ...walk("gallery").filter((f) => /\.(ts|tsx|css)$/.test(f))].filter((f) => f !== "src/ui/tokens.css");
    expect(files.filter((f) => literal.test(read(f)))).toEqual([]);
  });

  it("the popup stylesheet is driven by the tokens, and the overlay shares them", () => {
    const css = read("src/popup/popup.css");
    expect(css).toContain('@import "../ui/tokens.css"');
    for (const name of ["background", "foreground", "primary", "primary-hover", "muted-foreground", "border", "ring", "destructive"]) expect(css).toContain(`--color-${name}: var(--${name});`);
    expect(read("src/overlay/overlay.ts")).toContain('import tokensCss from "../ui/tokens.css?inline"');
    expect(read("dist/chrome/popup.css")).toContain("#18181b");
    expect(read("dist/chrome/overlay.js")).toContain("--primary: #18181b");
  });
});
