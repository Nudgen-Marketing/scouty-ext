# Validation results for version 0.1.0

Copied from `RESULTS-TEMPLATE.md`. **No names, URLs, text or screenshots of LinkedIn content.**
Profiles are referred to by label only. Sections filled by the engineer on 2026-11-26 say so;
everything marked **Open** needs the tester on real LinkedIn, and the owner signs at the end.

- Tester (initials): **Open** (sections below marked "engineer" were run by Claude Code for the owner)
- Date: 2026-11-26
- Extension build: `npm run build:dev` at commit `38b254a` (plus the reproducible-build fix in this change)
- `SELECTORS_VERSION`: 2 for the staging captures below; 3 after the R2 fix (deviation 23)
- App commit: `e53d169` (branch `feat/linkedin-coach`, PR #180)

## Activity pages (E0 step 2)

**Open.** Needs a person on real LinkedIn.

| Question | Answer |
| --- | --- |
| Does `/recent-activity/all/` list only posts and reposts? | |
| Is there a posts-only URL? Which path? | |
| On comments and reactions pages, whose date is shown? | |
| What does a profile with no posts show? | |

## Runs

Every check and threshold is in the app plan's §13.4 (R1–R10), copied in `VALIDATION.md`. R2
applies to the active profiles (P2, P6); R8 and R9 to P1 and P2 in each browser; write "n/a"
elsewhere. A row passes only when every check that applies meets its threshold.

**Measured from existing staging captures (engineer, read-only, counts only).** Two finalized
Chrome captures made during the staging end-to-end runs, at selectors v2, extension 0.1.0:

| Capture | Sections | Posts: blocks / with URN / with permalink / dated / truncated | Comments: blocks / with URN | Reactions: blocks / with URN | Duration (R10) |
| --- | --- | --- | --- | --- | --- |
| P1 (the owner's own profile), 2026-11-25 | all six complete | 19 / 12 / 12 / 12 / 3 | 20 / 0 | 20 / 0 | 87 s (pass) |
| Second test profile (label to be assigned by the tester), 2026-11-24 | all six complete | 20 / 8 / 8 / 8 / 5 | 18 / 1 | 20 / 0 | 83 s (pass) |

**Finding (blocks M2): R2 fails on both captures.** Posts-page blocks carrying a URN are 63%
(12/19) and 40% (8/20), against a threshold of at least 90%. The blocks without a URN also have no
permalink and no date, so R3's samples can only be drawn from the others. The cause has to be
found on live LinkedIn pages (which posts-page items the reader reads without an activity URN, and
whether LinkedIn's current markup carries it elsewhere) and fixed in `src/reader/urn.ts` /
`src/reader/selectors.ts` with a new `SELECTORS_VERSION`. R2 does not cover the comments and
reactions pages.

**Fix (engineer, 2026-11-26, `SELECTORS_VERSION` 3, `docs/DEVIATIONS.md` §23).** Cause, seen live
in the owner's Chrome: many posts carry only a share or ugcPost URN (sent as null before), and some
of the owner's own posts carry their id only in the Boost link. The reader now sends all three kinds
and reads the Boost link. Applied to the same live posts pages (first 20 items, counts only):

| Profile | Items with an id, link and time, before | After | Without an id (why) |
| --- | --- | --- | --- |
| P1 (owner) | 12 / 20 | 18 / 20 (90%) | 2 |
| Second test profile | 8 / 20 | 13 / 20 (65%) | 7 image posts with no post link or id attribute anywhere in the page |

R2 passes on P1 at the threshold and still fails on the second profile: those 7 items expose no
id the reader may read (only the post's menu, which it must not open). **Owner decision needed:**
keep R2 at 90% of all blocks, or measure it on the blocks that carry a post link. A new capture
with the v3 build is still needed to fill the matrix.

The matrix below stays **Open** until the tester runs each profile with the click log and the
manual checks (R1, R3–R9).

| Label | Browser | Sections complete | Blocks found / visible (posts, comments, reactions) (R1) | With URN (R2) | Permalinks 3/3 (R3) | Dates 3/3 (R3) | Truncated / expanded | Duration (R10) | Click log clean (R4) | LinkedIn warning (R5) | Finalize and summary (R6) | Analysis and plan (R7) | Network cut resumes (R8, P1 and P2) | Browser closed mid-upload (R9, P1 and P2) | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | Chrome | 6/6 (staging, 2026-11-25) | 19, 20, 20 found; visible open | 63% (fails if P1 counts as active) | open | open | 3 / open | 87 s | open | open | open | open | open | open | Open |
| P2 | Chrome | | | | | | | | | | | | | | |
| P5 | Chrome | | | | | | | | | | | | | | |
| P6 | Chrome | | | | | | | | | | | | | | |
| P1 | Edge | | | | | | | | | | | | | | |
| P2 | Edge | | | | | | | | | | | | | | |
| P5 | Edge | | | | | | | | | | | | | | |
| P6 | Edge | | | | | | | | | | | | | | |
| P1 | Firefox | | | | | | | | | | | | | | |
| P2 | Firefox | | | | | | | | | | | | | | |
| P5 | Firefox | | | | | | | | | | | | | | |
| P6 | Firefox | | | | | | | | | | | | | | |

Optional rows:

| Label | Browser | Sections complete | Blocks found / visible (posts, comments, reactions) (R1) | With URN (R2) | Permalinks 3/3 (R3) | Dates 3/3 (R3) | Truncated / expanded | Duration (R10) | Click log clean (R4) | LinkedIn warning (R5) | Finalize and summary (R6) | Analysis and plan (R7) | Network cut resumes (R8, P1 and P2) | Browser closed mid-upload (R9, P1 and P2) | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P3 | Chrome | | | | | | | | | | | | | | |
| P4 | Chrome | | | | | | | | | | | | | | |
| P7 | Chrome | | | | | | | | | | | | | | |
| P8 | Chrome | | | | | | | | | | | | | | |

## Click logs

**Open.** Paste, per capture, the `Scouty dev: …` line from the background console and the
control list from Settings → **Developer** → **Copy** in the popup (control name and matched
selector only).

## Negative checks

| Check | Result |
| --- | --- |
| Signed out of LinkedIn → stops, nothing in the app | Open (automated in `e2e/capture.spec.ts`) |
| Renamed profile URL → "different address" | Open (automated in `e2e/capture.spec.ts`) |
| Tab closed mid-capture → partial capture in the app | Open |
| LinkedIn in German → nothing clicked, summary says not expanded | Open |
| Network cut during upload → resumes without re-reading | Open (S4 below covered the resume on staging) |
| Browser closed mid-upload → nothing in the app or the extension | Open |

## Selector changes made

- `SELECTORS_VERSION` 2 → 3 (2026-11-26): share and ugcPost URNs are sent, and the Boost link's
  `content` parameter is read (deviation 23).

## E15 real local app

App plan §15.4. Run against **staging** (not a local app) on 2026-11-24 and 2026-11-25, Chrome,
extension `main` at `93fa19a` and later, app `feat/linkedin-coach`. Fixes found there are in
`docs/DEVIATIONS.md` §21.

| Scenario | Pass, or the state observed |
| --- | --- |
| S1 happy path | Pass (live, staging) |
| S2 analysis (plan within 5 minutes, ends with the reply step, no link) | Pass (live, staging) |
| S3 Stop | Pass (live, staging) |
| S4 network cut, resumed without reloading LinkedIn | Pass for the resume (live); the "You're offline" screen covered by the e2e test |
| S5 connection revoked mid-capture, reconnect saves what was read (partial, signed_out_of_scouty) | Pass (live, staging) |
| S6 capture stopped: started again from another browser (state 25); also automated in `e2e/capture.spec.ts` with two Chrome profiles | Pass (automated two-profile e2e) |
| S7 extension below the minimum version (state 19) | Pass (live, staging) |
| S8 recent capture reused (state 7) | Pass (live, staging) |

Also run on staging on 2026-11-25 (engineer): a new user created from the extension's **Create
account**, verified, connected (popup "Open a LinkedIn profile"; the grant `Scouty Extension
(Chrome)`, scope `scouty:linkedin_capture`, active in the user's own workspace), and **Sign in**
with an existing account. Edge (automated part only, see `EDGE-SMOKE.md`) is recorded in
`RELEASE-0.1.0.md` row 9.

## A0 AI eval on real-shaped data

App plan §15.3. Engineer run.

- Date: 2026-11-26
- App commit under test: `e53d169`
- Command: `node --env-file=.env --env-file=.env.local ./node_modules/.bin/vitest run --config vitest.ai-eval.config.mts src/lib/__evals__/linkedin-coach.eval.test.ts`, three times in a row
- Model id: `gpt-6-sol` (`OPENAI_MODEL`)
- Real-shape fixtures used: 2, labels `capture-1` (P1, English, active) and `capture-2` (the second
  test profile; rebuilt on 2026-11-26 from its selectors-v3 capture). Rebuilt with `rebuildPayloads` from the two staging captures above: every text
  replaced by placeholder text of the same script and length, every URN made up; checked for names,
  words and ids of the originals (none found). Not committed.

| Run | Outcome (all assertions pass / failing assertions) | Cases passed |
| --- | --- | --- |
| 1 | All assertions pass (187 s) | 13 / 13 |
| 2 | All assertions pass | 13 / 13 |
| 3 | All assertions pass | 13 / 13 |
| 4 (2026-11-26, after the review fixes; capture-2 rebuilt from its selectors-v3 capture) | All assertions pass | 13 / 13 |

13 = the 6 + 3 × 2 cases of §15.3 for two fixtures, plus the fixture check: both fixtures ran, in
the rule cases and in the emailed and replied outreach cases.

| Per lead (from Langfuse) | Value |
| --- | --- |
| Input tokens per lead | 14,514–17,748 (2,450 cached), measured 2026-11-26 from each response's usage (Langfuse is not configured) |
| Output tokens per lead | 1,403–1,512 (incl. reasoning) |
| Cost per lead (USD) | ≈ 0.046–0.053 (`gpt-6-sol`: $2 / $10 per 1M input / output, $2.50 cache write, $0.20 cached read). Recorded in the app's `docs/linkedin-outreach-coach.md` "Measured cost" |

| Assertion | Pass | Change made |
| --- | --- | --- |
| All §15.3 assertions | 3 of 3 runs | None |

## Gallery review

Engineer review on 2026-11-26 of `npm run gallery` (`gallery/index.html`, built from `38b254a`):
all 27 popup states, the 3 "off a profile" variants and the 8 overlay states, in light and dark,
at the real popup width. All render, copy is short and consistent, contrast holds in both themes,
no clipped or overlapping text. Screenshots: `scouty/output/gallery-review-2026-11-26/` (local,
not committed). Two small notes, not blocking:

- The outlined secondary buttons ("Create account", "Cancel", "Close", "Disconnect") are very faint
  in light mode and plain text in dark mode: readable, but they barely look like buttons.
- The overlay's "Done" has no green check; the popup's "Done" has one.

**Owner sign-off (initials and date): Open.**

## Owner sign-off

| | Initials | Date |
| --- | --- | --- |
| Results reviewed | | |
