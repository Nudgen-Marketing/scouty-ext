// Builds the three store packages and the source archive (for AMO) into release/.
//   release/scouty-ext-<version>-{chrome,edge,firefox}.zip   the contents of dist/<target>/
//   release/scouty-ext-<version>-source.zip                  the tracked source tree
// Always starts from a fresh store build, so a development or e2e build can never be packaged.
// In a git checkout it refuses a working tree with changes (`git status --porcelain` not empty): the
// source archive is `git ls-files` (the tracked files as they are on disk) while the store zips are
// built from the whole working tree, so a change or an untracked file could reach one and not the
// other. `--allow-dirty` packages anyway (a local try; never for a release).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "./zip.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", "dist", "release", ".git", "test-results", "playwright-report"]);

async function walk(dir, base = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), rel)));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

async function sourceFiles() {
  if (existsSync(path.join(root, ".git"))) {
    return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  }
  // No git (a reviewer working from the source archive): everything except build output.
  const top = (await readdir(root, { withFileTypes: true })).filter((e) => !SKIP.has(e.name) && e.name !== ".env.local" && e.name !== ".DS_Store");
  const out = [];
  for (const entry of top) {
    if (entry.isDirectory()) out.push(...(await walk(path.join(root, entry.name), entry.name)));
    else out.push(entry.name);
  }
  return out.filter((file) => file !== "gallery/index.html" && !file.endsWith(".zip") && !file.endsWith(".DS_Store"));
}

const zipOf = async (dir, files) => createZip(await Promise.all(files.map(async (name) => ({ name, data: await readFile(path.join(dir, name)) }))));

if (existsSync(path.join(root, ".git")) && !process.argv.includes("--allow-dirty")) {
  const changes = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trimEnd();
  if (changes) {
    console.error(`The working tree has changes; commit or stash them first (or pass --allow-dirty for a local try):\n${changes}`);
    process.exit(1);
  }
}

execFileSync(process.execPath, [path.join(root, "build.mjs"), "--quiet"], { cwd: root, stdio: "inherit" });
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
await rm(path.join(root, "release"), { recursive: true, force: true });
await mkdir(path.join(root, "release"), { recursive: true });
const written = [];
for (const target of ["chrome", "edge", "firefox"]) {
  const dir = path.join(root, "dist", target);
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
  if (manifest.key || !manifest.host_permissions.includes("https://scouty.to/*")) throw new Error(`dist/${target} is not a store build`);
  const file = `scouty-ext-${version}-${target}.zip`;
  await writeFile(path.join(root, "release", file), await zipOf(dir, await walk(dir)));
  written.push(file);
}
const source = `scouty-ext-${version}-source.zip`;
await writeFile(path.join(root, "release", source), await zipOf(root, await sourceFiles()));
written.push(source);
for (const file of written) {
  const hash = createHash("sha256").update(await readFile(path.join(root, "release", file))).digest("hex");
  console.log(`${hash}  release/${file}`);
}
