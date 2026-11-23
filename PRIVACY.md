# Privacy

Scouty LinkedIn Capture does one thing: when you press Capture on a LinkedIn profile, it reads that
person's profile and their recent posts, comments and reactions from the tab in front of you, and
sends that content to your Scouty workspace so Scouty can suggest how to approach them.

It only reads. It never follows, likes, comments, connects, messages or changes anything on
LinkedIn, and it sends nothing to LinkedIn. It does not read your LinkedIn password, cookies,
messages, contacts or feed, and it does nothing until you press Capture. It reads one person at a
time and has no background activity.

To send captures to your workspace it signs you in to Scouty through your browser. It stores a
Scouty access token on your device for that purpose only; you can disconnect in the extension or
revoke the connection in Scouty under Settings, Connected Apps. While a capture is being sent, its
content is held in the browser's memory so an interrupted upload can finish; it is never written to
disk and is gone as soon as Scouty confirms it or you close the browser.

What it collects is about the person whose profile you capture: the text of their profile and
activity as LinkedIn shows it to you. This is sent only to Scouty, stored in your workspace,
processed by Scouty's AI provider to write suggestions, and deleted as described in Scouty's
privacy policy. It is not sold or shared with anyone else. Our use of this data follows the Chrome
Web Store User Data Policy, including the Limited Use requirements.

Opening a profile is a profile view the person may see. Using automated tools on LinkedIn is
against LinkedIn's User Agreement, and LinkedIn may restrict accounts that use them. You use this
extension at your own risk.

## In detail

| Question | Answer |
| --- | --- |
| Which pages are read | Six pages of the one person you chose: the profile, its experience and skills detail pages, and the posts, comments and reactions activity pages. Never the contact-info overlay, your messages, your feed or any other page. |
| When | Only after you press Capture, in the tab you are looking at. Nothing runs in the background and nothing is queued. |
| Where it is sent | Only to the Scouty app (`https://scouty.to`). The extension has no other network destination and sends no analytics. |
| What is stored in the browser | Your Scouty connection (a short-lived access token in memory, a refresh token in the extension's local storage) and the fact that you accepted the first-run notice. Captured content is held in memory only while it is being sent. |
| Permissions | `scripting` to read the page you chose; `storage` for the items above; `identity` to sign you in to Scouty; access to `linkedin.com/in/*` (the only pages read) and to the Scouty origin (the only place data is sent). |
| Remote code | None. Everything the extension runs is in the package. |

This text needs legal sign-off before the extension is listed in a store (see RELEASE.md).
