# Legal review pack, Scouty B2B Prospector 0.1.0 (release gate 10, app plan §15.8 "M3")

Prepared on 2026-11-26 for the reviewer. It gathers every text and decision in scope, with where
each lives, and the questions that need a written answer. **It is not the approval**: release gate 10
needs a written approval from the reviewer, referenced in `RELEASE-0.1.0.md` row 10. If the reviewer
asks for a change, edit the copy where it lives (listed below) and re-run the gallery review (§15.7)
for any changed popup state.

## 1. What the product does (for context)

- **Scouty B2B Prospector - Lead Research & Outreach Coach** (on Firefox "Scouty B2B Prospector - Lead Research & Outreach", within addons.mozilla.org's 50-character limit; "Scouty B2B Prospector"; renamed from "Scouty Extension" on 2026-11-26; Chrome, Edge, Firefox; published by the company in a public repository and
  three stores): when the user presses **Capture** on a LinkedIn profile, it loads that person's six
  profile pages in the user's own tab (profile, experience, skills, posts, comments, reactions),
  reads the text LinkedIn shows the user, and sends it to the user's Scouty workspace. It presses
  only inline "see more" / "show more results" controls. It never posts, likes, comments, follows,
  connects or messages.
- **Scouty app**: an AI provider (OpenAI, through its API) analyses the captured text and writes a
  plan of steps the user does by hand on LinkedIn (view, follow, react or comment, invite, message).
- **People concerned**: any LinkedIn member a user chooses to capture, not only existing leads,
  including content LinkedIn shows the user because they are connected (connections-only content).
- **Accounts**: since 2026-11-25 someone new can create a Scouty account from the extension; the
  sign-up page says "By creating an account, you agree to our Terms and Privacy Policy."

## 2. Texts in scope, and where they live

| # | Text | Where (repository → file) |
| --- | --- | --- |
| T1 | First-run consent and risk notice (popup state 5 "Before you start") | `scouty-ext` → `_locales/en/messages.json` (`consentTitle`, `consentPoint1–3`) |
| T2 | Permission screen (state 1) | `scouty-ext` → `_locales/en/messages.json` (`permissionTitle`, `permissionBody`) |
| T3 | Store description and extension description ("Research B2B leads you choose on a social network and get a step-by-step outreach plan in Scouty. Never posts or messages for you."; it said "Only reads; never acts for you" until 2026-11-26, DEVIATIONS 27, but the extension presses "see more" and "show more results") | `scouty-ext` → `STORE-LISTING.md`; `_locales/en/messages.json` (`extDescription`) |
| T4 | Store privacy disclosures: single purpose, permission justifications, data collected, certifications, Edge personal-information answer, Firefox data collection (`data_collection_permissions` in the manifest) | `scouty-ext` → `STORE-LISTING.md` "Privacy practices"; `manifest.firefox.json` |
| T5 | Extension privacy statement (the store "privacy policy" text) | `scouty-ext` → `PRIVACY.md` |
| T6 | App privacy page, section "Scouty B2B Prospector" (`/privacy#scouty-b2b`) | `scouty` → `src/app/(legal)/privacy/page.tsx` (marked `PENDING LEGAL SIGN-OFF`) |
| T7 | App terms sentence (`/terms#scouty-b2b`) | `scouty` → `src/app/(legal)/terms/page.tsx` (marked `PENDING LEGAL SIGN-OFF`) |
| T8 | Public page `/scouty-b2b` (was `/scouty-extension`, which redirects) (what it reads, what it never does, the network-neutral risk notice "Social networks often don't allow automated tools like this one…", the trademark line "Names of social networks are trademarks of their owners…", FAQ) and the two homepage FAQ items | `scouty` → `src/lib/scouty-extension-page.ts` |
| T9 | "Can't capture this profile / Scouty doesn't keep data about this person" (a person who asked to be erased) | `scouty-ext` → `_locales/en/messages.json` (`suppressedTitle`, `suppressedBody`) |
| T10 | Sign-up acceptance line ("By creating an account, you agree to our Terms and Privacy Policy") | `scouty` → `src/components/auth/sign-up-form.tsx` |

Current wording of the user-facing consent (T1, T2), quoted for convenience:

> **Before you start**
> - Scouty reads this profile and the person's recent posts, comments and reactions.
> - It only presses "see more" and "show more results" to read in full. It never likes, comments, connects, messages or posts for you.
> - The person may see that you viewed their profile. This site may not allow tools like this and may limit your account.

> **Allow access**: Scouty only opens the profiles you choose to capture.

Consent point 2 was reworded on 2026-11-26 (DEVIATIONS 26): it said only "see more" on posts, but the
reader also presses "see more" in profile sections and "show more results".

Terms sentence (T7): "If you use Scouty B2B Prospector, you are responsible for using it in line
with the terms of each social network you use it on, and only on people you have a legitimate
reason to contact."

**Network-neutral wording (2026-11-26).** The extension was renamed Scouty B2B Prospector and its public texts
(store description, `PRIVACY.md`, `/scouty-b2b`, the homepage FAQ, the privacy section now at
`/privacy#scouty-b2b`, the terms sentence now at `/terms#scouty-b2b`) no longer name LinkedIn,
because more social networks will follow. The risk notice is now "Social networks often don't allow
automated tools like this one and may restrict accounts that use them. You use the extension at your
own risk.", and the trademark line "Names of social networks are trademarks of their owners. Scouty
is not affiliated with or endorsed by any of them." The popup now says "this site" (T1: "This site may not allow tools like this and may limit your
account."), and the reviewer-only store fields say "the network" (for example "Open a public profile
on the supported network"). The manifest's host permission is the only place the site is named; the
browser shows it as access to that site when the extension is installed. **Question 10 below** asks whether this is enough.

**When the app texts go public.** T6, T7, T8 and the homepage FAQ items are shown only once the
feature is on for everyone (`LINKEDIN_COACH_ENABLED=true` and `LINKEDIN_COACH_AUDIENCE=all`, app
`src/lib/extension-publication.ts`), so deploying the app with the feature off or for administrators
only publishes none of them before this review.

## 3. Data handling as built (to check against the texts)

| Topic | As built |
| --- | --- |
| What is stored | The captured text (profile sections, up to 50 posts, comments and reactions), the analysis and the plan, per workspace. Never LinkedIn passwords, cookies, messages, contacts or feed. |
| Who sees it | The workspace's members. Not read by Scouty staff except as stated in T5. |
| Processors | OpenAI (API) for the analysis and plan; Scouty's hosting. No advertising use, no sale, no creditworthiness or lending use. |
| Retention | Until 12 months after the plan was last used (ticking a step or editing a text counts), or 12 months after the capture when there is no plan; earlier on removal by the user, or when the workspace, campaign or project is deleted. |
| Erasure of a captured person | On request, everything any workspace holds from that profile is erased, and a tombstone keeps it from being captured again (T9 is what a user then sees). |
| Authentication data | A Scouty access and refresh token in the browser's extension storage, sent only to Scouty. |
| Access control | The coach is off unless `LINKEDIN_COACH_ENABLED=true`; `LINKEDIN_COACH_AUDIENCE` decides who may use it (unset: administrators only; `all`: everyone). |

## 4. Questions for the reviewer

1. **LinkedIn's User Agreement.** The extension reads LinkedIn in the user's own session, on the
   user's action, at a human pace, and the texts say plainly that this site (T1) or social networks
   (T3, T5, T8) may not allow tools like this and may limit the user's account, and that the user
   uses it at their own risk; they do not name LinkedIn (see question 10).
   Is this disclosure enough for users, and is the company's own exposure (publishing it in three
   stores and a public repository) acceptable?
2. **Arbitrary people and connections-only content.** Users may capture anyone, not only leads,
   including content visible only to their connections. Is the legal basis (the user's legitimate
   interest in contacting the person, the terms sentence T7) adequate, and should T7 or T1 say more
   (for example, not capturing people one has no business reason to contact)?
3. **Controller role.** Who is the controller of the captured person's data: the customer
   (workspace) with Scouty as processor, or Scouty? T6 and T5 should state it the same way.
4. **Information to the captured person.** The person is not told when they are captured (only
   that a profile view may be visible, T1). Is the privacy page (T6) with the erasure route enough?
5. **Store policies.** Do T4 and T5 meet Chrome's Limited Use, Edge's data-usage certification and
   its personal-information rule (1.5.4), and Firefox's data-collection declaration? T5 states the
   Limited Use commitments for every store and names the Chrome Web Store User Data Policy as one of
   the policies followed (Edge asks that no single store's policy be presented as the only one).
6. **Retention and erasure.** Is 12 months from last use, with removal and erasure on request,
   acceptable as stated in T6?
7. **AI processing.** Is the AI-provider disclosure in T6 ("sent to OpenAI through its API… we
   don't use it to train our own models") sufficient, and consistent with the main AI-processing
   section of the privacy page?
8. **Trademark.** Is the neutral trademark line on `/scouty-b2b` (T8), "Names of social networks
   are trademarks of their owners. Scouty is not affiliated with or endorsed by any of them.",
   acceptable when it names no network? The store listings (name, summary, description) name no
   network either; only the manifest's host permission names the site.
9. **New accounts from the extension.** Is the sign-up acceptance line (T10) enough when someone
   creates their Scouty account from the extension's sign-in window?

10. **Generic risk notice.** Is the network-neutral risk notice and trademark line on the public
    page, store description and privacy texts enough, given that the extension reads only one network
    today and its consent says "this site" rather than naming it?

## 5. Approval record

| | |
| --- | --- |
| Reviewer | |
| Date | |
| Decision (approved / approved with changes / not approved) | |
| Changes requested, and where they were made | |
| Reference to the written approval | |
