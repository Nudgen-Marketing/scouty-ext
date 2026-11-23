# Release checklist

A release is a git tag `v<version>`. **Nothing is submitted to a store until every gate below is
green.** Copy this table into the release pull request and fill it in.

Gate 1 is enforced by machine: `.github/workflows/release.yml` builds the packages only if the CI
workflow succeeded for the tagged commit. Gates 2 to 4 are commands whose output is pasted.
Gates 5 to 12 are attestations by a named person; the owner's sign-off on the filled-in checklist
is the control. Store uploads are done by hand; no store credential exists in CI.

| # | Gate | Evidence | Done by / date |
| --- | --- | --- | --- |
| 1 | CI green on the tagged commit: typecheck, lint, unit, static, UI, contract, browser e2e, gallery, Firefox lint, Firefox start-up smoke, double-build hash equality | The CI run | |
| 2 | The app's gates green on the commit to be deployed (`yarn lint && yarn typecheck && yarn test`, MCP, LinkedIn, integration, e2e, build) | The app's CI run | |
| 3 | Contract in sync: `diff -r protocol-v1 ../scouty/src/lib/linkedin/__fixtures__/protocol-v1` is empty, and `cmp src/ui/tokens.json ../scouty/src/lib/linkedin/__fixtures__/extension-tokens.json` reports no difference | Command output pasted | |
| 4 | The extension works against the real local app: the eight scripted scenarios S1–S8 of the app plan's §15.4 (E15) all pass | `## E15 real local app` in `validation/RESULTS-<version>.md` | |
| 5 | State gallery (`npm run gallery`, open `gallery/index.html`) reviewed in light and dark and signed off | Owner's initials and date | |
| 6 | Real-LinkedIn validation complete for this version's selectors: every row passes, click logs clean | `validation/RESULTS-<version>.md` | |
| 7 | Live AI eval passes on real-shaped data (app task A0) | Run log | |
| 8 | Firefox: `npm run smoke:firefox` passes (CI) and `validation/FIREFOX-SMOKE.md` is completed, and the source archive rebuilds to an identical package following BUILD.md on a clean machine with Node 24 | CI run link, tester's initials, hashes pasted | |
| 9 | Edge: the Edge build loaded in Edge completes `validation/EDGE-SMOKE.md` | Tester's initials | |
| 10 | Privacy text, consent text and store disclosures match PRIVACY.md and have legal sign-off | Reference to the approval | |
| 11 | Server configured: `SCOUTY_EXTENSION_CLIENTS` has the three ids; `SCOUTY_EXTENSION_MIN_VERSION` set; migration applied; feature limited to administrators | Owner's confirmation | |
| 12 | Exit criteria of the rollout stage being entered are met | The metric query results | |

Gate 4 is a scripted manual run, because the automated browser suite always starts its own stub of
the capture API. An `E2E_API` mode that points the suite at a real app is listed under "Later" in
the app plan (§14.1).

## Steps

1. Set `version` in `package.json` (it is copied into every manifest and sent as
   `X-Scouty-Extension-Version`). If a store assigned client ids other than `scouty-ext-chrome`,
   `scouty-ext-edge`, `scouty-ext-firefox`, set them in `build.mjs`.
2. Open the release pull request with this checklist filled in; merge when CI is green.
3. Tag the merge commit `v<version>` and push the tag. The release workflow checks CI for that
   commit, checks the tag against `package.json`, builds, and attaches the four archives.
4. Upload by hand, in the order of the rollout plan: Chrome private testers first; Edge and
   Firefox only after that stage has passed. Firefox needs `scouty-ext-<version>-source.zip` and
   a pointer to BUILD.md, because the package is bundled and the popup script is minified.

## Rollback, fastest first

1. On the server, raise `SCOUTY_EXTENSION_MIN_VERSION`: older extensions are told to update at
   their next call.
2. Remove one browser's entry from `SCOUTY_EXTENSION_CLIENTS`: its connections stop at once.
3. `LINKEDIN_COACH_ENABLED=false`: the whole feature is off.
4. Unpublish the store listing (slow; last).

## What the automated tests do not prove

- **That the selectors match LinkedIn today.** Every fixture in CI is synthetic or structure-only.
- **What LinkedIn does to an account that uses the extension.**
- **That a store will approve or keep the listing.**
- **Branded Chrome, Edge and Firefox behaviour** beyond the manual matrix: the automated browser
  run uses Playwright's Chromium only, and Firefox gets a lint and a start-up check.
- **That submitted content is genuine.** A signed-in user can submit anything to their own workspace.
