# Firefox smoke check

Firefox gets two checks for every release (release gate 8): an automated start-up check that CI
runs on every push, and this manual walk-through, because Playwright cannot drive an extension in
Firefox. About twenty minutes.

## Part A: automated start-up check

CI (`.github/workflows/ci.yml`, step "Firefox start-up smoke") installs Firefox with
`browser-actions/setup-firefox` and runs `xvfb-run npm run smoke:firefox`. The script
(`tools/smoke-firefox.mjs`) starts Firefox headless with `dist/firefox` installed as a temporary
add-on and passes when the add-on is installed and no manifest or background error appears within
the time limit.

To run it by hand:

1. `nvm use && npm ci && npm run build`.
2. `npm run smoke:firefox` (Linux without a display: `xvfb-run npm run smoke:firefox`). If Firefox
   is not in a usual place, set `FIREFOX_BIN` to its binary.
   Expected: `smoke:firefox passed: the add-on was installed and the background page reported no
   error.` and exit code 0. Exit code 2 means Firefox or the build was not found (the check did not
   run); exit code 1 means it ran and failed.

Record: the CI run link (or the local output), Firefox version, commit.

`npm run lint:firefox` (web-ext lint) must report 0 errors. Its known warnings are accepted
(DEVIATIONS 15 and 27): two `UNSAFE_VAR_ASSIGNMENT` inside React's own code in `popup.js`, and
`KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` (`data_collection_permissions` needs Firefox for
Android 142). The add-on is desktop-only by plan, with no `gecko_android` key, so that warning is
expected and Android support is not added for it.

## Part B: manual walk-through

Use a Firefox profile with no other add-ons. Use only your own LinkedIn profile or one whose owner
agreed, referred to by its label (P1); record no name, URL, text or screenshot of LinkedIn content.

1. `nvm use && npm ci && npm run build:dev` (against a local app, set up as in
   `validation/VALIDATION.md`, Local setup) or `npm run build` (against Scouty).
2. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → choose
   `dist/firefox/manifest.json`.
   Expected: "Scouty B2B Prospector - Lead Research & Outreach" (the Firefox name, 50 characters at most for addons.mozilla.org) is listed with no error and no warning banner. Note the
   Internal UUID.
3. On its entry press **Inspect**, open the Console.
   Expected: no error.
4. Open `about:addons` → the extension → **Permissions**.
   Expected: optional access to `www.linkedin.com` (profile pages) and the Scouty origin only;
   no "access your data for all websites", no history, tabs or cookies permission. Leave the
   switches off. (`scripting`, `storage`, `identity` and `alarms` are not listed: Firefox shows no
   prompt for them.)
5. Click the toolbar icon (pin it from the extensions menu first if needed).
   Expected: "Allow access" with **Allow** and "What Scouty reads".
6. Press **Allow** and accept the Firefox permission prompt.
   Expected: the prompt lists LinkedIn and Scouty only; after accepting, the popup shows "Get
   started with Scouty" with **Sign in** and **Create account** (reopen the popup if Firefox closed
   it for the prompt; note whether it did).
7. Development build only: open the collapsed **Developer** disclosure under the popup's first
   screen and copy the "Redirect URL" line. Make sure the app's
   `scouty-ext-firefox` entry of `SCOUTY_EXTENSION_CLIENTS` has that redirect URL and
   `"origin":"moz-extension"`, and restart the app. The add-on id is `prospector@scouty.to`
   (`manifest.firefox.json`, permanent once published); Firefox derives the redirect from it, so it
   is expected to be `https://99f3ffe746980f1238823f6d099893a1b35df764.extensions.allizom.org/`
   (the SHA-1 of the id, docs/BROWSER-FACTS.md). An entry made for the earlier id
   `linkedin-capture@scouty.to` (`https://1460999172d43ef9d38bb8711f3226dbe730ff04.extensions.allizom.org/`)
   no longer matches and must be replaced.
8. Press **Sign in**.
   Expected: a window opens on Scouty's consent page; after approving, the popup shows "Open a
   LinkedIn profile", with the workspace name in its header. Record whether the window was
   already signed in to Scouty.
9. Open P1 on LinkedIn, click the icon, read the first-run notice, press **Got it, capture**.
   Expected: a small Scouty panel at the bottom-left of the page with a progress bar and **Stop**;
   the tab visits six pages; the panel ends with "Done" and the counts (or "Partly done", with one
   line on what is missing).
10. Press **Open in Scouty**.
    Expected: the app opens on that profile, with the same counts as the popup.
11. Optional, needs a second browser (for example Chrome with the extension connected to the same
    Scouty account): in Firefox press **Capture again** on P1 and, while it is still reading,
    start a capture of P1 in the other browser.
    Expected: the other browser's capture runs; Firefox shows "This capture stopped" with **OK**
    and **Capture here**, and nothing more from the Firefox run reaches the app.
12. Security check during a capture. LinkedIn cannot be made to send a security check on demand,
    so the redirect target is opened by hand: on P1 press **Capture again** and, while the panel
    says it is reading (after the first section), type `https://www.linkedin.com/checkpoint/challenge/`
    in the capture tab's address bar and press Enter. Also record it whenever LinkedIn itself sends
    the tab to a security check during any Firefox capture.
    Expected: the panel and the popup show "This site wants to check it's you" (the verification
    screen) and the sections read before it are kept (Open in Scouty shows them).
    Accepted fallback: Firefox may not show the extension the new address (the host permission
    covers only the profile pages `/in/…`, so `tab.url` can be missing after the redirect). Then the
    screen is "The page changed" / "Open the profile again and press Capture." (left the page),
    still with the earlier sections kept and nothing read from the check page. Any other screen,
    a capture that keeps running, or text from the check page in Scouty fails the step. Record
    which of the two screens appeared.
13. Popup → settings (gear) → **Disconnect**, then click the icon again.
    Expected: "Get started with Scouty" with **Sign in**. In Scouty, Settings → Connected Apps no longer lists an active
    "Scouty B2B Prospector (Firefox)" connection.
14. Back in `about:debugging`, check the extension's Console once more.
    Expected: no error was logged during the run.

## Recording and sign-off

Record in the release pull request's checklist, row 8 of `RELEASE.md` (and, for real-LinkedIn
runs, the Firefox rows of `validation/RESULTS-<version>.md`):

- Firefox version and OS, extension version, commit.
- Part A: CI run link or local output.
- Part B: pass, or the step number that failed and what was seen instead.
- Tester's initials and date.

The tester runs the check; the owner signs off row 8 of the release checklist with initials and
date. A failed step blocks the Firefox store upload until it is fixed and the check is repeated.
