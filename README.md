# Scouty LinkedIn Capture

A Manifest V3 browser extension for Chrome, Edge and Firefox (desktop). When you press **Capture**
on a `linkedin.com/in/<slug>` profile, it reads that person's profile and recent posts, comments
and reactions from your own signed-in LinkedIn tab, at the pace of a person reading, and sends
them to your Scouty workspace for analysis.

- **Read-only on LinkedIn.** It never clicks Follow, Like, Comment, Connect or Message, never
  posts, and sends no request to LinkedIn. The only things it presses are inline "…see more" and
  "Show more results" controls, decided by a structural allow-list.
- **No LinkedIn credentials.** It never reads LinkedIn credentials (no LinkedIn cookie, token or
  password) or messages, and never opens the contact-info overlay. The only authentication
  information it handles is its own Scouty access token, kept in the browser's extension storage
  and sent only to Scouty (PRIVACY.md).
- **One network destination.** Requests go only to the Scouty API, from one module.
- **User-started, one profile at a time.** Nothing runs in the background.

Using automated tools on LinkedIn is against LinkedIn's User Agreement and LinkedIn may restrict
accounts that use them. See [PRIVACY.md](PRIVACY.md).

> **Status: not validated against live LinkedIn.** Every LinkedIn selector, the activity-id
> timestamp rule and the assumptions about the activity pages were written without access to a
> LinkedIn session. All fixtures are synthetic. The owner task E0 in
> [fixtures/README.md](fixtures/README.md) settles them before any release.

## Architecture

```
popup (extension page)          background (service worker / event page)        LinkedIn tab
React + Tailwind                plain TypeScript                                 plain TypeScript
────────────────────            ───────────────────────────────────────         ─────────────────────────
popup.tsx  ── ui:getState ──►   index.ts      listeners only
PopupView.tsx                   session.ts    capture state machine      ──►     reader.js   (injected per page)
  draws viewFor(state)          auth.ts       OAuth code + PKCE, tokens          overlay.js  (closed shadow root)
                                api.ts        THE ONLY fetch, Scouty only
                                outbox.ts     storage.session, resume
                                permissions.ts, ui-state.ts
```

| Part | Files | Notes |
| --- | --- | --- |
| Protocol | `src/protocol.ts`, `protocol-v1/` | Types, builders and a mirror of the server's schema. `protocol-v1/` is byte-identical to the app's copy. |
| Reader | `src/reader/` | `selectors.ts` is the only file with LinkedIn selectors; `interactions.ts` the only file that may click or scroll. |
| Background | `src/background/` | `api.ts` is the only file that calls `fetch`, and only for the Scouty origin and a fixed path list. |
| View model | `src/ui/state.ts`, `src/ui/view.ts` | `viewFor(state)` is pure and framework-free; every string comes from `_locales/en/messages.json`. |
| Popup | `src/popup/` | React 19 + Tailwind CSS 4, the same majors as the Scouty app. Thin renderer of the view model. |
| Overlay | `src/overlay/` | Plain DOM in a closed shadow root with a small static stylesheet built from the same tokens. |
| Tokens | `src/ui/tokens.json`, `src/ui/tokens.source.json`, `src/ui/tokens.css` | `tokens.json` is byte for byte the app's `extension-tokens.json`; `tokens.css` is generated from it and holds the only colour values in the repository. |

### Why the popup uses React and Tailwind (a deviation from the original plan)

The plan chose plain TypeScript with no framework for all UI. The product owner decided the
extension's pages should be built like the app: **the popup and the state gallery are React +
Tailwind**. The boundaries that the read-only guarantee depends on did not move:

- Everything that runs **inside the LinkedIn page** (reader, selectors, page-state detection,
  interactions, pacing, the overlay) and the **background** is framework-free TypeScript with zero
  third-party code. `test/static` scans those bundles strictly.
- The popup bundle contains React as a vetted dependency. The network and storage rules still
  apply to it: it has no `fetch`, no storage call, no `XMLHttpRequest`/`WebSocket`/`eval`.
- Tailwind is compiled to a static `popup.css` at build time. Nothing is injected at run time, so
  the extension-pages CSP stays `style-src 'self'` with no `unsafe-inline`. The e2e run asserts no
  CSP violation.
- Runtime dependencies are an explicit allow-list (`react`, `react-dom`); a test fails on any other.
- No component library is used: the few components needed (button, status pill, alert, progress,
  skeleton) are native elements with no behaviour that would need one.

Built popup size, per target (identical across targets apart from the build constants):
`popup.js` about 212 kB minified, `popup.css` about 20 kB.

## Commands

| Command | Does |
| --- | --- |
| `npm ci` | Install exactly the lockfile |
| `npm run typecheck` / `npm run lint` | `tsc --noEmit` / `eslint .` |
| `npm run build` | `dist/chrome`, `dist/edge`, `dist/firefox` (store builds, API `https://scouty.to`) |
| `npm run build:dev` | The same targets against `SCOUTY_API_ORIGIN` from `.env.local` (default `http://localhost:3000`), with the click log on |
| `npm test` | Unit, static, UI and contract layers |
| `npm run test:e2e` | Builds `dist/e2e`, then the Playwright suite in Chromium against a mock LinkedIn and a stub of the capture API |
| `npm run gallery` / `npm run test:gallery` | Builds `gallery/index.html` (open it in a browser for design review; it is git-ignored); checks it with axe, measured contrast and the 360 × 560 limit |
| `npm run lint:firefox` / `npm run smoke:firefox` | `web-ext lint` on `dist/firefox`; a Firefox start-up check (needs Firefox; CI runs it under `xvfb-run`, manual steps in `validation/FIREFOX-SMOKE.md`) |
| `npm run package` | `release/scouty-ext-<version>-{chrome,edge,firefox}.zip` and the source archive |
| `npm run check` | typecheck, lint, build, test, test:e2e, lint:firefox |
| `npm run sanitize -- <saved.html> <out.html>` | The allow-list sanitizer for saved pages (owner task E0 only) |
| `npm run tokens` / `npm run icons` | Regenerate `tokens.css` from `tokens.json`; regenerate the placeholder icons |

## Load the unpacked build

1. `nvm use && npm ci && npm run build:dev` (or `npm run build` for the store build).
2. Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → `dist/chrome`.
   Edge: `edge://extensions` → Developer mode → **Load unpacked** → `dist/edge`.
   Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `dist/firefox/manifest.json`.
3. The app must run locally and know this build: follow the app plan's §15.1 "O1 Local setup"
   (`docs/plans/linkedin-outreach-coach.md` in the `scouty` repository), as summarised, with its
   safety rules, in "Local setup" of [validation/VALIDATION.md](validation/VALIDATION.md#local-setup).
   Never run the app or its worker against the database in the app's `.env`.

## Building from source (for store reviewers)

The packages are bundled and the popup bundle is minified, so the exact steps to rebuild them are
in [BUILD.md](BUILD.md). In short: Node 24, `npm ci`, `npm run build`, `npm run package`.

## Tests

| Layer | Command | Proves |
| --- | --- | --- |
| Unit | `npm run test:unit` | Reader, clamps, URN, page state, interactions (traps are never clicked), pacing, auth, API client, outbox, every state × event pair of the state machine |
| Static | `npm run test:static` | The read-only and network rules on `src/` and on every built bundle; exact manifests; dependency allow-list; no secrets; tokens; sanitizer |
| UI | `npm run test:ui` | All 26 states rendered with React in jsdom, light and dark, with axe; the overlay's closed shadow root |
| Contract | `npm run test:contract` | `protocol-v1/` matches its checksum (and the app's copy when checked out next to this repo); builders produce the valid examples; the stub gives every example its recorded outcome |
| Browser e2e | `npm run test:e2e` | The whole flow in Chromium; in every scenario LinkedIn saw only GET navigations to the expected pages and clicks only on expand and load-more controls |
| Gallery | `npm run test:gallery` | axe, measured WCAG AA contrast and the popup size limit for every state |

What no automated test proves is listed in [RELEASE.md](RELEASE.md).

## Deviations from the plan, and open points

See [docs/DEVIATIONS.md](docs/DEVIATIONS.md). Browser-platform facts checked against current
documentation are in [docs/BROWSER-FACTS.md](docs/BROWSER-FACTS.md).
