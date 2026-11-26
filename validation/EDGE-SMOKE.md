# Edge smoke check (manual)

The Edge-branded browser cannot be driven with an unpacked extension by the automated suite, so
this is done by hand for every release (release gate 9). About ten minutes.

Checked on 2026-11-26: Edge 158 does load `dist/edge` under Playwright (`channel: "msedge"`), so
steps 2–4 and 6 can be scripted, but Edge then refuses the sign-in window at once
(`launchWebAuthFlow`: "The user did not approve access."). Steps 7–10 stay manual.

1. `nvm use && npm ci && npm run build` (or `npm run build:dev` against a local app).
2. Open `edge://extensions`, switch on **Developer mode**, **Load unpacked**, choose `dist/edge`.
   Expected: the extension loads with no error badge. Note its ID.
3. On the extension's card open **Details**. Expected site access: `www.linkedin.com` and the
   Scouty origin, nothing else (Chromium shows the host, not the `/in/` path the manifest declares;
   the extension itself refuses every page outside `/in/<slug>/`). No "all sites", history, tabs
   or cookies permission.
4. Open **Inspect views: service worker**. Expected: no error in the console.
5. Make sure the app knows this build: the `scouty-ext-edge` entry of `SCOUTY_EXTENSION_CLIENTS`
   has `https://<edge id>.chromiumapp.org/` and `chrome-extension://<edge id>`.
6. Click the toolbar icon on any page that is not a LinkedIn profile. Expected: "Get started
   with Scouty" with **Sign in** (primary) and **Create account**.
7. Press **Sign in**. Expected: a browser window opens on Scouty's sign-in page, or straight on the
   consent page when it is already signed in to Scouty; after
   approving, the popup shows "Open a LinkedIn profile", with the workspace name in its header.
   Record whether the window was already signed in to Scouty.
8. Open your own LinkedIn profile (P1), click the icon, read the first-run notice, press
   **Got it, capture**. Expected: a small Scouty panel at the bottom-left of the page with a
   progress bar and **Stop**; the tab visits six pages; the panel ends with "Done" and the counts.
9. Press **Open in Scouty**. Expected: the app opens on that profile.
10. In Scouty, Settings → Connected Apps. Expected: "Scouty Extension (Edge)" with a
    recent last-used time. Press Revoke, then click the extension icon. Expected: "Get started
    with Scouty" with **Sign in** again.

Record: Edge version, extension version, tester's initials, date, and pass or the step that failed.
