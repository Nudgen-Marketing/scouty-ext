# Privacy

Scouty B2B Prospector does one thing: when you press Capture on a lead's profile on a supported social
network, it reads that
person's profile and their recent posts, comments and reactions from the tab in front of you, and
sends that content to your Scouty workspace so Scouty can suggest how to approach them.

It only reads. It loads only the chosen person's six profile pages in your tab (the profile, its
experience and skills detail pages, and the posts, comments and reactions activity pages), as you
would by clicking, and makes no other request to the network; it never posts, clicks a button that
changes anything (it never follows, likes, comments, connects or messages), or sends anything to
the network. To read longer posts and lists it presses only inline "see more" and "show more results"
controls, which the network's own page answers as it would for you. It does not read your
password, cookies, messages, contacts or feed, and it does nothing until you press Capture. It reads one person at a
time and has no background activity.

To send captures to your workspace it signs you in to Scouty through your browser. This is the
one piece of authentication information it handles: a Scouty access token (and the refresh token
that renews it), stored only in the browser's extension storage and sent only to Scouty, for that
purpose only. It never reads your credentials for the network. You can disconnect in the extension or
revoke the connection in Scouty under Settings, Connected Apps. While a capture is being sent, its
content is held in the browser's memory so an interrupted upload can finish; it is never written to
disk and is gone as soon as Scouty confirms it or you close the browser.

Apart from that token, what it collects is about the person whose profile you capture: the text of their profile and
activity as the network shows it to you. This is sent only to Scouty, stored in your workspace,
processed by Scouty's AI provider to write suggestions, and deleted as described in Scouty's
privacy policy.

The same commitments apply in every browser the extension is offered for. The data it collects is:

- used only to provide the extension's single purpose described above, and never for anything
  else;
- not sold, and not transferred to anyone except as needed to provide that purpose (Scouty and its
  AI provider), to comply with the law, or as part of a merger or acquisition with notice to you;
- not used or transferred for advertising, including personalized or interest-based ads, and not
  used to decide anyone's creditworthiness or for lending;
- not read by people at Scouty, except with your permission, when needed for security or to
  investigate abuse, to comply with the law, or in aggregated and anonymized form for running the
  service.

The extension follows the Chrome Web Store User Data Policy, including its Limited Use
requirements, the Microsoft Edge Add-ons policies, and Mozilla's Add-on Policies.

Opening a profile is a profile view the person may see. Social networks
often don't allow automated tools like this one and may restrict accounts that use them. You use
this extension at your own risk.

## In detail

| Question | Answer |
| --- | --- |
| Which pages are read | Six pages of the one person you chose: the profile, its experience and skills detail pages, and the posts, comments and reactions activity pages. Never the contact-info overlay, your messages, your feed or any other page. |
| When | Only after you press Capture, in the tab you are looking at. Nothing is ever read in the background. The only background work is finishing a capture you started: if sending it fails (for example while you are offline), the extension keeps what was already read, in memory, and tries sending it again while the browser stays open, for up to 20 minutes; after that it is deleted. |
| Where it is sent | Only to the Scouty app (`https://scouty.to`). The extension has no other network destination and sends no analytics. |
| What is stored in the browser | Your Scouty connection, which is authentication information: a short-lived Scouty access token in memory and a refresh token in the extension's local storage, both in the browser's extension storage only and sent only to Scouty. Also the fact that you accepted the first-run notice. Captured content is held in memory only while it is being sent. |
| Data types declared to the stores | Website content and personally identifying information (the captured person's profile and activity), and authentication information (the Scouty access token and refresh token above). Chrome Web Store data usage: "Personally identifiable information", "Website content" and "Authentication information". Firefox `data_collection_permissions`: `websiteContent`, `personallyIdentifyingInfo` and `authenticationInfo`. |
| Permissions | `scripting` to read the page you chose; `storage` for the items above; `identity` to sign you in to Scouty; access to `linkedin.com/in/*` (the only pages read) and to the Scouty origin (the only place data is sent). |
| Remote code | None. Everything the extension runs is in the package. |

This text needs legal sign-off before the extension is listed in a store (see RELEASE.md).
