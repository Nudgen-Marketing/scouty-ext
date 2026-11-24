# Fixtures

**This repository is public. No fixture may contain real LinkedIn content: no real person's name,
photo, URL, id or text.**

## `synthetic/`

Written by hand. Each file starts with
`SYNTHETIC: not captured from LinkedIn; structure is a best guess`.
**They prove the code's logic, not that the selectors match LinkedIn.**

Since selectors version 2 (2026-11-24) the fixtures that drive the reader reproduce LinkedIn's
server-driven UI ("SDUI"): generated atomic class names with no meaning, `componentkey`,
`data-testid`, a `data-sdui-screen` naming the page, `main#workspace`, `role=list`/`listitem`
lists (`data-component-type=LazyColumn`), `expandable-text-box` / `expandable-text-button`, post
links (`/feed/update/<urn>/`, `/analytics/post-summary/<urn>/`), "2w •" dates and action buttons
named by `aria-label`. Every name, text, slug, link and id in them is invented.

| File | What it stands for |
| --- | --- |
| `sdui-profile.html` | A profile: top card (name, a pronoun line, headline, contact link, Connect / Message / More), About with "… more", Experience, Education, Skills (with Endorse), Licenses & certifications, Languages; owner-only sections (Analytics, Suggested for you, Profile language, Public profile & URL), recommendations (People you may know, You might like, Who your viewers also viewed), an ad section with its own "… more", the Activity teaser, a section without a heading and a contact section — none of which may be read |
| `sdui-profile-empty.html` | A profile with a top card and nothing else |
| `sdui-details-experience.html`, `sdui-details-skills.html`, `sdui-details-empty.html` | The two detail pages (entries of paragraphs inside `componentkey` divs, a description with "… more", back / add / filter-tab / ad controls that must never be pressed), and one with an empty root |
| `sdui-activity-posts.html` | Three items: an own post (analytics link), a long post with "… more" and "1w • Edited •", a repost with a document carousel and a ugcPost link |
| `sdui-activity-comments.html` | Two items: a post the lead commented on (post first, the lead's comment last, a link with a comment query), and one with no post link |
| `sdui-activity-reactions.html` | "likes this" with an activity URN, "liked a comment on this" with a share URN, in Vietnamese |
| `sdui-activity-empty.html` | The activity list with no item (how LinkedIn shows this is unverified) |
| `sdui-interaction-traps.html` | Controls that must never be clicked: every action control given the expand control's `data-testid` and `aria-hidden` and put in its own text box, controls refused by structure alone (labels not on the word list, menus, dialogs, forms, links, a hidden ancestor, an action next to "… more", owner-only sections, outside an item or outside `main`) |
| `reduced-profile.html`, `authwall.html`, `checkpoint.html`, `not-found.html`, `unrelated.html` | Legacy page states that stop a capture (the sign-in, authwall and checkpoint addresses are tested by URL) |

The mock LinkedIn server of the browser tests (`e2e/mock-linkedin.mjs`) serves these same files.

## `sanitized/`

Empty until the owner task E0. Files here are produced only by `npm run sanitize`, which keeps
page structure and nothing else (tag names, class names, roles, the names of `aria-*` and `data-*`
attributes). See `tools/sanitize.mjs` and `test/static/sanitize.test.ts`.

## E0 checklist: first run against live LinkedIn (owner task)

Use only profiles whose owners agreed. Record results in `validation/RESULTS-<version>.md` with
anonymous labels (P1, P2, …): no name, URL, text or screenshot of LinkedIn content.

1. Set up the local app and the development builds (`validation/VALIDATION.md`).
2. Open `…/in/<slug>/recent-activity/all/` by hand and record: does it list only the person's
   posts and reposts, or also posts they commented on or reacted to? Is there a posts-only URL
   (for example `…/recent-activity/shares/`)? On the comments and reactions pages, does the date
   next to an item belong to the original post? What does a profile with no posts show?
   - A posts-only **URL** exists → set `sectionPaths.posts` in `src/reader/selectors.ts`.
   - Only an in-page tab exists → leave it. Do not add a tab click.
3. For each profile press **Capture to Scouty** and record, per section: page state detected; the
   state and reason in the result; blocks found versus what is visibly on the page; how many carry
   a URN; whether three sampled permalinks open the right post; whether three sampled decoded
   times match the post's date within a day; long posts expanded versus left truncated; profile
   sections found, and whether Experience and Skills are complete; total duration.
4. **Click log.** The development build lists every control it pressed when the capture ends.
   Expected: only "… more" (`expandable-text-button`) inside post or profile text, and on legacy
   pages "show more results". **Anything
   else is a release blocker.**
5. Negative checks: signed out of LinkedIn; a renamed profile URL; closing the tab mid-capture;
   LinkedIn set to German (nothing is clicked and the summary says posts were not expanded).
6. **Sanitized fixtures.** Save the six pages of two profiles with "Save page as (HTML only)",
   then `npm run sanitize -- saved.html fixtures/sanitized/<name>.html`. **Open each output file
   and search it for your own name, the profile owner's name, their company, and any word you
   remember from their posts. Nothing may be found.** Commit only the sanitized files; delete the
   originals.

What to change when reality differs: **only `src/reader/selectors.ts`** (bump
`SELECTORS_VERSION`), plus `URN_TIME_ENABLED` in `src/reader/urn.ts` if the id-to-time rule is
wrong. If block containers cannot be found reliably for a page, ship the degraded text mode for
that page and record it.
