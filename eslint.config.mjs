// ESLint flat config. Besides the usual checks it repeats the read-only and network rules of
// test/static/static-rules.test.ts, so a violation is flagged while typing, not only in CI.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const banned = (selector, message) => ({ selector, message });
const call = (name) => `CallExpression[callee.name='${name}']`;
const member = (prop) => `MemberExpression[property.name='${prop}']`;

/** Allowed nowhere in src/. */
const NOWHERE = [
  banned("CallExpression[callee.property.name=/^(submit|requestSubmit|sendBeacon|insertAdjacentHTML)$/]", "Forbidden: the extension never submits, beacons or writes HTML strings."),
  banned("NewExpression[callee.name=/^(XMLHttpRequest|WebSocket|EventSource|Image|Function)$/]", "Forbidden constructor."),
  banned("Identifier[name=/^(XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage|indexedDB)$/]", "Forbidden API."),
  banned(call("eval"), "No eval."),
  banned("ImportExpression", "No dynamic import: everything is bundled."),
  banned("MemberExpression[property.name=/^(innerHTML|outerHTML|cookie|cookies|webRequest)$/]", "Forbidden property."),
  banned("MemberExpression[object.property.name='storage'][property.name='sync']", "storage.sync is never used."),
  banned("CallExpression[callee.object.name='window'][callee.property.name='open']", "Pages are opened with tabs.create in the background."),
  banned("CallExpression[callee.object.name='location'][callee.property.name=/^(assign|replace)$/]", "Navigation is done with tabs.update in the background."),
  banned("AssignmentExpression[left.object.name='location']", "Navigation is done with tabs.update in the background."),
  banned("AssignmentExpression[left.name='location']", "Navigation is done with tabs.update in the background."),
];
const FETCH = [banned(call("fetch"), "fetch is called only in src/background/api.ts.")];
const CLICKS = [
  banned("CallExpression[callee.property.name=/^(click|dispatchEvent|scrollBy|scrollTo|scrollIntoView|focus)$/]", "Clicking, scrolling and focusing happen only in src/reader/interactions.ts."),
];
const STORAGE = [banned(member("storage"), "Extension storage is used only under src/background/ and src/popup/.")];

export default tseslint.config(
  { ignores: ["dist/", "release/", "node_modules/", "gallery/index.html", "test-results/", "playwright-report/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "error",
    },
  },
  // Everything that ships.
  { files: ["src/**/*.{ts,tsx}"], rules: { "no-restricted-syntax": ["error", ...NOWHERE, ...FETCH, ...CLICKS, ...STORAGE] } },
  // Storage: background and popup only (the UI state type lives in src/ui and touches none).
  { files: ["src/background/**/*.ts", "src/popup/**/*.{ts,tsx}"], rules: { "no-restricted-syntax": ["error", ...NOWHERE, ...FETCH, ...CLICKS] } },
  // The one API client.
  { files: ["src/background/api.ts"], rules: { "no-restricted-syntax": ["error", ...NOWHERE, ...CLICKS] } },
  // The one module that touches the LinkedIn page.
  { files: ["src/reader/interactions.ts"], rules: { "no-restricted-syntax": ["error", ...NOWHERE, ...FETCH, ...STORAGE] } },
  // The extension's own surfaces may move focus inside themselves (never on LinkedIn's elements).
  // The popup is the extension's own page: it may move focus to its own title (never on LinkedIn).
  { files: ["src/popup/**/*.{ts,tsx}"], rules: { "no-restricted-syntax": ["error", ...NOWHERE, ...FETCH, banned("CallExpression[callee.property.name=/^(click|dispatchEvent|scrollBy|scrollTo|scrollIntoView)$/]", "No clicking or scrolling here.")] } },
  { files: ["**/*.mjs", "tools/**", "e2e/**", "gallery/**", "test/**", "*.ts"], languageOptions: { globals: { process: "readonly", console: "readonly", Buffer: "readonly", URL: "readonly", URLSearchParams: "readonly", TextDecoder: "readonly", TextEncoder: "readonly", Response: "readonly", setTimeout: "readonly", clearTimeout: "readonly", fetch: "readonly", document: "readonly", window: "readonly", location: "readonly" } }, rules: { "no-console": "off" } },
);
