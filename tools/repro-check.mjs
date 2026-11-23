// Builds twice and compares the hash of every output file. Used by CI and the release checklist.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
function snapshot() {
  execFileSync(process.execPath, [path.join(root, "build.mjs"), "--quiet"], { cwd: root, stdio: "inherit" });
  return Object.fromEntries(["chrome", "edge", "firefox"].flatMap((t) => walk(path.join(root, "dist", t))).sort().map((file) => [path.relative(root, file), createHash("sha256").update(readFileSync(file)).digest("hex")]));
}
const first = snapshot();
const second = snapshot();
const differing = Object.keys({ ...first, ...second }).filter((file) => first[file] !== second[file]);
if (differing.length) {
  console.error(`NOT reproducible: ${differing.join(", ")}`);
  process.exit(1);
}
console.log(`reproducible: ${Object.keys(first).length} files identical across two builds`);
for (const [file, hash] of Object.entries(first)) if (/\.(js|css)$/.test(file) || file.endsWith("manifest.json")) console.log(`${hash}  ${file}`);
