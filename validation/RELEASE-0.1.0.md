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
| 5 | State gallery reviewed (light and dark) | `npm run gallery`, open `gallery/index.html`. **Owner's initials** | |
| 6 | Real-LinkedIn validation for this version's selectors | Live captures on staging after `93fa19a` carry name, headline, About, Featured, Experience, Skills, posts, comments and reactions. **Open:** `validation/RESULTS-0.1.0.md` mandatory rows and click logs | |
| 7 | Live AI eval (app task A0) | **Open (costs API credit; owner's approval)** | |
| 8 | Firefox: smoke, walk-through, source rebuild on a clean machine (Node 24) | **Open** | |
| 9 | Edge walk-through | **Open** | |
| 10 | Privacy, consent, store disclosures and public pages have legal sign-off | `PRIVACY.md`, `STORE-LISTING.md`, the app's `/privacy#linkedin-extension`, `/terms`, `/linkedin-extension` and the homepage section and FAQ items. **Open (M3)** | |
| 11 | Server configured | **Open:** production migrations `20261204000000_linkedin_coach`, `20261205000000_linkedin_open_intents`, `20261206000000_linkedin_plan_outcomes` (backup first); `SCOUTY_EXTENSION_CLIENTS` with the three store ids (no `storeUrl` until approval); `SCOUTY_EXTENSION_MIN_VERSION=0.1.0`; `LINKEDIN_COACH_ENABLED=true`; `LINKEDIN_COACH_AUDIENCE=all` before the first submission (app plan §15.9) | |
| 12 | Exit criteria of the rollout stage | **Open** | |
| 13 | Store approvals | **Open** | |

Package contents for this version: manifests carry `homepage_url: https://scouty.to/linkedin-extension`.
Listing text, URLs and reviewer notes: `STORE-LISTING.md`.
