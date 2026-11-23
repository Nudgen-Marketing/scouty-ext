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

| Label | Browser | Sections complete | Blocks found / visible (posts, comments, reactions) | With URN | Permalinks 3/3 | Dates 3/3 | Truncated / expanded | Duration | Click log clean | LinkedIn warning | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | Chrome | | | | | | | | | | |
| P1 | Edge | | | | | | | | | | |
| P1 | Firefox | | | | | | | | | | |
| P2 | Chrome | | | | | | | | | | |

## Click logs

Paste the list shown at the end of each capture (control name and matched selector only).

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
