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
    `auth` while waiting for a reconnect) and notices on `idle` for terminal errors. The `expired`
    event no longer returns to a bare `idle`: like `failed`, it lands on `idle` carrying a notice
    (`expired`, screen 27), so a capture that ran out of time never vanishes without a word.
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

17. **LinkedIn SDUI markup (2026-11-24).** The first live run stopped with "This profile can't be
    read": LinkedIn now serves profiles and activity pages with its server-driven UI, whose class
    names are generated and meaningless, and none of the best-guess selectors matched. Selectors
    version 2 (`src/reader/selectors.ts`, `SELECTORS_VERSION = 2`) uses no class at all:
    - **Page state.** "ok" only when `main#workspace` exists **and** an element's
      `data-sdui-screen` is the screen of the section being read (`…profile.Profile`,
      `…ProfileExperienceDetails`, `…ProfileSkillDetails`, `…ProfileRecentActivityAll`,
      `…ProfileRecentActivityComments`, `…ProfileRecentActivityReactions`). The addresses
      `/uas/login`, `/authwall`, `/login` (logged out) and `/checkpoint/` (checkpoint) stop the read
      before the slug check; the legacy sign-in, checkpoint, unavailable and reduced-profile markers
      still stop it. Everything else, the legacy signed-in markup included, is "unknown" (fail
      closed). `detectPageState` now takes the section.
    - **Activity pages.** A block is a `[role=listitem]` of the `[role=list][data-component-type=
      LazyColumn]` list in `main#workspace`. Its text is the header line that names what the lead
      did ("… reposted this", "… likes this", "… liked a comment on this", "… commented on this";
      English only), the relative date label from a "1w •" line ("1w", "2mo", …), then every
      `expandable-text-box` of the item in order (the post, then the lead's comment, kept by the
      head-and-tail clamp); an item with no text box is read as its visible text. Action controls
      (named by `aria-label` or text: reactions, Like, Comment, Repost, Send, control menu,
      Follow, document paging) and "Feed post" are never read. The URN comes from a link inside
      the item: `/feed/update/<urn>/` or `/analytics/post-summary/<urn>/`, activity first. The
      exact time still comes only from an activity URN; the date label stays in the text.
      Infinite scroll: while `[data-testid=loader]` shows, a step waits up to three more pauses
      (within the section's time budget) before it counts as idle.
    - **Expand.** The only expand control is `button[data-testid=expandable-text-button]` inside an
      `expandable-text-box` inside an activity item, a detail page root, or a profile section whose
      h2 is one of the profile's own sections, within `main#workspace`. LinkedIn marks it
      `aria-hidden="true"`: the allow-list refuses every aria-hidden or inert control except this
      one, and only when no ancestor is aria-hidden. A text box that holds any other control
      disqualifies its "… more" too. Every other rule stays (button, not submit, no link, form,
      menu, tab list, dialog, toolbar, header or nav around it, no `aria-pressed` /
      `aria-haspopup`, no action attribute or action name, the deny words, now also "menu",
      "page", "navigate", "add a", "ad options"; nothing clicked unless `<html lang>` is en or vi).
    - **Profile.** Name and headline come from the top card (the element whose id starts with
      `com.linkedin.sdui.profile.card.` and ends with `Topcard`): its heading, then the first line
      after it (a pronoun line is passed over; links such as Contact info are never read). Only
      sections whose h2 is on an allow-list are read (About, Experience, Education, Skills,
      Licenses & certifications, Languages, Recommendations, Featured, Volunteering, Projects,
      Honors & awards, Courses, and Giới thiệu, Kinh nghiệm, Học vấn, Kỹ năng, Giấy phép & chứng
      chỉ, Ngôn ngữ, Dự án, Khóa học); owner-only, recommendation and ad sections, the Activity
      teaser, a section without an h2 and the contact section are skipped. Detail pages: the
      entries under `[data-testid^=profile_ExperienceDetailsSection_]` /
      `[data-testid^=profile_SkillDetails_]`, each entry's paragraphs and text boxes as lines,
      entries separated by a blank line, as one section labelled Experience or Skills; a root
      that shows nothing is LinkedIn's empty page.
    - **Single alternatives.** Plan 6.6 asks for two or three alternatives per selector. The SDUI
      hooks have no meaningful fallbacks, so most selectors now have one; the legacy class
      selectors remain only where they can stop a read or never match (load-more, empty states).
    - **Protocol v1 carries activity URNs only.** A share or ugcPost URN is used to drop
      duplicates but is sent as `urn: null` (no permalink, no time); on the comments and reactions
      pages most items carry no post link at all.
    - **Sanitizer.** `tools/sanitize.mjs` also keeps `id="workspace"`, `data-sdui-screen` and
      `data-component-type` values, the `componentkey` name, the `expandable-text-*` and `loader`
      test ids, the detail-root test ids with the slug replaced by `x`, the top-card id as
      `com.linkedin.sdui.profile.card.xTopcard`, and post links with made-up URNs.
    - **Unverified:** how LinkedIn shows an empty activity list or empty detail page (read as
      "empty" when the list or root is there with nothing in it), the Vietnamese header-line and
      section wording beyond the labels above, and whether the screen names change across UI
      languages.
18. **The Scouty brand, as in the app (owner decision 2026-11-24).** The plan (12.1, open question
    12) kept the Scouty logo out of this public repository, so the extension used a letter tile.
    The owner decided the logo may be published. `src/ui/brand.ts` is a byte-for-byte copy of the
    app's `src/lib/brand-mark.ts` path data (`npm run brand`; a static test compares the two when
    the app is checked out next to this repository). The popup header shows the app's `Logo`
    (mark and outlined wordmark, `currentColor`, `role="img"`, named "Scouty") in place of the tile
    and the separate "Scouty" text; the overlay shows the mark (decorative) beside "Scouty"; the
    toolbar icons are the app's `src/app/icon.svg` rendered at 16, 32, 48 and 128 px by
    `npm run icons`. The static test still forbids font files and any other brand or image file.
19. **Minimal, plain UI; the development click log leaves the UI (owner feedback 2026-11-24).**
    After the first real run the owner found the overlay and popup too wordy and too technical
    (the finished overlay listed 54 "… more (expandText: …)" lines under "Development build:
    controls pressed on LinkedIn"). Every screen now has one short title, at most one short
    sentence and one clear primary action, with no technical words; this replaces the plan 12.4
    wording (the screens, their order, actions and roles are unchanged). Main changes: the
    overlay's fixed line ("Scouty is reading this page. It won't click or post anything.") is
    gone; the trust message is shown once, while reading ("Reading posts…" / "Scouty never clicks
    or posts for you."), with a bar, "23 of 50" and the time left, and no list of steps. A
    finished capture says "Done" with "Profile · 19 posts · 20 comments · 20 reactions",
    **Open in Scouty** and **Close** (no "Complete" pill); a partial one says "Partly done", what
    was read, and one line on what is missing, in place of a line per section. The ready screen no
    longer repeats the profile address and workspace (the header shows the workspace), "This
    profile has moved" no longer prints the new address, and the off-profile hint reads "Open a
    LinkedIn profile in this tab first." Renamed titles include 1 "Allow access", 2 "Connect to
    Scouty", 5 "Before you start", 22 "Something went wrong", 26 "Scouty isn't responding" and
    27 "This capture timed out"; the full list is `_locales/en/messages.json`, and
    `test/ui/states.test.tsx` holds the title and actions of all 27 screens and checks every
    body is a single sentence and free of jargon. Earlier entries in this file quote the old
    wording. The development click log (validation R4) is no longer drawn in any build:
    development builds print one line per finished capture to the background console and keep
    the last 10 captures in memory-only storage, readable in the popup under Settings →
    **Developer** (collapsed, with **Copy**), which also holds the OAuth redirect URL that the
    signed-out screen used to show. Store builds contain none of it (the `__SCOUTY_DEV__` build
    constant; `test/static` checks the store bundles and the catalog).

20. **Open in Scouty returns to the app tab (owner request 2026-11-24).** The plan opens every
    Scouty page in a new tab. The owner's flow starts in the app: a campaign's lead list opens a
    LinkedIn profile in a new tab, the user captures it, and **Open in Scouty** should take them
    back to the app, on that campaign and lead list, without piling up tabs. The page is still the
    `appUrl` the server returns (falling back to the extension's own Scouty addresses as before);
    what changed is the tab. `src/background/app-tab.ts` picks, in order: (a) the tab that opened
    the LinkedIn tab (`openerTabId`), if it still exists and is on the Scouty origin; (b) a Scouty
    tab whose path equals the target's (query ignored), in any window; (c) the most recently used
    (`lastAccessed`) Scouty tab in the LinkedIn tab's window, or the last focused window when no
    LinkedIn tab is known; (d) a new tab, as before. A reused tab gets `tabs.update(id, { url,
    active: true })` and its window `windows.update(id, { focused: true })`; the LinkedIn tab stays
    open and is never navigated. A tab is only navigated when its own address has exactly the
    Scouty origin (scheme, host and port); a tab on LinkedIn or any other site never is, and an
    address off the Scouty origin (the store page) always gets a new tab. This applies to **Open in
    Scouty** (`openAnalysis`) and **Open Scouty** (`openScouty`); the privacy page and the store
    page still open a new tab, so they never replace the user's place in the app. No permission was
    added (the exact-manifest tests are unchanged): it relies on the existing Scouty host
    permission, which makes `tab.url` visible for Scouty tabs only. If that permission is not
    granted (Firefox treats host permissions as optional; `permissions.contains` is checked first)
    no tab is read or reused and a new tab opens. Chromium ignores the `url` filter of
    `tabs.query` without a matching host permission, so the code never trusts the filter: it checks
    each tab's own `url`, which is absent without the permission (docs/BROWSER-FACTS.md). In the
    Chromium run, a profile opened from the app through a `target="_blank" rel="noopener"` link has
    the app tab as `openerTabId`, but Chromium records the opener as the tab that was active when
    the new one opened and can drop it later, so (b) and (c) are the fallbacks. Tested in
    `test/unit/app-tab.test.ts` (each choice, an opener on LinkedIn or another site, a missing
    permission, the LinkedIn tab never navigated) and in `e2e/capture.spec.ts` (the happy path goes
    back to the app tab that opened LinkedIn, past another app tab on the same page; "recently
    captured" reuses an app tab on the target page). Firefox behaviour is **not verified** in a
    browser here (no Firefox on the build machine); MDN documents the same rules.

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
  refresh and retry, then "Connect to Scouty again". Stale (409), origin refused
  (403), unsupported media type (415) and a finalized capture refusing a different manifest (409)
  end in "Scouty couldn't receive this capture" with the outbox cleared. Each mapping is tested in
  `test/contract/server-decisions.test.ts`.
- A capture has 20 minutes to be sent. When they run out, the capture ends in screen 27, "This
  capture ran out of time" (`expired`: **Capture**, which starts a new capture of the profile in
  the tab the popup is on, the same action as **Capture here** on 25, or **OK**), and its outbox is
  cleared; nothing is tried again. Two causes lead there: this browser's clock (checked lazily by
  every handler, on a restart and whenever the popup or the overlay asks for the state), and
  Scouty's clock, which answers `410 LINKEDIN_CAPTURE_EXPIRED` (or any 410) to the capture's
  owner on status, section `PUT` and finalize. A 410 on create is not expected and ends in
  "Scouty couldn't receive this capture". Before this screen, a local expiry returned to the
  start with no notice and a 410 showed screen 22. Like 25 and 26, it is not in plan 12.4 and is
  numbered after it (tested in `test/unit/session.test.ts`, `test/contract/server-decisions.test.ts`
  and `test/ui/states.test.tsx`).
- No dead Capture button. A Capture action starts in the tab the popup (or the overlay) is on, so
  it can only start there on a LinkedIn profile. On every screen with one (7 **Capture again**, 11
  **Capture again**, 12 **Capture again**, 15 **Capture this page**, 22 **Capture again**, 25
  **Capture here**, 26 at create **Try now**, 27 **Capture**), when that tab is not a profile the
  action is shown disabled and the screen says "Open a LinkedIn profile in this tab first."
  (wording of deviation 19); the popup re-checks the tab every 1.5 s, so the action turns on once the
  profile is open. Other actions on the screen stay usable (`onProfile` in `src/ui/state.ts`,
  `targetIsProfile` in `src/background/ui-state.ts`; tested in `test/ui/states.test.tsx`,
  `test/unit/ui-state.test.ts` and the gallery's "off a profile" frames).

## Open points for the owner

- Run E0 (live LinkedIn) again with selectors version 2 (deviation 17) and record the click log.
- Decide the licence.
- Rebuild on Node 24 on a clean machine and record the hashes in BUILD.md.
- CI now runs `npm run smoke:firefox` (Firefox installed by `browser-actions/setup-firefox`, under
  `xvfb-run`); it has not yet been seen to pass on GitHub. Run the manual steps of
  `validation/FIREFOX-SMOKE.md` and of `validation/EDGE-SMOKE.md`.
