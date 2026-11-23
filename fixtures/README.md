# Fixtures

**This repository is public. No fixture may contain real LinkedIn content: no real person's name,
photo, URL, id or text.**

## `synthetic/`

Written by hand. Each file starts with
`SYNTHETIC: not captured from LinkedIn; structure is a best guess`.
**They prove the code's logic, not that the selectors match LinkedIn.**

| File | What it stands for |
| --- | --- |
| `profile.html` | A signed-in profile: top card with Connect, Message, Follow and More, About with "…see more", Experience, Education, Skills, and a contact section that must never be read |
| `profile-empty.html` | A profile with a name and nothing else |
| `details-experience.html`, `details-skills.html`, `details-empty.html` | The two detail pages, and one LinkedIn shows as empty |
| `activity-posts.html` | Three blocks: one with an activity URN, one long post with "…see more", one whose id is not an activity URN; a "Show more results" control |
| `activity-comments.html` | A post the lead commented on, with the lead's comment after it |
| `activity-reactions.html` | Two posts the lead reacted to, one in Vietnamese |
| `activity-empty.html` | LinkedIn's "nothing to see" page |
| `reduced-profile.html`, `authwall.html`, `checkpoint.html`, `not-found.html`, `unrelated.html` | The page states that stop a capture |
| `interaction-traps.html` | Controls that must never be clicked, including ones given the expand control's class, placed inside a text container, or labelled in a language not on the word list |

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
   Expected: only "see more" inside post or profile text, and "show more results". **Anything
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
