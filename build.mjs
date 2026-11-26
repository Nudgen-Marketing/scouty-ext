// Builds dist/<target>/ for chrome, edge and firefox (or dist/e2e with --e2e).
// No minification and no timestamps: the output is readable and reproducible.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const dev = args.has("--dev");
const e2e = args.has("--e2e");
const quiet = args.has("--quiet");

export const PRODUCTION_API_ORIGIN = "https://scouty.to";
export const LINKEDIN_ORIGIN = "https://www.linkedin.com";
export const CLIENT_IDS = { chrome: "scouty-ext-chrome", edge: "scouty-ext-edge", firefox: "scouty-ext-firefox" };
export const E2E = { apiOrigin: "http://scouty.test", linkedinOrigin: "http://linkedin.test" };

const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));

async function devApiOrigin() {
  let value = process.env.SCOUTY_API_ORIGIN ?? "";
  const file = path.join(root, ".env.local");
  if (!value && existsSync(file)) {
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      const match = /^\s*SCOUTY_API_ORIGIN\s*=\s*(.*?)\s*$/.exec(line);
      if (match) value = match[1].replace(/^["']|["']$/g, "");
    }
  }
  const origin = new URL(value || "http://localhost:3000").origin;
  return origin;
}

/**
 * `import css from "./x.css?inline"` gives the file's text (the overlay styles its shadow root with it).
 * The module path is relative to the project, with forward slashes: esbuild writes it as a comment in
 * the unminified bundle, and an absolute path would make every build folder produce different bytes
 * (a store reviewer rebuilding the source archive elsewhere would not get the published package).
 */
const inlineCss = {
  name: "inline-css",
  setup(b) {
    b.onResolve({ filter: /\.css\?inline$/ }, (a) => ({
      path: path.relative(root, path.resolve(a.resolveDir, a.path.replace(/\?inline$/, ""))).split(path.sep).join("/"),
      namespace: "inline-css",
    }));
    b.onLoad({ filter: /.*/, namespace: "inline-css" }, async (a) => ({ contents: await readFile(path.join(root, a.path), "utf8"), loader: "text" }));
  },
};

/** The e2e build swaps exactly these modules for test variants (plan 13.1); store builds never see them. */
function e2eSwap(swaps) {
  return {
    name: "e2e-swap",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => {
        if (!a.path.startsWith(".")) return null;
        const resolved = path.resolve(a.resolveDir, a.path).replace(/\.ts$/, "");
        const hit = swaps[path.relative(root, resolved)];
        return hit ? { path: path.join(root, hit) } : null;
      });
    },
  };
}

function hostPattern(origin) {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

export async function manifestFor(target, { apiOrigin, linkedinOrigin, version, key }) {
  const base = await readJson("manifest.base.json");
  const extra = await readJson(`manifest.${target}.json`);
  const manifest = { ...base, version, ...extra };
  manifest.host_permissions = [`${linkedinOrigin}/in/*`, hostPattern(apiOrigin)];
  manifest.content_security_policy = {
    extension_pages: base.content_security_policy.extension_pages.replace("<API_ORIGIN>", apiOrigin),
  };
  if (key) manifest.key = key;
  return manifest;
}

async function buildTarget(name, { target, apiOrigin, linkedinOrigin, key, swaps, debugClicks, devBuild }) {
  const pkg = await readJson("package.json");
  const out = path.join(root, "dist", name);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const define = (entry) => ({
    __SCOUTY_BUILD__: JSON.stringify({
      apiOrigin, linkedinOrigin, clientId: CLIENT_IDS[target], browser: target,
      version: pkg.version, debugClicks, dev: devBuild,
    }),
    __SCOUTY_ENTRY__: JSON.stringify(entry),
    // A bare constant, so esbuild drops the development-only code (and its strings) from store builds.
    __SCOUTY_DEV__: JSON.stringify(devBuild),
  });
  const common = {
    bundle: true, minify: false, sourcemap: false, legalComments: "none", charset: "utf8",
    target: target === "firefox" ? ["firefox140"] : ["chrome116"],
    plugins: [inlineCss, ...(swaps ? [e2eSwap(swaps)] : [])],
    logLevel: "warning", absWorkingDir: root,
  };
  const entries = [
    ["src/background/index.ts", "background.js", "esm"],
    ["src/reader/index.ts", "reader.js", "iife"],
    ["src/overlay/overlay.ts", "overlay.js", "iife"],
  ];
  for (const [entry, file, format] of entries) {
    await build({ ...common, entryPoints: [entry], outfile: path.join(out, file), format, define: define(true) });
  }
  // The popup is the only bundle with third-party code (React). It is minified; everything that
  // runs in the background or inside the LinkedIn page stays unminified and framework-free.
  await build({
    ...common, entryPoints: ["src/popup/popup.tsx"], outfile: path.join(out, "popup.js"), format: "iife", minify: true, jsx: "automatic",
    define: { ...define(true), "process.env.NODE_ENV": JSON.stringify("production") },
  });
  // Tailwind is compiled to a static stylesheet at build time. No runtime style injection.
  execFileSync(process.execPath, [path.join(root, "node_modules/@tailwindcss/cli/dist/index.mjs"), "--input", "src/popup/popup.css", "--output", path.join(out, "popup.css"), "--minify"], { cwd: root, stdio: ["ignore", "ignore", quiet ? "ignore" : "inherit"] });
  await cp(path.join(root, "src/popup/popup.html"), path.join(out, "popup.html"));
  await cp(path.join(root, "_locales"), path.join(out, "_locales"), { recursive: true });
  await cp(path.join(root, "icons"), path.join(out, "icons"), { recursive: true });
  // The licence notices of the bundled third-party code travel with every copy.
  await cp(path.join(root, "THIRD_PARTY.md"), path.join(out, "THIRD_PARTY.md"));
  const manifest = await manifestFor(target, { apiOrigin, linkedinOrigin, version: pkg.version, key });
  await writeFile(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  if (!quiet) console.log(`built dist/${name} (${target}, API ${apiOrigin})`);
}

async function main() {
  if (e2e) {
    const { key } = await readJson("e2e/build/key.json");
    await buildTarget("e2e", {
      target: "chrome", apiOrigin: E2E.apiOrigin, linkedinOrigin: E2E.linkedinOrigin, key,
      swaps: { "src/popup/target-tab": "e2e/build/target-tab.ts" },
      debugClicks: false, devBuild: false,
    });
    return;
  }
  const apiOrigin = dev ? await devApiOrigin() : PRODUCTION_API_ORIGIN;
  for (const target of ["chrome", "edge", "firefox"]) {
    await buildTarget(target, { target, apiOrigin, linkedinOrigin: LINKEDIN_ORIGIN, debugClicks: dev, devBuild: dev });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
