# Store listings

What to type into each store for **Scouty Extension**. Click paths are in the app plan
(`docs/plans/linkedin-outreach-coach.md` §15.10), the rejection playbook in §15.11, and the source of
the disclosures in §16.1 and `PRIVACY.md`. Every listing says the same thing; the Edge text names no
other browser.

## Shared fields

| Field | Value |
| --- | --- |
| Name | Scouty Extension (from `_locales/en/messages.json` `extName`) |
| Short description / summary (≤ 132) | Captures the LinkedIn profile you choose, when you press Capture, and sends it to your Scouty workspace. Never acts on LinkedIn. (128, `extDescription`) |
| Category | Chrome: **Productivity → Workflow & Planning**; Edge: **Productivity**; Firefox: **Social & Communication** |
| Language | English |
| Homepage / website | `https://scouty.to/scouty-extension` (also the manifest's `homepage_url`) |
| Support URL / site | `https://scouty.to/scouty-extension#help` |
| Support email | `contact@scouty.to` |
| Privacy policy URL | `https://scouty.to/privacy` (its section `#linkedin-extension` covers the extension) |
| Icon | `icons/128.png` |
| Screenshots (1280 × 800) | In the app repository, `output/store-screenshots/` (not committed): `1-capture`, `2-plan`, `3-only-reads`. Synthetic data only ("Synthetic Person", "Example Workspace"); never a real profile. Regenerate from the app's `public/scouty-extension/` images and the extension gallery |

## Description (all three stores, about 1,000 characters)

```
Scouty Extension helps you prepare a first message to a lead.

Open the lead's LinkedIn profile in your browser and press Capture. The extension reads that one person's profile, experience and skills, and their recent posts, comments and reactions, as LinkedIn shows them to you. It sends what it read to your Scouty workspace, where Scouty writes a step-by-step plan: what to look at, when to connect, and a note and first message in their language, ready to copy.

It only reads. It never posts, likes, comments, connects or messages for you, and it does not read your LinkedIn password, cookies, messages, contacts or feed. Nothing runs until you press Capture, and you can stop a capture at any time.

You need a Scouty account. Connect the extension to your workspace from its window; disconnect at any time in the extension or in Scouty under Settings, Connected Apps.

Using automated tools on LinkedIn is against LinkedIn's User Agreement, and LinkedIn may restrict accounts that use them. You use the extension at your own risk.

LinkedIn is a trademark of LinkedIn Corporation. Scouty is not affiliated with or endorsed by LinkedIn.
```

## Privacy practices (Chrome "Privacy" tab; Edge "Properties"; AMO data collection)

- **Single purpose:** Capture the LinkedIn profile and recent activity of one person, when the user presses Capture, and send it to the user's Scouty workspace for outreach suggestions.
- **Permission justifications:**
  - `scripting`: to read the LinkedIn profile pages of the person the user chose to capture, only during that capture.
  - `storage`: to keep the user's Scouty connection, the first-run consent, and a capture in progress (in memory) until Scouty confirms it.
  - `identity`: to sign the user in to Scouty through the browser's sign-in window.
  - Host `https://www.linkedin.com/in/*`: the browser shows this as access to www.linkedin.com; the extension reads only the profile pages (`/in/…`) of the person being captured, checked in code before every read, and only after the user presses Capture.
  - Host `https://scouty.to/*`: the only place data is sent.
- **Remote code:** No. Everything the extension runs is in the package.
- **Data collected:** Personally identifiable information and Website content (the captured person's profile and activity); Authentication information (the user's Scouty access and refresh tokens, stored in the browser and sent only to Scouty). Firefox reads the same three from the manifest's `data_collection_permissions`.
- **Certifications:** not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used or transferred to determine creditworthiness or for lending.
- **Edge "personal information" question:** Yes, with the privacy policy URL above.

## Notes for the reviewer (fill in the account before submitting)

```
Test account: <reviewer email> / <password set for the review>  (a Scouty account with its own workspace and LinkedIn coach access)
Steps:
1. Install the extension and click its icon. Choose "Sign in" and sign in with the test account ("Create account" starts the same flow on Scouty's sign-up page).
2. Open a public LinkedIn profile, for example <a public profile URL>, while signed in to LinkedIn.
3. Click the extension icon, read the one-time notice, and press Capture. The window shows what it reads; you can press Stop.
4. When it says Done, press "Open in Scouty": the plan for that person opens in the Scouty app.
The extension never clicks, posts or sends anything on LinkedIn; it only loads that person's profile and activity pages in your tab.
```

Firefox only (Notes to Reviewer, with the source archive): "Bundled with esbuild; the popup (React) is minified. Build: Node 24, `npm ci && npm run build && npm run package` (BUILD.md). Test account: as above."

## After approval

Put each store's real listing URL into that browser's `storeUrl` in the app's `SCOUTY_EXTENSION_CLIENTS` and restart the web app. Only then do the app's extension page buttons, the homepage section, its FAQ items and the footer link appear (they show nothing until a live `https` store link exists).
