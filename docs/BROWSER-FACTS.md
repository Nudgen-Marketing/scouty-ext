# Browser-platform facts

Checked against current documentation on 2026-11-23. "Confirmed" means a primary source states it;
"not verified" means the documentation is silent and the extension does not depend on it, or it is
left to the owner's manual matrix (validation/VALIDATION.md).

| Topic | Finding | Status | Source |
| --- | --- | --- | --- |
| `identity.launchWebAuthFlow`, Chrome redirect | `https://<extension-id>.chromiumapp.org/`, from `identity.getRedirectURL()` | Confirmed | developer.chrome.com/docs/extensions/reference/api/identity |
| …in Edge | `launchWebAuthFlow` is supported (only `getAccounts` and `getAuthToken` are not). The redirect domain is not stated by Microsoft; assumed the same as Chrome | Support confirmed; redirect form **not verified** | learn.microsoft.com/microsoft-edge/extensions/developer-guide/api-support |
| …in Firefox | Redirect is `https://<sha1 of the add-on id, hex>.extensions.allizom.org/`; MDN says only "a fixed domain name and a subdomain derived from the add-on's ID". An explicit `gecko.id` keeps it stable | Confirmed from Firefox source, not from MDN prose | MDN `identity`; mozilla-firefox `ext-identity.js` |
| Background lifetime during sign-in | Chrome 116 exempts `launchWebAuthFlow` and `permissions.request` from the five-minute limit. Not worded as a keep-alive guarantee | Partly confirmed | developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle |
| Firefox background key | `background.service_worker` is not supported; `background.scripts` with `"type": "module"` works (Firefox 112+) | Confirmed | MDN `manifest.json/background`; browser-compat-data |
| `data_collection_permissions` | `browser_specific_settings.gecko.data_collection_permissions.required` accepts `websiteContent` and `personallyIdentifyingInfo`; Firefox desktop 140+; required for new extensions since 3 November 2025 | Confirmed | extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/ |
| `strict_min_version` | A version string such as `"140.0"` | Confirmed | MDN `browser_specific_settings` |
| Ports in host match patterns | Chrome accepts and matches a port; **Firefox does not support one** (a pattern with a port is ignored). The builds therefore declare `http://localhost/*` for a local app | Confirmed | Chrome and MDN match-pattern pages; Bugzilla 1362809 |
| Firefox host permissions | Shown in the install prompt from Firefox 127; users can grant or revoke them at any time, so the popup checks `permissions.contains` first | Confirmed | MDN `manifest.json/host_permissions` |
| Paths in `host_permissions` | **Chromium grants host permissions per host and drops the path:** the manifest pattern `https://www.linkedin.com/in/*` is reported by `permissions.getAll()` as `https://www.linkedin.com/*`. So in Chromium the browser alone does not keep the extension on `/in/` pages. The background checks the tab address before every injection and the reader checks it again before reading; neither relies on the permission. Firefox behaviour **not verified** | Found in the Chromium run (`e2e/store-build.spec.ts`); this corrects the plan (6.2, 6.3) | — |
| `permissions.request` | Must be called from a user action, before any `await`. Supported from a popup since Firefox 75. Whether the Firefox popup closes while the prompt shows is **not verified** | Confirmed, with one open point | MDN `permissions/request`, "User actions" |
| `storage.session` | Chrome 102+, Firefox 115+; in memory; 10 MB; not exposed to content scripts by default | Confirmed | Chrome storage reference; MDN `storage/session` |
| `storage.*.setAccessLevel` | Chrome: `session` area, and all areas from Chrome 140. **Firefox does not implement it.** The extension feature-detects the call; the injected bundles contain no storage call at all | Confirmed (this corrects the plan, which left Firefox open) | browser-compat-data |
| Extension-pages CSP | The policy used only tightens the default; `script-src 'self'` is within the allowed minimum. Whether Chrome warns about a missing `object-src` when `default-src 'none'` is present is **not verified** (no warning appeared in the Chromium run) | Consistent with the documented rules | Chrome CSP manifest reference; MDN CSP |
| CSP `connect-src` and background `fetch` | Implied for Chrome service workers, not stated outright; silent for the Firefox event page. The API client and host permissions do not depend on it | **Not verified** | Chrome "network requests" page |
| `scripting.executeScript` | `{ target: { tabId }, files }` works in Chrome and Firefox MV3 | Confirmed | Chrome scripting reference; MDN |
| Tabs without the `tabs` permission | `tabs.create` and `tabs.update` need no permission; `tab.url` is populated when a host permission matches. `tabs.get`, `onUpdated`, `onRemoved`, `sendMessage` have no stated requirement | Confirmed for Chromium by the e2e run; Firefox **not verified** here | Chrome tabs reference; MDN `tabs` |
| Web Locks in the background | Available in workers and secure contexts in general; not documented for extensions. `auth.ts` falls back to an in-process queue when `navigator.locks` is missing | **Not verified** for the Firefox event page | MDN Web Locks API |
| `i18n.getMessage` with `$1` | Direct `$1` substitution is documented by MDN; Chrome documents it only inside `placeholders`. It worked in the Chromium run | Firefox confirmed; Chrome confirmed by the e2e run only | MDN locale-specific message reference |
| Playwright and extensions | Bundled Chromium with a persistent context and `channel: "chromium"` (headless works); branded Chrome and Edge cannot side-load | Confirmed, and used | playwright.dev/docs/chrome-extensions |
| `--host-resolver-rules` with a port | `MAP host 127.0.0.1:port` rewrites host and port | Confirmed from Chromium source and by the e2e run | chromium `net/base/host_mapping_rules.h` |

## What this environment could not check

- Firefox is not installed on the build machine: `npm run smoke:firefox` was not run. `web-ext lint`
  was run and reports no errors (three warnings, listed in docs/DEVIATIONS.md).
- No LinkedIn session: selectors and activity-page assumptions are unverified (owner task E0).
- The real sign-in window in branded Chrome, Edge and Firefox, and whether it shares the browser
  profile's existing Scouty sign-in (owner matrix). The Chromium run did exercise the real
  `launchWebAuthFlow` against the API stub.
