# Release 0.1.0: checklist

The table of `RELEASE.md`, filled in on 2026-11-24 for the first store release. Copy it into the
release pull request. Rows without evidence are still open; nothing is submitted until every row is
green.

| # | Gate | Evidence | Done by / date |
| --- | --- | --- | --- |
| 1 | CI green on the tagged commit | Local `npm run check` green on `main` (unit 452, static 173, UI 118, contract 66, browser e2e 16, Firefox lint 0 errors / 3 known warnings) and `npm run test:gallery` 4 passed. **Open:** CI run of the tagged commit, incl. Firefox start-up smoke and double-build hash equality | |
| 2 | The app's gates green on the commit to deploy | App PR #180 at `66a6a9e`, run locally on a clean Postgres 18: lint, typecheck, unit 4,090; integration 1,185, admin 238, MCP 228, knowledge 201, LinkedIn 307, billing 301, phone 55, GTM 1,343/1,344 (known flaky "cleans up deleted originals", passes alone 3/3). E2E 1,085 passed; the 19 failing tests fail on `main` too or pass when repeated (see the app PR). **Open:** the app has no CI on the PR | |
| 3 | Contract in sync | `diff -r protocol-v1 ../scouty/src/lib/linkedin/__fixtures__/protocol-v1`: empty; `cmp src/ui/tokens.json ../scouty/src/lib/linkedin/__fixtures__/extension-tokens.json`: no difference (2026-11-24) | |
| 4 | S1–S8 against the real app | Run on staging 2026-11-24: S1, S2, S3, S4 (resume; the offline screen by e2e), S5, S7, S8 live; S6 by the two-profile e2e. Fixes found there are in deviation 21 | |
| 5 | State gallery reviewed (light and dark) | Engineer review 2026-11-26 of all 27 states, 3 off-profile variants and 8 overlay states in both themes: no defects, two small notes (`RESULTS-0.1.0.md`, "Gallery review"). **Open: owner's initials** | |
| 6 | Real-LinkedIn validation for this version's selectors | `RESULTS-0.1.0.md` started. R2 finding (63% and 40% with a URN) fixed in `SELECTORS_VERSION` 3 (deviation 23): on the live posts pages 18/20 (P1) and 13/20 (second profile); the 7 left expose no id in the page. **Owner decision:** R2's definition for such posts. **Open:** a v3 capture, the mandatory rows, click logs and negative checks | |
| 7 | Live AI eval (app task A0) | 2026-11-26, app `e53d169`, model `gpt-6-sol`, two real-shape fixtures: **3 of 3 runs, 13/13 each** (`RESULTS-0.1.0.md`, "A0"). **Open:** tokens and cost per lead (no Langfuse here); owner signs | |
| 8 | Firefox: smoke, walk-through, source rebuild on a clean machine (Node 24) | Start-up smoke passed in CI on `38b254a` (Firefox 161.0, run https://github.com/Nudgen-Marketing/scouty-ext/actions/runs/45580923347). Source rebuild on Node 24.0.2 in two fresh folders: identical packages after the build-path fix (`BUILD.md`). **Open:** the manual walk-through (Part B; Firefox is not installed here), and the hashes from the tagged commit | |
| 9 | Edge walk-through | Automated part on 2026-11-26, Edge 158.0.4370.33, dev build against staging: steps 2–4 and 6 pass (loads, permissions `identity`, `scripting`, `storage`, origins LinkedIn and Scouty only, no console error, signed-out popup). **Open:** steps 7–10 by hand (Edge refuses the sign-in window under automation) | |
| 10 | Privacy, consent, store disclosures and public pages have legal sign-off | Review pack ready: `validation/LEGAL-REVIEW-0.1.0.md` (every text in scope, where it lives, data handling as built, nine questions). **Open (M3):** the reviewer's written approval | |
| 11 | Server configured | **Open:** production migrations `20261204000000_linkedin_coach`, `20261205000000_linkedin_open_intents`, `20261206000000_linkedin_plan_outcomes`, `20261208000000_linkedin_retention_indexes` (backup first; applied on staging 2026-11-26); `SCOUTY_EXTENSION_CLIENTS` with the three store ids (`storeUrl` left out until approval, which the app accepts since 2026-11-26; the Firefox entry's redirect follows the new add-on id `prospector@scouty.to`); `SCOUTY_EXTENSION_MIN_VERSION=0.1.0`; `LINKEDIN_COACH_ENABLED=true`; `LINKEDIN_COACH_AUDIENCE=all` before the first submission (app plan §15.9) | |
| 12 | Exit criteria of the rollout stage | **Open** | |
| 13 | Store approvals | **Open** | |

Package contents for this version: manifests carry `homepage_url: https://scouty.to/scouty-b2b`.
Listing text, URLs and reviewer notes: `STORE-LISTING.md`.
