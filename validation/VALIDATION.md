# Real-LinkedIn validation (owner task)

No LinkedIn session exists where this code was written, so this is the only place where the
selectors, the activity-page assumptions and the account-safety behaviour meet reality.
**Profiles are referred to only by anonymous labels (P1, P2, …); no name, URL, text or screenshot
of LinkedIn content is recorded.** Use only profiles whose owners agreed.

## Local setup

1. **Run the app locally** (`scouty` repository): Postgres and Redis running; `.env.local` with
   `LINKEDIN_COACH_ENABLED=true`, `OPENAI_API_KEY=…`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`.
   Start `yarn dev` and, in a second terminal, `yarn worker:knowledge`.
2. **Your local account must be an administrator** while the audience is internal.
3. **Build the extension:** `nvm use && npm ci && npm run build:dev`.
4. **Load it and note its id.**
   - Chrome: `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome`. Note the ID.
   - Edge: `edge://extensions` → Developer mode → Load unpacked → `dist/edge`. Note the ID.
   - Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on →
     `dist/firefox/manifest.json`. Open the popup: the development build shows a "Redirect URL" line.
5. **Tell the app about these builds.** In the app's `.env.local`, one line:
   `SCOUTY_EXTENSION_CLIENTS=[{"id":"scouty-ext-chrome","name":"Scouty LinkedIn Capture (Chrome)","browser":"chrome","redirectUri":"https://<chrome id>.chromiumapp.org/","origin":"chrome-extension://<chrome id>","storeUrl":"https://example.invalid"}, …]`
   with one entry each for `scouty-ext-edge` and `scouty-ext-firefox` (Firefox: the redirect URL
   from step 4 and `"origin":"moz-extension"`).
6. **Restart `yarn dev`.**
7. In the popup: Allow, then Connect to Scouty, sign in if asked, approve on the consent page.

To test against another host, put `SCOUTY_API_ORIGIN=<origin>` in the untracked `.env.local` of
this repository and rebuild with `npm run build:dev`. Never commit that file.

## Matrix

Each row in Chrome; rows marked * also in Edge and Firefox.

| Label | Profile | UI language | Account |
| --- | --- | --- | --- |
| P1* | The tester's own profile | English | Free |
| P2* | A 1st-degree connection, very active | English | Free |
| P3 | A 1st-degree connection, inactive | English | Free |
| P4 | A 2nd-degree connection | English | Free |
| P5* | An out-of-network profile | English | Free |
| P6* | A very active profile | Vietnamese | Free |
| P7 | Any consenting profile | One unsupported language (for example German) | Free |
| P8 | P2 again | English | Premium, if available |

## What to record for each run

1. Counts per section reported by the extension versus what is on the page after scrolling to the
   same depth (tolerance: within 2 items or 5%).
2. How many posts are flagged truncated; that expanding worked where the language is supported;
   for P7, that nothing was expanded and the summary says so.
3. Three sampled permalinks open the right post; three sampled dates match within a day.
4. **The development click log lists only "see more" and "show more results" controls.**
5. No LinkedIn warning, verification prompt or "unusual activity" notice during or within an hour
   after the capture.
6. The capture finalized as expected, and the app's summary matches.
7. The analysis and plan read sensibly.
8. For P1 and P2 in each browser: interrupting the network during upload resumes without
   re-reading LinkedIn; closing and reopening the browser mid-upload leaves nothing in the app and
   nothing in the extension.
9. Sign-in: does the `launchWebAuthFlow` window share the browser profile's existing Scouty
   sign-in? Does the popup stay usable after the permission prompt (Firefox)?

The first-run checklist that settles the open assumptions is in `fixtures/README.md`.
