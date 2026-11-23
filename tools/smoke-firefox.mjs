// Firefox start-up smoke check: web-ext starts Firefox with dist/firefox installed as a temporary
// add-on; the check passes when the add-on is installed and no manifest or background error is
// reported within the time limit. A start-up check, not a driven test (Playwright does not
// support extensions in Firefox).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [process.env.FIREFOX_BIN, "/Applications/Firefox.app/Contents/MacOS/firefox", "/usr/bin/firefox", "/snap/bin/firefox"].filter(Boolean);
const firefox = candidates.find((file) => existsSync(file));
if (!firefox) {
  console.error("smoke:firefox could not run: Firefox is not installed (set FIREFOX_BIN to its binary).");
  process.exit(2);
}
if (!existsSync(path.join(root, "dist/firefox/manifest.json"))) {
  console.error("smoke:firefox: run `npm run build` first.");
  process.exit(2);
}
const child = spawn(process.execPath, [path.join(root, "node_modules/web-ext/bin/web-ext.js"), "run", "--source-dir", "dist/firefox", "--firefox", firefox, "--no-reload", "--no-input", "--verbose", "--args=-headless"], { cwd: root });
let output = "";
let done = false;
const finish = (code, message) => {
  if (done) return;
  done = true;
  child.kill("SIGTERM");
  console.log(message);
  process.exit(code);
};
const onData = (chunk) => {
  output += chunk.toString();
  if (/Installed .* as a temporary add-on/.test(output)) setTimeout(() => {
    const bad = /(background\.js.*(Error|error)|Reading manifest:.*(Error|error)|Loading extension .* failed)/.exec(output);
    finish(bad ? 1 : 0, bad ? `smoke:firefox FAILED: ${bad[0]}` : "smoke:firefox passed: the add-on was installed and the background page reported no error.");
  }, 5000);
};
child.stdout.on("data", onData);
child.stderr.on("data", onData);
child.on("exit", (code) => finish(code === 0 ? 1 : (code ?? 1), `smoke:firefox FAILED: web-ext exited early.\n${output.slice(-2000)}`));
setTimeout(() => finish(1, `smoke:firefox FAILED: timed out.\n${output.slice(-2000)}`), 90_000);
