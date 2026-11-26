# Store listings

What to type into each store for **Scouty B2B Prospector - Lead Research & Outreach Coach** (short form "Scouty B2B Prospector"; toolbar short name "Scouty B2B"). The name, summary and description name no
social network on purpose (the reviewer-only fields below say "the network" too; the manifest's host permission is what names the site): more networks will follow, and the name should rank for B2B lead research
and outreach rather than for one site. Click paths are in the app plan
(`docs/plans/linkedin-outreach-coach.md` §15.10), the rejection playbook in §15.11, and the source of
the disclosures in §16.1 and `PRIVACY.md`. Every listing says the same thing; the Edge text names no
other browser.

## Shared fields

| Field | Value |
| --- | --- |
| Name (≤ 75) | Scouty B2B Prospector - Lead Research & Outreach Coach (54, `extName`; title "Scouty B2B Prospector", `extTitle`; `short_name` "Scouty B2B", `extShortName`, 12 at most) |
| Short description / summary (≤ 132) | Research the B2B leads you choose on social networks and get a step-by-step outreach plan in Scouty. Only reads; never acts for you. (132, `extDescription`) |
| Category | Chrome: **Productivity → Workflow & Planning**; Edge: **Productivity**; Firefox: **Social & Communication** |
| Language | English |
| Homepage / website | `https://scouty.to/scouty-b2b` (also the manifest's `homepage_url`) |
| Support URL / site | `https://scouty.to/scouty-b2b#help` |
| Support email | `contact@scouty.to` |
| Privacy policy URL | `https://scouty.to/privacy` (its section `#scouty-b2b` covers the extension) |
| Icon | `icons/128.png` |
| Screenshots (1280 × 800) | In the app repository, `output/store-screenshots/` (not committed): `1-capture`, `2-plan`, `3-only-reads`. Synthetic data only ("Synthetic Person", "Example Workspace"); never a real profile. Regenerate from the app's `public/scouty-extension/` images and the extension gallery |

## Description (all three stores, about 1,000 characters)

```
Scouty B2B Prospector helps you research a B2B lead and prepare your first message to them.

Open the lead's profile on a supported social network in your browser and press Capture. The extension reads that one person's profile, experience and skills, and their recent posts, comments and reactions, as the network shows them to you. It sends what it read to your Scouty workspace, where Scouty writes a step-by-step plan: what to look at, when to connect, and a note and first message in their language, ready to copy.

It only reads. It never posts, likes, comments, connects or messages for you, and it does not read your password, cookies, messages, contacts or feed. Nothing runs until you press Capture, and you can stop a capture at any time.

You need a Scouty account. Connect the extension to your workspace from its window; disconnect at any time in the extension or in Scouty under Settings, Connected Apps.

Social networks often don't allow automated tools like this one and may restrict accounts that use them. You use the extension at your own risk.
```

## Privacy practices (Chrome "Privacy" tab; Edge "Properties"; AMO data collection)

- **Single purpose:** Capture the social-network profile and recent activity of one person, when the user presses Capture, and send it to the user's Scouty workspace for outreach suggestions.
- **Permission justifications:**
  - `scripting`: to read the profile pages of the person the user chose to capture, only during that capture.
  - `storage`: to keep the user's Scouty connection, the first-run consent, and a capture in progress (in memory) until Scouty confirms it.
  - `identity`: to sign the user in to Scouty through the browser's sign-in window.
  - The social network host permission declared in the manifest: the browser shows it as access to that site; the extension reads only the profile pages (`/in/…`) of the person being captured, checked in code before every read, and only after the user presses Capture.
  - Host `https://scouty.to/*`: the only place data is sent.
- **Remote code:** No. Everything the extension runs is in the package.
- **Data collected:** Personally identifiable information and Website content (the captured person's profile and activity); Authentication information (the user's Scouty access and refresh tokens, stored in the browser and sent only to Scouty). Firefox reads the same three from the manifest's `data_collection_permissions`.
- **Certifications:** not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used or transferred to determine creditworthiness or for lending.
- **Edge "personal information" question:** Yes, with the privacy policy URL above.

## Notes for the reviewer (fill in the account before submitting)

```
Test account: <reviewer email> / <password set for the review>  (a Scouty account with its own workspace and coach access)
Steps:
1. Install the extension and click its icon. Choose "Sign in" and sign in with the test account ("Create account" starts the same flow on Scouty's sign-up page).
2. Open a public profile on the supported network, for example <a public profile URL>, while signed in to that network.
3. Click the extension icon, read the one-time notice, and press Capture. The window shows what it reads; you can press Stop.
4. When it says Done, press "Open in Scouty": the plan for that person opens in the Scouty app.
The extension never clicks, posts or sends anything on the network; it only loads that person's profile and activity pages in your tab.
```

Firefox only (Notes to Reviewer, with the source archive): "Bundled with esbuild; the popup (React) is minified. Build: Node 24, `npm ci && npm run build && npm run package` (BUILD.md). Test account: as above."

## After approval

Put each store's real listing URL into that browser's `storeUrl` in the app's `SCOUTY_EXTENSION_CLIENTS` and restart the web app. Only then do the app's extension page buttons, the homepage section, its FAQ items and the footer link appear (they show nothing until a live `https` store link exists).
