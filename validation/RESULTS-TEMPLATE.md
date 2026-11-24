# Validation results for version <version>

Copy to `RESULTS-<version>.md`. **No names, URLs, text or screenshots of LinkedIn content.**

- Tester (initials): 
- Date: 
- Extension build: `npm run build:dev` at commit 
- `SELECTORS_VERSION`: 
- App commit: 

## Activity pages (E0 step 2)

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

**Mandatory rows.** P1, P2, P5 and P6 in Chrome are release gate M2 (app plan §14.2). The same four
in Edge and in Firefox are part of that browser's store packet (gate M4) and must pass before it is
submitted there; a browser not being submitted in this release may say "not submitted".

| Label | Browser | Sections complete | Blocks found / visible (posts, comments, reactions) (R1) | With URN (R2) | Permalinks 3/3 (R3) | Dates 3/3 (R3) | Truncated / expanded | Duration (R10) | Click log clean (R4) | LinkedIn warning (R5) | Finalize and summary (R6) | Analysis and plan (R7) | Network cut resumes (R8, P1 and P2) | Browser closed mid-upload (R9, P1 and P2) | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | Chrome | | | | | | | | | | | | | | |
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

**Optional rows** (P3, P4, P7, P8 in Chrome, or any repeat). Add rows as needed.

| Label | Browser | Sections complete | Blocks found / visible (posts, comments, reactions) (R1) | With URN (R2) | Permalinks 3/3 (R3) | Dates 3/3 (R3) | Truncated / expanded | Duration (R10) | Click log clean (R4) | LinkedIn warning (R5) | Finalize and summary (R6) | Analysis and plan (R7) | Network cut resumes (R8, P1 and P2) | Browser closed mid-upload (R9, P1 and P2) | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P3 | Chrome | | | | | | | | | | | | | | |
| P4 | Chrome | | | | | | | | | | | | | | |
| P7 | Chrome | | | | | | | | | | | | | | |
| P8 | Chrome | | | | | | | | | | | | | | |
|  |  | | | | | | | | | | | | | | |

## Click logs

Paste, per capture, the `Scouty dev: …` line from the background console and the control list
from Settings → **Developer** → **Copy** in the popup (control name and matched selector only).

## Negative checks

| Check | Result |
| --- | --- |
| Signed out of LinkedIn → stops, nothing in the app | |
| Renamed profile URL → "different address" | |
| Tab closed mid-capture → partial capture in the app | |
| LinkedIn in German → nothing clicked, summary says not expanded | |
| Network cut during upload → resumes without re-reading | |
| Browser closed mid-upload → nothing in the app or the extension | |

## Selector changes made

List each change to `src/reader/selectors.ts` (and `urn.ts`), with the new `SELECTORS_VERSION`.

## E15 real local app

App plan §15.4. Commits of both repositories, Chrome version, then each scenario.

| Scenario | Pass, or the state observed |
| --- | --- |
| S1 happy path | |
| S2 analysis (plan within 5 minutes, ends with the reply step, no link) | |
| S3 Stop | |
| S4 network cut, resumed without reloading LinkedIn | |
| S5 connection revoked mid-capture, reconnect saves what was read (partial, signed_out_of_scouty) | |
| S6 capture stopped: started again from another browser (state 25); also automated in `e2e/capture.spec.ts` with two Chrome profiles | |
| S7 extension below the minimum version (state 19) | |
| S8 recent capture reused (state 7) | |

## A0 AI eval on real-shaped data

App plan §15.3. Command, model id, pass count, and for each failing assertion the change made.
Token and cost figures come from Langfuse; copy them also to `docs/linkedin-outreach-coach.md` in
the `scouty` repository.

- Date: 
- App commit under test: 
- Command: 
- Model id: 
- Real-shape fixtures used (count, labels only, for example P1, P6): 

| Run | Outcome (all assertions pass / failing assertions) | Cases passed |
| --- | --- | --- |
| 1 | | |
| 2 | | |
| 3 | | |

| Per lead (from Langfuse) | Value |
| --- | --- |
| Input tokens per lead | |
| Output tokens per lead | |
| Cost per lead (USD) | |

| Assertion | Pass | Change made |
| --- | --- | --- |
| | | |

## Gallery review

App plan §15.7. Reviewer's initials, date, and any state that needs a change.

## Owner sign-off

Every mandatory row above passes, the click logs are clean, and the sections above are complete.

- Owner (name or initials): 
- Date: 
