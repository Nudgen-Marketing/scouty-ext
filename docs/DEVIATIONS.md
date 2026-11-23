# Deviations from the plan, decisions and open points

The specification is `docs/plans/linkedin-outreach-coach.md` in the Scouty app repository. Where
this repository differs from it, the intent and the guarantees were kept (read-only on LinkedIn,
one API client, least-privilege manifests, nothing reduced submitted as complete).

## Deviations

1. **React + Tailwind for the popup and the gallery** (owner decision; the plan said no framework,
   sections 6.7 and 12.5). `src/ui/components.css` and `src/ui/render.ts` of the plan's layout do
   not exist: the popup is `src/popup/*.tsx` with Tailwind, the overlay has its own
   `src/overlay/overlay.css` and renderer. The "no runtime dependencies" rule became an allow-list
   (`react`, `react-dom`). The popup bundle is minified; nothing else is.
2. **`.focus(` outside `reader/interactions.ts`.** The plan lists `.focus(` among the calls allowed
   only in `interactions.ts` and also asks the popup to move focus to its title. The popup may
   focus its own title; nothing that runs in the LinkedIn page focuses anything (the overlay does
   not take focus from the page).
3. **"The primary action is the first focusable element."** The header's settings button comes
   first in the page; focus is moved to the title on every state change, and the primary action is
   the first control after it. Enter on the title activates the primary action.
4. **`aria-hidden="true"` text.** The plan's walker skips every `aria-hidden="true"` element.
   LinkedIn's usual pattern is a visible `aria-hidden` span next to a screen-reader duplicate, so
   the walker reads an `aria-hidden` element when it has such a sibling and skips it otherwise.
   Unverified until E0.
5. **Head-and-tail clamp.** The plan keeps the first 1,200 and last 2,800 characters "with a marker
   between", which would exceed the 4,000 limit. The tail is 2,800 minus the 5-code-point marker
   (2,795), so a block is never longer than 4,000 code points. Every clamp counts Unicode code
   points, as the server does, and never splits a surrogate pair (`src/reader/clamp.ts`).
6. **Outbox keeps confirmed bytes until finalize.** The plan removes a section's bytes when it is
   acknowledged but also re-sends "the named sections from its outbox" on a manifest mismatch. A
   confirmed section stops being pending at once; its bytes stay in memory (storage.session) until
   finalize succeeds and are the first to go when the 8 MB bound is reached.
7. **`invalid_grant` and the outbox.** The plan says a failed refresh "clears everything" and also
   that a capture in flight is kept so reconnecting can finish it. Tokens are always cleared; the
   outbox is cleared unless a capture is in flight, and always on Disconnect.
8. **Uploads do not block reading.** If the Scouty API is unreachable while LinkedIn is still
   readable, the remaining sections are read and everything is sent when the connection returns
   ("You're offline", **Try now**, after a network failure; "Scouty isn't answering right now",
   **Try now**, when Scouty answered but could not take it). A section is never dropped for it.
9. **Sanitizer keeps a few things the plan's list drops:** the bare attribute names `hidden`,
   `disabled` and `href` (no value), and the ids `global-nav` and `captcha-internal`, because the
   page-state and click rules depend on their presence. Every other id and every value is dropped.
10. **State names.** The machine has the plan's states plus a `blocked` flag on `finalizing`
    (`offline` after a network failure, `server` when Scouty answered 408, 429, 502, 503 or 504, or
    `auth` while waiting for a reconnect) and notices on `idle` for terminal errors.
11. **Section step limit.** A section that reaches 40 steps or 90 seconds without reaching its end
    or cap is uploaded as `partial` with reason `timeout`, and the capture continues.
12. **Empty pages.** An activity or detail page that LinkedIn itself shows as empty is declared
    `unavailable: no_such_section` and not uploaded. The same is done when LinkedIn redirects a
    detail or activity address to another page of the same profile.
13. **Permission scenario in the browser run.** Chromium does not let an extension withdraw its
    own required host permissions, so the e2e test does what a user does: it sets the extension's
    "Site access" to "On click" on `chrome://extensions` (through that page's own
    `developerPrivate` API), which withholds both host permissions. It is also covered in
    `test/unit/ui-state.test.ts` against a mocked Firefox-shaped API. Pressing **Allow** opens a
    browser prompt that Playwright cannot answer, so the grant itself is left to the manual matrix.
13a. **No web-auth stub in the e2e build.** Chromium's real `identity.launchWebAuthFlow` completes
    headless against the stub's `/oauth/authorize` (which redirects straight back with a code), so
    the optional stub of plan 13.1 point (4) is not built. `dist/e2e` differs from `dist/chrome`
    only in the two origins, the fixed manifest `key` and the `?tabId=` target module, which
    `test/static/manifest.test.ts` asserts by diffing the two builds.
14. **Licence.** The plan lists a `LICENSE` file without naming a licence. A placeholder
    "all rights reserved, published for review" notice is used until the owner decides.
15. **Firefox lint warnings.** `web-ext lint` reports no errors and three warnings: two for
    `innerHTML` inside React's own code in `popup.js`, and one that
    `data_collection_permissions` needs Firefox for Android 142 (Android is not targeted and the
    plan asks for no `gecko_android` key).

16. **Host permission scope in Chromium.** The plan relies on the `/in/*` host pattern to keep the
    extension off LinkedIn's sign-in and checkpoint pages. Chromium ignores the path and grants the
    whole `www.linkedin.com` host. The manifest still declares the narrowest pattern (the stores
    show it and Firefox may honour it), and the restriction to `/in/<slug>/` pages is enforced in
    code: `profileFromUrl` in the background before every injection, and the slug check in the
    reader. A LinkedIn page outside `/in/` stops the capture with `left_linkedin`.

## Contract decisions (to reconcile with the app)

`protocol-v1/` is the app's directory, copied byte for byte. Where the plan left a shape open, the
extension follows the app's `src/lib/linkedin/protocol.ts`:

- Profile kinds send `blocks: []`; activity kinds send `profile: null`. `name` and `headline` are
  sent only in the `profile` section (null in `experience` and `skills`).
- The body sent is compact JSON in the builders' key order; the digest is over those exact bytes.
  Manifest `sha256` is lowercase hex; `Content-Digest` is `sha-256=:<base64>:`.
- `urn` is sent only as a whole `urn:li:activity:<digits>`; `urnTime` only as an ISO time between
  2003 and now. Otherwise null.
- Lengths are clamped in Unicode code points, the unit the server counts (an emoji counts once);
  name ≤ 120 and headline ≤ 220 (the wire allows 300 and 500).
- `pageSlug` is the raw slug from the tab's address, not normalized.
- `Counts` is `{ profileSections, posts, comments, reactions }`.
- One `Idempotency-Key` (a UUID) per create; one per distinct manifest for finalize.
- "Open in Scouty" for a recent capture opens `<origin>/dashboard?linkedin=<profileKey>`, because
  the `{ recent }` answer carries no URL. After finalize the server's `appUrl` is used, and only if
  it is on the Scouty origin.
- A 404 answer to create is shown as "This profile can't be captured", whatever its code.
- `src/ui/tokens.json` is byte for byte the app's `src/lib/linkedin/__fixtures__/extension-tokens.json`
  (`{ radius, light, dark, pill: { light, dark } }`); where and when it was copied is in
  `src/ui/tokens.source.json`, so release gate 3 is a plain `cmp`.
- After a lost finalize answer the app reports the capture as `finalized` with nothing in
  `received` (its staging is gone). Resume then sends no section again and repeats the same
  finalize (same `Idempotency-Key`, identical manifest), which returns the stored answer. A section
  `PUT` answered `LINKEDIN_CAPTURE_FINALIZED` is treated the same way.
- A create while this user already has an open capture of the profile gets the same capture back
  with a new upload token and nothing staged; the extension starts a fresh outbox for it and sends
  every section again. The other side of the same rule: the browser or device that held the
  capture before now gets `404 LINKEDIN_CAPTURE_NOT_FOUND` on its next section, finalize or status
  call. The same 404 comes when the capture was removed in Scouty (by the user, a teammate, or an
  erasure). All windows of one browser profile share one background, so another window of the same
  browser never causes it. Any 404 on a capture the extension holds (not on create) ends in screen
  25, "This capture stopped" (`takenOver`: **OK**, or **Capture here** to start it again here),
  whose copy names both causes without blaming one, and that capture's outbox is cleared. This screen is not in plan 12.4; it is numbered 25 so rows 1 to 24
  keep the plan's numbers. A repeated create key on a finalized, analyzable capture answers
  `{ recent }`, which shows the "captured recently" screen.
- `LINKEDIN_DISABLED` (503) is not retried and not treated as an outage: it ends in "not
  available". `LINKEDIN_UNAVAILABLE` (503) and `LINKEDIN_RATE_LIMITED` (429) are retried with
  `Retry-After` (a wait longer than 30 s is an answer), then shown during upload as screen 26,
  "Scouty isn't answering right now" (`notAnswering`), not as 16, "You're offline", which is kept
  for a network failure that got no answer at all. The app answers every unexpected fault on these
  routes with 503 `LINKEDIN_UNAVAILABLE` and `Retry-After: 5`, and its per-account rate limit with
  429 and `Retry-After: 60`; neither means the user is offline. Screen 26 says the capture is kept
  and that Scouty keeps trying while this browser is open; for a 429 it also says roughly when
  (the time from `Retry-After`). It has the same **Try now** as screen 16, and it tries again on
  its own after the longer of 20 s and `Retry-After` (`SERVER_RETRY_MS` in
  `src/background/session.ts`; under the 30 s a Chromium service worker may idle). A timer lost
  to a stopped background context is picked up on its next start (`recover`) and whenever the
  popup or the overlay asks for the state. Like 25, this screen is not in plan 12.4 and is
  numbered after it (tested in `test/unit/session.test.ts`, "waiting on Scouty is not being
  offline", and `test/ui/states.test.tsx`). When creating, the same failures (after the same
  retries, or a 429 with a wait over 30 s) also end in screen 26, in its create form: nothing was
  read or sent, nothing is kept or tried again on its own, and **Try now** starts the capture
  again; a rate limit says roughly when to try. A network error, a 500 and the other refusals at
  create keep their own screens ("Scouty couldn't receive this capture", "That's all for today",
  "Not available yet" and so on).
  The plan names only
  `LINKEDIN_UNAVAILABLE` as retried; the extension also retries a network error, 408 and the
  gateway answers 502 and 504 with the same backoff, because those say the server could not answer
  right now. A 500 and any other 5xx are terminal: never repeated, they end in "Scouty couldn't
  receive this capture" with **Capture again** (`RETRYABLE_STATUSES` in `src/background/api.ts`,
  `isTransient` in `src/background/session.ts`). `LINKEDIN_AUTH_REQUIRED` gets one
  refresh and retry, then "Connect to Scouty again". Expired (410), stale (409), origin refused
  (403), unsupported media type (415) and a finalized capture refusing a different manifest (409)
  end in "Something went wrong" with the outbox cleared. Each mapping is tested in
  `test/contract/server-decisions.test.ts`.

## Open points for the owner

- Run E0 (live LinkedIn) and replace the best-guess selectors.
- Decide the licence; confirm whether the Scouty mark may replace the letter tile.
- Rebuild on Node 24 on a clean machine and record the hashes in BUILD.md.
- CI now runs `npm run smoke:firefox` (Firefox installed by `browser-actions/setup-firefox`, under
  `xvfb-run`); it has not yet been seen to pass on GitHub. Run the manual steps of
  `validation/FIREFOX-SMOKE.md` and of `validation/EDGE-SMOKE.md`.
