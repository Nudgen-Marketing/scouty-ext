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
   outbox is cleared unless a capture is in flight, and always on Disconnect. Since 2026-11-26 (24)
   only the token endpoint's refusal (400, such as `invalid_grant`, or 401) counts as a failed
   refresh; a refresh that got no answer keeps the tokens.
8. **Uploads do not block reading.** If the Scouty API is unreachable while LinkedIn is still
   readable, the remaining sections are read and everything is sent when the connection returns
   ("You're offline", **Try now**, after a network failure; "Scouty isn't answering right now",
   **Try now**, when Scouty answered but could not take it). A section is never dropped for it.
   Since 2026-11-26 (24) "You're offline" is also tried again without **Try now**: whenever the
   popup or the overlay asks for the state and 15 s (`OFFLINE_RETRY_MS`) have passed since the last
   try, as the server-error state already was (that one also has its own timer; offline has none).
   Since round 2 (25) the overlay asks again by itself every 15 s while it shows "You're offline",
   and the background tries again at once on the browser's `online` event (without waiting out the
   15 s; a wait Scouty asked for is still kept). The `online` event reaches only an awake service
   worker or event page; a stopped one is covered by the overlay's asks and by a restart (`recover`).
   Since round 3 (26) both waits also set an alarm (`alarms` permission, no install warning;
   `src/background/wake.ts`) for the end of the wait: the alarm starts a stopped service worker or
   event page, which tries again, so a 60 s `Retry-After` or a closed capture tab no longer leaves
   the capture waiting until its 20 minutes run out. Chromium fires an alarm no sooner than 30 s
   after it is set (Chrome 120 and later; 1 minute on Chrome 116-119, which `minimum_chrome_version`
   116 still allows), so the in-memory timer still covers a shorter server wait while the background
   is awake. The alarm is cleared when the wait ends (sent, failed, expired, reset). The overlay
   also asks again every 15 s while it shows "Scouty isn't answering" during sending.
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
    `data_collection_permissions` needs Firefox for Android 142
    (`KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`). **Accepted:** the add-on is desktop-only by
    plan ("no `gecko_android`"); web-ext reads Android's minimum from `strict_min_version` because no
    `gecko_android` key narrows it, and adding one would declare Android support the add-on does not
    have (deviation 27).

16. **Host permission scope in Chromium.** The plan relies on the `/in/*` host pattern to keep the
    extension off LinkedIn's sign-in and checkpoint pages. Chromium ignores the path and grants the
    whole `www.linkedin.com` host. The manifest still declares the narrowest pattern (the stores
    show it and Firefox may honour it), and the restriction to `/in/<slug>/` pages is enforced in
    code: `profileFromUrl` in the background before every injection, and the slug check in the
    reader. A LinkedIn page outside `/in/` stops the capture with `left_linkedin`, except a sign-in
   or checkpoint address, which stops it with `logged_out` or `checkpoint` (since 24).

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
      the item: `/feed/update/<urn>/`, `/analytics/post-summary/<urn>/` or, since deviation 23,
      the Boost link's `content=` parameter, activity first. The exact time comes from the URN's
      id (any of the three kinds, deviation 23); the date label stays in the text.
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
    - **Protocol v1 carried activity URNs only** until deviation 23, which also sends share and
      ugcPost URNs. On the comments and reactions pages most items carry no post link at all.
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
    gone; the trust message is shown once, while reading ("Reading posts…" / "Scouty never posts
    or messages for you.", worded so since §25), with a bar, "23 of 50" and the time left, and no list of steps. A
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
    what changed is the tab. The reused tab is navigated to that whole address, query included (the
    app's campaign pages carry `?linkedin=<key>&person=<id>`). `src/background/app-tab.ts` picks, in order: (a) the tab that opened
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
    permission, the LinkedIn tab never navigated, a campaign page shown in the reused tab with its
    full query) and in `e2e/capture.spec.ts` (the happy path goes
    back to the app tab that opened LinkedIn, past another app tab on the same page; "recently
    captured" reuses an app tab on the target page). Firefox behaviour is **not verified** in a
    browser here (no Firefox on the build machine); MDN documents the same rules.
21. **Profile page fixes from the staging e2e (2026-11-24).** Four faults, each seen on a live
    profile and each reproduced by a test first:
    - **Start page.** A capture started from an activity or detail page read the profile section on
      that page, failed the address check and declared the profile `unavailable`. The first page is
      now opened when the tab is not on it (`readCurrent` in `src/background/session.ts`; test
      "started from another page of the profile" in `test/unit/session.test.ts`).
    - **Top card.** Live LinkedIn wraps every profile card (top card, About, Featured, Activity) in
      one outer section, so "the section around the Topcard marker" held them all and About was never
      read. `topCard` now returns the marker when it holds the name heading, and a section only when
      it holds no other card; section picking keeps the innermost labelled section.
    - **Headline.** The name heading sits inside the profile link, which is never read as text, so
      the headline (the line after the name) was never found. With the name not among the read
      lines, the headline is the first line that is not the degree or pronoun line.
    - **Late top card.** After a navigation the screen name is set before the top card is drawn; the
      reader now waits for it (bounded, 20 × 400 ms) and reads on without a name if it never comes.
    The nesting is in `fixtures/synthetic/sdui-profile-nested.html`, modelled on the live survey;
    tests in `test/unit/profile.test.ts` and `test/unit/reader.test.ts`. Verified on staging: a
    capture started from the activity page now carries the name, the headline and About.
    - **Connection ended wording.** After a revoke, reconnecting saves what was read and does not
      read on (by design: a revoke withdraws consent). "Do it in the next few minutes to finish this
      capture." read as a promise to finish reading; it is now "… to save what was already read.",
      and the partial result says "The connection ended, so some parts are missing." (tested in
      `test/ui/states.test.tsx` and the revoke run of `e2e/capture.spec.ts`).
    - **S6 automated.** The takeover (the same user starts the same profile in a second Chrome
      profile while the first reads) is now an e2e run with two persistent contexts on one stub
      (`rig.secondProfile()` in `e2e/harness.ts`): the first shows "This capture stopped" and stops
      reading, the second finishes, one finalized capture. It fails when the stub opens a second
      capture instead of handing the open one over.

### 22. Signed out: create an account or sign in (2026-11-25)

The signed-out popup was "Connect to Scouty" with one **Connect** button, which assumed an existing
Scouty account. It is now "Get started with Scouty" with **Sign in** (primary) and
**Create account**. Both run the same PKCE flow; **Create account** adds `prompt=create` (OpenID
Connect Initiating User Registration), so the app shows its sign-up page to someone signed out and
then returns to consent. "Connect to Scouty again" (connection ended) is unchanged. Tested in
`test/unit/auth.test.ts`, `test/ui/states.test.tsx` and `e2e/capture.spec.ts` (the stub records
the `prompt` of each authorization request).

### 23. Post ids: share and ugcPost URNs, and the Boost link (2026-11-26)

R2 (at least 90% of posts-page blocks with a URN) failed on both staging captures (63% and 40%).
Looked at live in the owner's Chrome on 2026-11-26 (structure and counts only): many posts link
only to `/feed/update/urn:li:share:<id>/` or `urn:li:ugcPost:<id>`, which the reader sent as
`urn: null`, and on the owner's own posts some ids appear only in the Boost link
(`/campaignmanager/boost/…?content=urn:li:share:<id>`). The reader now sends all three kinds
(activity still preferred), reads the Boost link's `content` parameter, and takes the post time
from any of them (the id's high bits are the time for all three, checked live against the date
labels). `SELECTORS_VERSION` is 3. The app's `POST_URN` (`src/lib/linkedin/deep-links.ts`) accepts
the same kinds and builds `/feed/update/<urn>/` for each; older extensions are unaffected.

Result on the same live pages: the owner's posts page 18 of 20 items with an id, a link and a time
(was 12); a second test profile 13 of 20 (was 8). The 7 items still without one on that profile
(image posts) carry no post link or id attribute anywhere in the page; the id is likely reachable
only from the post's menu, which the reader may not open. R2 can therefore stay below 90% on such
profiles: an owner decision (keep R2 as is, or measure it on the items that expose a link).
Tested in `test/unit/urn.test.ts`, `test/unit/blocks.test.ts`, `e2e/capture.spec.ts`, and the app's
`deep-links.test.ts` and `normalize.test.ts`.

### 24. Review fixes, 2026-11-26

- **Reload mid-capture.** A load of the page being read that the extension did not start (the user
  reloads) replaced the reader, and the capture sat until its 20 minutes ran out. `tabLoaded` now
  asks the tab whether a reader still works in its document (`readerAlive`, a one-line
  `scripting.executeScript` that reads the reader's busy flag in its isolated world) and, if not,
  reads the section again with a new `seq` (a late result of the old reader is ignored). A
  watchdog (`READER_WATCHDOG_MS`, 15 s) checks a reader it has not heard from: one still there is
  left alone, one that is gone is started again once, and a second silence on the same page ends
  the capture as partial (`timeout`). Tests: `test/unit/session.test.ts` ("a reader that is
  gone"), e2e "reloading the page mid-capture".
- **Wrong person.** The reader checked the slug only when it started; an in-page navigation to
  another profile mid-read would have been sent as the first one. The slug is now checked on every
  step and once more before anything is built (`wrong_profile`, or `left_linkedin` off the profile
  pages). Tests: `test/unit/reader.test.ts`.
- **Offline refresh.** A token refresh that got no answer, or that is not sent because
  `navigator.onLine` is false, keeps the tokens and fails as a `NetworkError` ("You're offline");
  a 5xx from the token endpoint keeps them too. Only a 400 (`invalid_grant`) or 401 from the token
  endpoint clears them (deviation 7). If the lost request did reach Scouty, the next refresh is
  answered `invalid_grant` and ends the connection then. Tests: `test/unit/auth.test.ts`.
- **Left the page.** A tab that left the profile pages without a sign-in or checkpoint address
  (another site, an address the extension cannot see, another page of the site) no longer says
  "Sign in to this site": it is the same screen 12 with neutral copy, "The page changed" / "Open the
  profile again and press Capture." (`left: true`; no new screen, the gallery keeps 27). A sign-in
  or checkpoint address the background can see keeps its own stop (`logged_out`, `checkpoint`).
  Tests: `test/unit/session.test.ts`, `test/ui/states.test.tsx`.
- **Firefox add-on id** is `prospector@scouty.to` (was `linkedin-capture@scouty.to`): permanent once
  published, so it must not name the site. The Firefox OAuth redirect URL derives from the id, so
  the app's `scouty-ext-firefox` client entry must be updated (validation/FIREFOX-SMOKE.md, BUILD.md).
- **PRIVACY.md and README** no longer say nothing runs in the background: nothing is read there, and
  the only background work is finishing sending a capture the user started.
- **Offline retry** on the popup or overlay asking (deviation 8).

### 25. Review fixes, round 2 (2026-11-26)

- **Paced "… more" presses.** `expandWithin` pressed every rendered expand control in one
  synchronous loop, off-screen ones too. It now presses at most one per call, the first that is
  visible and near the viewport (`domReach`: in it, or within one viewport height above or below);
  the scroll loop (`runScrollLoop`) calls it up to `PACING.maxClicksPerStep` (3) times per scroll
  step, `clickGapMs` (300 to 900 ms, from the same injected randomness as the scroll pauses) apart.
  A control further down is pressed on a later step; one scrolled far past is not come back to (its
  item stays `truncated`). On activity pages only the items that will be kept (the first `cap`) are
  expanded, and at the cap the loop goes on scrolling only while those still have controls ahead,
  for no longer than its idle steps, step limit or time budget allow (that still ends as "cap").
  Budgets are unchanged (activity 40 steps / 90 s, profile 15 / 45 s); the gaps count against them.
  Tests: `test/unit/pacing.test.ts`, `test/unit/blocks.test.ts` ("expandWithin"),
  `test/unit/visible-text.test.ts` ("domReach"); the e2e runs still read the expanded text.
- **Reader after an extension reload or update.** The reader's `send` swallowed "Extension context
  invalidated", retried and answered null, and the loop went on scrolling and pressing. The overlay's
  test (`cutOff`: that message and no `runtime.id`) is now shared in `src/ext.ts`; the reader's
  channel (`readerChannel`) stops trying on it, and the loop checks it (`cutOff` in `LoopOptions`)
  before every scroll and every press: it ends as `cut_off`, nothing is built and nothing is sent.
  Tests: `test/unit/reader.test.ts`, `test/unit/pacing.test.ts`.
- **STORE-LISTING.md** reviewer note said the extension "never clicks"; it now says, as PRIVACY.md
  and README do, that it presses only inline "see more" and "show more results" controls and never
  posts, likes, comments, connects or messages. The popup and overlay copy now say the same: the
  consent point "It only opens "see more" on posts. It never likes, comments, connects, messages or
  posts for you." and the reading line "Scouty never posts or messages for you." (legal pack T1).
- **Store link.** A 426's `storeUrl` was opened if it was any https address. Only https pages of
  `chromewebstore.google.com`, `chrome.google.com`, `microsoftedge.microsoft.com` and
  `addons.mozilla.org` (default port, no credentials), or of the configured API origin, are kept
  (`src/background/store-url.ts`), when parsed and again before opening. Tests:
  `test/unit/store-url.test.ts`.
- **Offline retry** without asking: deviation 8. Tests: `test/unit/session.test.ts` ("online event"),
  `test/unit/overlay-recheck.test.ts`.
- **Consent in the background.** Consent was enforced only by the screens. A Capture action now
  starts nothing without it (`startCapture` in `ui-state.ts`, used by the background's `capture`).
  Tests: `test/unit/ui-state.test.ts`.
- **Firefox security check.** validation/FIREFOX-SMOKE.md step 12 checks that a security check
  during a capture shows the verification screen in Firefox, and accepts "The page changed" when
  Firefox hides the redirect address (the host permission covers `/in/…` only).

### 26. Review fixes, round 3 (2026-11-26)

- **Retries survive a stopped background.** A server wait (`Retry-After` of 60 s on a 429) used a
  plain timer, lost when the service worker or event page stopped after about 30 s idle; the
  overlay asked again only for "You're offline", and a closed capture tab woke nothing, so a capture
  could wait until its 20 minutes ran out. Both waits now set the retry alarm (deviation 8), whose
  handler is `retryIfDue` (an alarm that fires before the wait is over is set again); the alarm is
  cleared when the wait ends. `alarms` is in `manifest.base.json`, `STORE-LISTING.md`'s permission
  justifications, PRIVACY.md "In detail", `test/static/manifest.test.ts`, EDGE-SMOKE step 3 and
  FIREFOX-SMOKE step 4 (RELEASE-0.1.0 row 9 notes that its Edge check predates it). The overlay's
  15 s recheck also runs while "Scouty isn't answering" waits to send (not in its create form,
  where nothing is kept). Tests: `test/unit/wake.test.ts`, `test/unit/session.test.ts` ("the
  retry alarm"), `test/unit/overlay-recheck.test.ts`.
- **Capture expiry on the browser's clock.** The outbox stored Scouty's `expiresAt` as is and
  compared it with the browser's clock, so a clock 30 minutes off ended a capture at once or kept
  it 30 minutes too long. It now keeps `now + (expiresAt - serverTime)` from the create answer
  (`localExpiresAt` in `src/background/outbox.ts`). A create answer whose `expiresAt` or
  `serverTime` cannot be read ends as "Scouty couldn't receive this capture", like any other answer
  the extension cannot use, with nothing kept. Tests: `test/unit/outbox.test.ts` (clock ±30 min,
  directly and through the controller; unreadable times).
- **Consent point 2** now names every press: "It only presses "see more" and "show more results" to
  read in full. It never likes, comments, connects, messages or posts for you." (it said only "see
  more" on posts; the reader also expands profile sections and the legacy "Show more results").
  `test/ui/states.test.tsx`, LEGAL-REVIEW-0.1.0 T1 quote; the gallery's 360 × 560 check still
  passes.
- **Packaging from a clean tree.** `tools/package.mjs` built the source archive from
  `git ls-files` and the zips from the working tree. In a git checkout it now refuses while
  `git status --porcelain` lists anything, unless `--allow-dirty` is given (BUILD.md). No test
  runs it, so `npm test` and `test:static` are unaffected in a dirty tree; the release workflow
  packages a fresh checkout.
- **Update mid-capture.** An extension update reloads the extension, which clears storage.session
  and with it a capture in progress, without a word. The background now listens to
  `runtime.onUpdateAvailable` (`src/background/update.ts`): the update waits while any capture is
  not idle (a finished capture's screen included) and is applied by `runtime.reload()` on the
  first idle state, at once if there is none, also after the background restarted (the flag is in
  storage.session). **Accepted:** Chromium still applies a waiting update when its service worker
  stops after about 30 s idle (for example during a long wait to send); that cannot be prevented,
  and the capture then ends as it did before. Firefox waits for the reload. Tests:
  `test/unit/update.test.ts`.
- **README status** points to deviation 23 and `validation/RESULTS-0.1.0.md` (live checks of post
  ids on 2026-11-26; the full E0 matrix with a tester is still open).
- **RELEASE-0.1.0 row 1** carries this working tree's test counts.

### 27. Review fixes, round 4 (2026-11-26)

- **The upload during reading is sent once.** `upload()` in `src/background/session.ts` called
  `putSection` with the client's full retry policy (up to 6 attempts of 25 s each plus backoff,
  `src/background/api.ts`), which held the reader queue for up to about 2.5 minutes with no alarm,
  while the browser could stop the background. `putSection` now takes `{ onRetry, maxAttempts }`
  (`Call.maxAttempts`, never above `RETRY.maxAttempts`); the in-read upload passes `maxAttempts: 1`.
  A transient failure defers the section to the outbox and finalize (as the comment always said),
  which retries with the alarm of deviation 26; finalize keeps the full policy. Tests:
  `test/unit/api.test.ts` ("putSection with maxAttempts 1"), `test/unit/session.test.ts` ("the
  upload during reading is sent once", a 503 and a dropped request).
- **The message gate is tested.** `handle()` and `OVERLAY_ACTIONS` moved unchanged from
  `src/background/index.ts` to `src/background/gate.ts` (`createGate`, given the controller, the
  capture tab, the overlay and popup states and `act`); `index.ts` wires it as before. Tests:
  `test/unit/gate.test.ts` (a foreign `sender.id`; an overlay message or action from a tab that is
  not the capture tab; overlay actions outside `OVERLAY_ACTIONS` such as `disconnect` and
  `acceptConsent`; `reader:*` from the popup; the popup's `ui:getState` answered).
- **Firefox name within AMO's 50 characters.** addons.mozilla.org limits a name to 50 characters
  (addons-server `Addon.name = TranslatedField(max_length=50)`); `extName`, "Scouty B2B Prospector -
  Lead Research & Outreach Coach", is 54. Chrome and Edge keep it (limit 75). The Firefox build is
  named "Scouty B2B Prospector - Lead Research & Outreach" (48) through a locale message
  `extNameFirefox` that `manifest.firefox.json` names. `test/static/manifest.test.ts` resolves each
  target's name and checks it against its store's limit (75, 75, 50) and that it names no network.
  STORE-LISTING.md (Firefox name row), FIREFOX-SMOKE step 2 and LEGAL-REVIEW §1 say so.
- **Updates also wait for sign-in, and a done screen holds them for 30 minutes only.**
  `holdsUpdate` (`src/background/update.ts`) now holds while `connecting` (a reload would cancel the
  browser's sign-in window); `index.ts` passes it, and the state broadcast at the end of sign-in
  checks again. The done phase held an update for as long as the screen stayed open, and Firefox
  applies an update only when told; it now holds for `DONE_HOLD_MS` (30 minutes) from when the done
  screen was first seen (`update.doneSince` in storage.session, so a restarted background keeps the
  count), with a timer to look again while the background is awake, otherwise at the next event
  that starts it. Tests: `test/unit/update.test.ts`.
- **Firefox for Android lint warning accepted.** `web-ext lint` warns
  `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`: `data_collection_permissions` needs Firefox for
  Android 142 and the minimum is 140. The add-on is desktop-only by plan ("no `gecko_android`"), so
  no Android support is added and the warning stays (deviation 15, FIREFOX-SMOKE Part A).
- **Alarm minimum.** `src/background/wake.ts` and `session.ts` said Chromium fires an alarm no
  sooner than 30 s; that holds from Chrome 120, and `minimum_chrome_version` 116 allows Chrome
  116–119, where it is 1 minute. Comments and deviation 8 corrected; behaviour unchanged (the
  in-memory timer covers shorter waits while awake, and an early alarm is set again).
- **Summary wording.** `extDescription` said "Only reads; never acts for you" while the extension
  presses "see more" and "show more results". It now reads "Research B2B leads you choose on social
  networks and get a step-by-step outreach plan in Scouty. Never posts or messages for you." (129;
  the suggested "Research the B2B leads…" is 133, over the 132 limit, so "the" was dropped).
  `test/static/manifest.test.ts`, STORE-LISTING.md summary row, LEGAL-REVIEW T3.
- **Legal review pack brought up to date.** T7 is `/terms#scouty-b2b`; T8 names the network-neutral
  risk notice and trademark line; question 1 no longer says the texts name LinkedIn; question 8 asks
  about the neutral trademark line and store listings that name no network; the "where the site is
  named" statement matches the app plan (the manifest's host permission only; the reviewer fields
  say "the network"). RELEASE-0.1.0 row 10: ten questions, not nine.

### 28. Review fixes, round 5 (2026-11-26)

- **The overlay after a background restart.** The capture tab was kept in memory only
  (`src/background/index.ts`). An idle notice ("This capture timed out", "failed"…) has no tab id,
  so after the background restarted the gate refused that tab's overlay actions and its hello, and
  `broadcast` sent it nothing: the overlay kept a stale screen with dead buttons, and its recheck
  ignored the null answer. The capture tab is now kept in storage.session
  (`src/background/capture-tab.ts`, key `capture.overlayTab`, written only when it changes; cleared
  with the session, when a tab id means nothing any more). `broadcast` and the gate read it there;
  `overlay:hello` is answered for the capture's own tab or that kept tab, as `ui:action` already
  was. The overlay's entry is `startOverlay()` (`src/overlay/overlay.ts`): an answer of null to
  overlay:hello, the first ask or a recheck, removes the overlay; a failed ask (no answer at all)
  leaves the screen. Tests: `test/unit/gate.test.ts` ("after the background restarted while an
  idle notice was shown"), `test/unit/overlay-start.test.ts`.
- **The alarm while an outbox exists.** Nothing woke a background stopped mid-finalize (the full
  retry policy, no alarm) or while waiting for sign-in (`blocked: "auth"`, no alarm), so the
  20-minute deletion PRIVACY.md promises depended on an unrelated event. `CaptureController.syncWake`
  now keeps the `scouty.retry` alarm (`src/background/wake.ts`) while an outbox exists, at the
  earlier of the outbox's `expiresAt` and the next try: a server or offline wait's `retryAt`, or
  `SENDING_WAKE_MS` (60 s) ahead while sending; no outbox, no alarm. It runs on every state change
  that moves that time (`wakeKey`) and on `recover`. The alarm's handler is `alarmFired()`: it sets
  the alarm again at once, outside the queue (a send in flight holds the queue), then ends a capture
  whose time ran out ("This capture timed out", outbox deleted), deletes an expired outbox left
  without a capture, or tries a due wait again (`retryIfDue`). A background stopped mid-finalize is
  started by the alarm, and its `recover` picks the send up. Tests: `test/unit/session.test.ts`,
  "the retry alarm" (the alarm at the expiry while reading and while waiting for sign-in; a
  restarted controller blocked on sign-in deletes the outbox when the alarm fires at the expiry; an
  orphaned expired outbox; a finalize that hangs keeps the alarm 60 s ahead, is set again when it
  fires early, and a restarted controller woken by it finishes).
- **Texts that contradicted the behaviour.** PRIVACY.md said "It only reads" and "has no
  background activity", while the extension presses "see more" and "show more results", holds the
  `alarms` permission and finishes sending in the background (its own "When" row); STORE-LISTING.md's
  description also said "It only reads" (dropped from the summary in deviation 27). Both now say it
  reads only the pages of the person you capture, presses only "see more" and "show more results" to
  read in full, never posts, likes, comments, connects or messages, and that the only background
  work is finishing sending a capture you started. No network is named ("published texts name no
  social network" passes). LEGAL-REVIEW quotes none of these lines. Afterwards the app's `/scouty-b2b` page ("It reads, you
  act"; FAQ and description: "never posts or messages for you") and the popup's permission line
  ("Scouty only opens the profiles you choose to capture.", LEGAL-REVIEW §2) were aligned too.
- **setAccessLevel claimed too much.** `hardenStorage` (`src/background/auth.ts`) said it kept
  extension storage away from injected scripts. Per browser-compat-data, Chromium accepts
  `setAccessLevel` on storage.session (already limited to trusted contexts by default) and on every
  area only from Chrome 140; on Chrome 116–139 the call on storage.local is refused, and Firefox
  implements neither. The comment, `docs/BROWSER-FACTS.md` and the test now say so (the test makes
  storage.local refuse and checks the session call is still made). **Accepted:** where the call is
  refused or missing, the refresh token in storage.local is readable from the extension's own
  content scripts. Those are our own code (the reader and the overlay contain no storage call), and
  no script of the page can reach extension storage. Token storage is unchanged.
- **Load-more near the viewport.** `loadMore` (`src/reader/interactions.ts`) pressed the last
  allowed "show more results" control wherever it was. It now takes the same `reach` rule as the
  "… more" presses (deviation 25): pressed only when `domReach` says near (in the viewport or within
  one viewport height of it); `readSection` passes its `reach`. Tests:
  `test/unit/interactions.test.ts` (an injected reach; `domReach` with placed rects),
  `test/unit/reader.test.ts` (a far control is not pressed through `readSection`).
- **RELEASE-0.1.0 row 1** carries this working tree's test counts.

- **Test harness race (not the product).** The e2e helper `connect` looked for the popup's Sign in
  button once, before the popup had drawn, then waited forever for "Connect": the rare 4-minute
  timeout of "extension below the minimum version", earlier put down to machine load. It now waits
  for either button (`e2e/harness.ts`); 40 of 40 repeats pass, against 39 of 40 before.
- **A navigation could be taken for the old page.** Right after `tabs.update` a browser may still
  report the previous page as complete; `waitForLoad` took it for where LinkedIn sent the tab and
  declared the section missing. It now ignores a "complete" that still shows the previous address,
  before any "loading", for up to about 3 s of reads (`src/background/session.ts`; tested in
  `test/unit/session.test.ts` with a fake that keeps the old page for three reads).
- **CI fails on flaky tests** (`failOnFlakyTests` in `e2e/playwright.config.ts`): the retry stays for
  slow runners, but a test that passes only on retry fails the job.

### 29. Review fixes, round 8 (2026-11-26)

- **Sign-out during a refresh.** `signOut` ran outside the refresh lock: a refresh in flight when
  the user pressed Disconnect or switched workspace stored a new refresh token after the tokens were
  cleared, silently signing the extension in again (or keeping the old workspace's grant). The
  revoke and clear now run inside the same lock (`src/background/auth.ts`), so they wait for that
  refresh and revoke the token it stored. Test: `test/unit/auth.test.ts`, "a sign-out during a
  refresh in flight" (fails without the lock).
- **The 20-minute window is enforced here.** `localExpiresAt` took the server's window as given; a
  longer one would have kept read data in storage.session longer than PRIVACY.md promises. It is now
  cut to `HARD_LIMITS.outboxWindowMs` (20 minutes, `src/config.ts`). Test: `test/unit/outbox.test.ts`.
- **E2E "the stopped tab does not move".** The fixed 3-second wait is now a 3-second watch of the
  mock site's request log and the tab's URL (`e2e/capture.spec.ts`).
- **Disconnect while a sign-out runs (round 9).** A sign-out can now wait up to about 50 s (a refresh
  in flight, then the revoke, each bounded by the 25 s request timeout). A second press of Disconnect
  or Switch workspace meanwhile joins the running one (`disconnect()` in `src/background/index.ts`)
  instead of queuing another (`singleFlight`, `src/background/single-flight.ts`; unit test
  `test/unit/single-flight.test.ts` proves the join). No "Disconnecting…" screen was added: it would be a 28th state outside
  the reviewed gallery. E2E: "Disconnect pressed twice" checks the end state (one revoke, back to Get started); it would pass
  without the join too, since a second sign-out finds no token.

## Contract decisions (to reconcile with the app)

`protocol-v1/` is the app's directory, copied byte for byte. Where the plan left a shape open, the
extension follows the app's `src/lib/linkedin/protocol.ts`:

- Profile kinds send `blocks: []`; activity kinds send `profile: null`. `name` and `headline` are
  sent only in the `profile` section (null in `experience` and `skills`).
- The body sent is compact JSON in the builders' key order; the digest is over those exact bytes.
  Manifest `sha256` is lowercase hex; `Content-Digest` is `sha-256=:<base64>:`.
- `urn` is sent only as a whole `urn:li:activity|share|ugcPost:<digits>` (deviation 23; the app
  accepts the same three kinds and treats any other as absent); `urnTime` only as an ISO time
  between 2003 and now. Otherwise null.
- Lengths are clamped in Unicode code points, the unit the server counts (an emoji counts once);
  name ≤ 120 and headline ≤ 220 (the wire allows 300 and 500).
- `pageSlug` is the raw slug from the tab's address, not normalized.
- `Counts` is `{ profileSections, posts, comments, reactions }`.
- One `Idempotency-Key` (a UUID) per create; one per distinct manifest for finalize.
- "Open in Scouty" opens the page the server names: after finalize its `appUrl`, and after a
  recent capture the `{ recent }` answer's optional `recent.appUrl` (added by the app on
  2026-11-24, for the campaign round trip; the protocol-v1 fixtures predate it and are unchanged).
  Either is used only if it is on the Scouty origin (`appUrl` and `recentAppUrl` in
  `src/background/app-tab.ts`). Without `recent.appUrl` (an older server) the extension falls back
  to `<origin>/dashboard?linkedin=<profileKey>`. The page may be the dashboard or a campaign,
  `<origin>/dashboard/<projectId>/campaigns/<campaignId>?linkedin=<key>&person=<personId>`; the
  extension opens it as named, query included (`test/contract/contract.test.ts`,
  `test/unit/app-tab.test.ts`, `test/unit/session.test.ts`, the e2e happy path and "recently
  captured").
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
  `src/background/session.ts`), by an in-memory timer and by the retry alarm, which also wakes a
  stopped background context (deviation 8, round 3). It is also picked up on the background's
  next start (`recover`) and whenever the popup or the overlay asks for the state. Like 25, this screen is not in plan 12.4 and is
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
  action is shown disabled and the screen says "Open a lead's profile in this tab first." (originally "Open a LinkedIn profile…", reworded in deviation 22)
  (wording of deviation 19); the popup re-checks the tab every 1.5 s, so the action turns on once the
  profile is open. Other actions on the screen stay usable (`onProfile` in `src/ui/state.ts`,
  `targetIsProfile` in `src/background/ui-state.ts`; tested in `test/ui/states.test.tsx`,
  `test/unit/ui-state.test.ts` and the gallery's "off a profile" frames).

- **Overlay after an update.** Once the extension is reloaded or updated, an overlay script already in
  the page is cut off and `runtime.sendMessage` throws at once ("Extension context invalidated"),
  which Chrome listed as an uncaught error (seen on staging). The overlay now treats that as "cut off"
  and removes itself, and a new overlay first removes any left by an earlier copy, so a page never
  shows two (`src/overlay/overlay.ts`; tested in `test/ui/states.test.tsx`).

## Open points for the owner

- Run E0 (live LinkedIn) again with selectors version 3 (deviations 17, 23) and record the click log.
- Decide the licence.
- Rebuild on Node 24 on a clean machine and record the hashes in BUILD.md.
- CI now runs `npm run smoke:firefox` (Firefox installed by `browser-actions/setup-firefox`, under
  `xvfb-run`); it has not yet been seen to pass on GitHub. Run the manual steps of
  `validation/FIREFOX-SMOKE.md` and of `validation/EDGE-SMOKE.md`.

### 30. Full-coverage review fixes (2026-11-26)

- **A saved capture shown as "This capture timed out".** `finalize` and `fail` cleared the outbox
  before moving the state on, and `current()` (the popup polls it outside the queue) ends a capture
  with no outbox as timed out: a poll in between turned a saved capture, or a real notice, into
  "timed out". The state now moves first and the outbox is cleared after, then the alarm is set
  again (no outbox, no alarm); an outbox left by a stop in between is deleted by the alarm. Test:
  `test/unit/session.test.ts`, "a state read right as the outbox is cleared…" (fails on the old order).
- **Two items of the lead on one post.** On the comments and reactions pages the URN is the post
  answered, and the reader kept the first item per URN, dropping a second comment (or the like of a
  comment) on the same post. Scouty keys activities by that URN too (`normalize.ts` `dedupeKey`), so
  the reader now keeps them together in the post's block (`readBlocks`, `src/reader/blocks.ts`),
  merged part by part (the post once, then each item's own lines), so a 3,000-character post never
  pushes a first comment into the cut middle; the same item read twice, or a cut and a full read,
  keeps the fuller text. An item's own lines are never compared with each other (a short comment or
  a date that also occurs in the post stays). A later item's line is compared only with kept lines
  of the same role (post box with post box, comment with comment, hint, date): equal text is kept once
  in its uncut form, and a full read replaces a cut one. "Cut" is per text box (its own unpressed
  "… more" or its own ellipsis), so a collapsed post never makes the lead's comment look cut.
  Roles follow each box's place in the item before empty boxes are left out, so an empty post box
  never moves a comment into the post's role. Known limit: a different text that starts with exactly
  the visible words of a cut one cannot be told apart from its full read on the page; it replaces it
  (the words read are kept). Marking every such replacement as cut would mark real full reads as cut,
  and a comment step on a cut post becomes a reaction. Items without a URN are
  grouped and counted by their text in both places. The cap now counts distinct
  posts, and only items of kept posts are expanded (`blockOrder`). Test: `test/unit/blocks.test.ts`.
- **Smaller:** a positive fractional cap is at least 1 (0 meant "no cap" to the scroll loop and
  "keep nothing" to the payload; an activity page reads at least 1); `recover` goes straight back to
  sending instead of showing "You're offline" first; the shown "about N minutes left" is kept while
  running (`noteMinutesLeft`), so the never-counts-up rule is live; notices use the controller's clock.
