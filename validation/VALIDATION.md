# Real-LinkedIn validation (owner task)

No LinkedIn session exists where this code was written, so this is the only place where the
selectors, the activity-page assumptions and the account-safety behaviour meet reality.
**Profiles are referred to only by anonymous labels (P1, P2, …); no name, URL, text or screenshot
of LinkedIn content is recorded.** Use only profiles whose owners agreed.

## Local setup

Follow the app plan's **§15.1 "O1 Local setup"** (`docs/plans/linkedin-outreach-coach.md` in the
`scouty` repository) step by step: local database and Redis, `.env.local`, the safety check, the
app and the worker, an administrator account, the extension build, the `SCOUTY_EXTENSION_CLIENTS`
entry per loaded browser, and Connect. Its "Expected" row says what a finished setup looks like.

> **Safety, before anything else**
>
> - **Never run the app or the worker against the database in the app's `.env`.** That file points
>   at a remote database (staging or production). The local `.env.local` must set a local
>   `DATABASE_URL` and `REDIS_URL`, as §15.1 step 2 lists.
> - **The safety check must print `localhost` before anything else is started.** Run it exactly
>   as §15.1 step 3 gives it (`node --env-file=.env --env-file=.env.local -e …`), before
>   `yarn dev` or the worker. Any other output: stop and fix `.env.local`.
> - **Start the worker only with the plan's command**, which loads both files:
>   `node --env-file=.env --env-file=.env.local --import tsx scripts/knowledge-worker.ts`.
>   `yarn worker:knowledge` loads no env file, so it would miss `.env.local` (including
>   `LINKEDIN_COACH_ENABLED=true`) and runs would never progress.

To test against another host, put `SCOUTY_API_ORIGIN=<origin>` in the untracked `.env.local` of
this repository and rebuild with `npm run build:dev`. Never commit that file.

## Matrix

Rows marked * (P1, P2, P5, P6) are mandatory: in Chrome for release gate M2, and in Edge and
Firefox before that browser's store submission (M4). The other rows are optional, in Chrome. The
app plan's §13.4 is the single home of this matrix.

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

The checks and their pass thresholds are defined in the app plan's **§13.4 (R1–R10)**; that table
is the single home and wins over this copy. A run passes only when every check meets its
threshold.

- [ ] **R1** Blocks per activity section versus items visible after scrolling to the same depth:
  within 2 items or 5%, whichever is larger.
- [ ] **R2** Posts-page blocks carrying a URN (active profiles P2, P6): ≥ 90%.
- [ ] **R3** 3 sampled permalinks open the right post; 3 sampled decoded dates match: 3/3 and 3/3
  (dates within 1 day).
- [ ] **R4** Development click log: only the inline "… more" control
  (`expandText: button[data-testid='expandable-text-button']`, inside a post or a profile entry's
  text) and, on legacy pages, "show more results". **Any other
  click blocks release.**
- [ ] **R5** LinkedIn warning, verification or "unusual activity" during or within 1 hour: none.
- [ ] **R6** Finalize result and the app's summary: as expected (complete, or partial with the
  right reasons); summary equals the popup.
- [ ] **R7** Analysis and plan: own posts identified; hooks quote real content; comment drafts in
  the post's language; nothing attributed to the wrong person; ends with the reply step.
- [ ] **R8** P1, P2 per browser: network cut during upload, then restored: resumes without
  re-reading LinkedIn.
- [ ] **R9** P1, P2 per browser: browser closed mid-upload: nothing in the app; nothing left in the
  extension.
- [ ] **R10** Duration per capture at default caps: ≤ 5 minutes.

Also note, for the results file: how many posts are flagged truncated and whether expanding worked
where the language is supported (for P7, that nothing was expanded and the summary says so); and,
for sign-in, whether the `launchWebAuthFlow` window shares the browser profile's existing Scouty
sign-in and whether the popup stays usable after the permission prompt (Firefox).

The first-run checklist that settles the open assumptions is in `fixtures/README.md`.
