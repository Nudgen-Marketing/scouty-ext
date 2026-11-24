// Builds gallery/index.html: one self-contained static page (styles and script inline) that
// renders every state with the extension's own view model and renderers.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const inlineCss = {
  name: "inline-css",
  setup(b) {
    b.onResolve({ filter: /\.css\?inline$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?inline$/, "")), namespace: "inline-css" }));
    b.onLoad({ filter: /.*/, namespace: "inline-css" }, async (a) => ({ contents: await readFile(a.path, "utf8"), loader: "text" }));
  },
};
const tmp = await mkdtemp(path.join(os.tmpdir(), "scouty-gallery-"));
try {
  await build({
    entryPoints: [path.join(here, "main.tsx")], outfile: path.join(tmp, "gallery.js"), bundle: true, format: "iife", minify: true, jsx: "automatic",
    plugins: [inlineCss], logLevel: "warning", absWorkingDir: root, target: ["chrome116"],
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"), __SCOUTY_ENTRY__: "false", __SCOUTY_DEV__: "false",
      __SCOUTY_BUILD__: JSON.stringify({ apiOrigin: "https://scouty.to", linkedinOrigin: "https://www.linkedin.com", clientId: "scouty-ext-chrome", browser: "chrome", version: "gallery", debugClicks: false, dev: false }),
    },
  });
  execFileSync(process.execPath, [path.join(root, "node_modules/@tailwindcss/cli/dist/index.mjs"), "--input", "gallery/gallery.css", "--output", path.join(tmp, "gallery.css")], { cwd: root, stdio: "ignore" });
  const css = await readFile(path.join(tmp, "gallery.css"), "utf8");
  const js = (await readFile(path.join(tmp, "gallery.js"), "utf8")).replace(/<\/script/g, "<\\/script");
  // The frame that stands in for the browser viewport around the overlay card.
  const frame = ".gallery-viewport{position:relative;transform:translateZ(0);width:360px;height:420px;overflow:hidden;border:1px dashed var(--border);border-radius:var(--radius)}";
  await writeFile(path.join(here, "index.html"), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scouty Extension: state gallery</title>
<style>${css}\n${frame}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`);
  console.log("built gallery/index.html");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
