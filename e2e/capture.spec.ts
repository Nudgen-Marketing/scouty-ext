import { expect, expectOnlyExpandClicks, expectReadOnly, heading, test } from "./harness";

const SLUG = "synthetic-person-one";

/** Connect, accept the first-run consent and start a capture of the tab. */
async function startCapture(rig: Parameters<Parameters<typeof test>[2]>[0]["rig"], slug: string) {
  const { page, tabId } = await rig.openProfile(slug);
  const popup = await rig.openPopup(tabId);
  await expect(heading(popup)).toHaveText("Connect to Scouty");
  await rig.connect(popup);
  await expect(heading(popup)).toHaveText("Before you start");
  await popup.getByRole("button", { name: "Got it, capture" }).click();
  return { page, popup, tabId };
}

test("happy path: connect, consent, six pages read, finalize, open the analysis", async ({ rig }) => {
  rig.stub.state.caps = { posts: 5, comments: 5, reactions: 5 };
  const { page, popup } = await startCapture(rig, SLUG);
  await expect(heading(popup)).toHaveText(/^Reading /);
  await expect(popup.getByRole("progressbar")).toBeVisible();
  // The in-page overlay is there, says what it is (and, once, that Scouty never acts), and is closed to the page.
  await expect.poll(() => rig.overlayText(page)).toContain("Scouty never clicks or posts for you.");
  expect(await page.evaluate(() => document.querySelector("scouty-capture-overlay")?.shadowRoot ?? null)).toBeNull();
  expect(await page.evaluate(() => document.querySelector("scouty-capture-overlay")?.getAttribute("aria-label"))).toBe("Scouty capture");

  await expect(heading(popup)).toHaveText("Done");
  await expect(popup.getByText("Profile · 3 posts · 2 comments · 2 reactions", { exact: true })).toBeVisible();
  await expect.poll(() => rig.overlayText(page)).toContain("Profile · 3 posts · 2 comments · 2 reactions");
  // The finished overlay holds the counts and its two buttons, and nothing technical.
  expect(await rig.overlayText(page)).not.toMatch(/never clicks|controls pressed|selector|expandText/);

  const capture = [...rig.stub.state.captures.values()][0]!;
  expect(capture.status).toBe("finalized");
  expect(capture.result).toMatchObject({ completeness: "complete" });
  expect(capture.manifest!.sections.map((s) => `${s.section}:${s.state}`)).toEqual(["profile:complete", "experience:complete", "skills:complete", "posts:complete", "comments:complete", "reactions:complete"]);
  const posts = capture.sections.get("posts")!.payload;
  expect(posts.browser).toBe("chrome");
  expect(posts.pageSlug).toBe(SLUG);
  expect(posts.blocks[0]).toMatchObject({ urn: "urn:li:activity:7130316800000000000", urnTime: "2023-11-14T22:13:20.000Z" });
  expect(posts.blocks[1]!.text).toContain("THE-TAIL-OF-POST-TWO"); // expanded with the allowed control
  expect(posts.blocks[2]).toMatchObject({ urn: null, urnTime: null }); // a ugcPost link: no activity URN to send
  expect(posts.blocks[2]!.text.startsWith(`Synthetic Person One reposted this\n3d\n`)).toBe(true);
  const comments = capture.sections.get("comments")!.payload;
  expect(comments.blocks[0]!.urn).toBe("urn:li:activity:7127722905600000000");
  expect(comments.blocks[0]!.text.endsWith("THE-LEAD-COMMENT: an invented reply that must survive clamping.")).toBe(true);
  const profile = capture.sections.get("profile")!.payload;
  expect(profile.profile).toMatchObject({ name: "Synthetic Person One", headline: "Head of Placeholder Operations at Example Fabrication Co" });
  expect(profile.profile!.sections.map((s) => s.label)).toEqual(["About", "Experience", "Education", "Skills", "Licenses & certifications", "Languages"]);
  expect(JSON.stringify(profile)).not.toMatch(/THIS-MUST-NEVER-BE-READ|OWNER-ONLY|STRANGER|AD-TEXT|NO-HEADING|PROFILE-ACTIVITY-SNIPPET/);
  expect(JSON.stringify(capture.sections.get("experience")!.payload)).not.toContain("AD-TEXT");
  // Every capture call carried the version headers and none carried a cookie.
  for (const request of rig.stub.state.requests.filter((r) => r.path.startsWith("/api/"))) {
    expect(request.headers["x-scouty-protocol"]).toBe("1");
    expect(request.headers.cookie).toBeUndefined();
  }
  // Six page loads, each exactly once; nothing else.
  expect(rig.linkedin.requests.filter((r) => r.path.startsWith("/in/")).map((r) => r.path)).toEqual(rig.linkedin.pagesOf(SLUG));
  expectReadOnly(rig, [SLUG]);
  expectOnlyExpandClicks(await rig.clicks(page));
  // About, the experience description and the long post: each "… more" pressed once; nothing else.
  expect((await rig.clicks(page)).map((c) => c.path)).toEqual([`/in/${SLUG}/`, `/in/${SLUG}/details/experience/`, `/in/${SLUG}/recent-activity/all/`]);

  // "Open in Scouty" opens the app page the server named.
  const opened = rig.context.waitForEvent("page");
  await popup.getByRole("button", { name: "Open in Scouty" }).click();
  expect((await opened).url()).toBe(`http://scouty.test/dashboard?linkedin=${SLUG}`);
  // The popup ran under the strict CSP without a violation or an error.
  expect(rig.problems).toEqual([]);
});

test("signed out of LinkedIn: stops on the reduced profile and sends no content", async ({ rig }) => {
  const { page, popup } = await startCapture(rig, "signed-out-person");
  await expect(heading(popup)).toHaveText("Can't read this profile");
  const capture = [...rig.stub.state.captures.values()][0]!;
  expect(capture.result).toMatchObject({ completeness: "insufficient" });
  expect(capture.manifest!.stop).toBe("reduced_profile");
  expect(rig.stub.state.requests.filter((r) => r.method === "PUT")).toEqual([]);
  expect(JSON.stringify([...rig.stub.state.captures.values()])).not.toContain("REDUCED-VIEW-TEXT");
  expect(rig.linkedin.requests.filter((r) => r.path.startsWith("/in/")).map((r) => r.path)).toEqual(["/in/signed-out-person/"]);
  expectReadOnly(rig, ["signed-out-person"]);
  expect(await rig.clicks(page)).toEqual([]);
});

test("checkpoint mid-scroll: that section is discarded, earlier ones are kept, capture stops", async ({ rig }) => {
  const { page, popup } = await startCapture(rig, "checkpoint-person");
  await expect(heading(popup)).toHaveText("LinkedIn wants to check it's you");
  const capture = [...rig.stub.state.captures.values()][0]!;
  expect(capture.manifest!.stop).toBe("checkpoint");
  expect(capture.manifest!.sections.map((s) => `${s.section}:${s.state}:${s.reason}`)).toEqual([
    "profile:complete:null", "experience:complete:null", "skills:complete:null", "posts:skipped:checkpoint",
  ]);
  expect(capture.sections.has("posts")).toBe(false);
  expect(rig.stub.state.requests.some((r) => r.method === "PUT" && r.path.endsWith("/posts"))).toBe(false);
  expectReadOnly(rig, ["checkpoint-person"]);
  expectOnlyExpandClicks(await rig.clicks(page));
});

test("slug redirect: stops with the address LinkedIn uses and reads nothing from it", async ({ rig }) => {
  const { page, popup } = await startCapture(rig, SLUG);
  await expect(heading(popup)).toHaveText(/^Reading /);
  // While the profile page is being read, the person "renames" their profile: every later page redirects.
  const { SLUGS } = await import("./mock-linkedin.mjs");
  (SLUGS as Record<string, unknown>)["synthetic-person-one"] = { redirect: "renamed-person" };
  try {
    await expect(heading(popup)).toHaveText("This profile has moved");
    await expect(popup.getByText("Capture it from its new page.")).toBeVisible();
    await expect(popup.getByRole("button", { name: "Capture this page" })).toBeVisible();
    const capture = [...rig.stub.state.captures.values()][0]!;
    expect(capture.manifest!.stop).toBe("wrong_profile");
    expect(capture.manifest!.sections.map((s) => `${s.section}:${s.state}`)).toEqual(["profile:complete", "experience:skipped", "skills:skipped", "posts:skipped"]);
    expect(JSON.stringify([...capture.sections.values()].map((s) => s.payload.pageSlug))).not.toContain("renamed");
    expectReadOnly(rig, ["synthetic-person-one", "renamed-person"]);
    expectOnlyExpandClicks(await rig.clicks(page));
  } finally {
    (SLUGS as Record<string, unknown>)["synthetic-person-one"] = {};
  }
});

test("a section over the cap stops at the cap", async ({ rig }) => {
  const { page, popup } = await startCapture(rig, "many-posts-person");
  await expect(heading(popup)).toHaveText("Done");
  const posts = [...rig.stub.state.captures.values()][0]!.sections.get("posts")!.payload;
  expect(posts.blockCount).toBe(5);
  expect(posts.reachedCap).toBe(true);
  expect(posts.blocks).toHaveLength(5);
  expectReadOnly(rig, ["many-posts-person"]);
  expectOnlyExpandClicks(await rig.clicks(page));
});

test("the user presses Stop: the section being read is sent as partial, later ones are skipped", async ({ rig }) => {
  rig.stub.state.caps = { posts: 100, comments: 5, reactions: 5 };
  const { page, popup } = await startCapture(rig, "slow-person");
  await expect(heading(popup)).toHaveText("Reading posts…");
  await expect(popup.getByRole("progressbar")).toHaveAttribute("aria-valuetext", /^[5-9] of 100 posts$/, { timeout: 60_000 });
  await popup.getByRole("button", { name: "Stop" }).click();
  await expect(heading(popup)).toHaveText("Partly done");
  // What was read (posts in part; comments and reactions not at all), then why it is partial.
  await expect(popup.getByText(/^Profile · \d+ posts?$/)).toBeVisible();
  await expect(popup.getByText("You stopped early, so some parts are missing.")).toBeVisible();
  const capture = [...rig.stub.state.captures.values()][0]!;
  expect(capture.result).toMatchObject({ completeness: "partial" });
  expect(capture.manifest!.stop).toBe("user_stopped");
  expect(capture.manifest!.sections.map((s) => `${s.section}:${s.state}:${s.reason}`)).toEqual([
    "profile:complete:null", "experience:complete:null", "skills:complete:null", "posts:partial:user_stopped", "comments:skipped:user_stopped", "reactions:skipped:user_stopped",
  ]);
  expect(capture.sections.get("posts")!.blockCount).toBeGreaterThan(3);
  expect(rig.linkedin.requests.some((r) => r.path.includes("/recent-activity/comments/"))).toBe(false);
  expectReadOnly(rig, ["slow-person"]);
  expectOnlyExpandClicks(await rig.clicks(page));
});

test("network cut during upload, then restored: resumes without loading any LinkedIn page again", async ({ rig }) => {
  const { page, popup } = await startCapture(rig, SLUG);
  await expect.poll(() => rig.stub.state.captures.size).toBe(1);
  // The Scouty API becomes unreachable; LinkedIn stays up, so reading goes on.
  rig.stub.fail(/^(PUT|POST|GET) \/api\/linkedin\/ext\/captures\//, "drop", 100_000);
  await expect(heading(popup)).toHaveText("You're offline", { timeout: 200_000 });
  expect([...rig.stub.state.captures.values()][0]!.status).toBe("open");
  const loadsBefore = rig.linkedin.requests.filter((r) => r.path.startsWith("/in/")).map((r) => r.path);
  expect(loadsBefore).toEqual(rig.linkedin.pagesOf(SLUG).slice(0, 4));

  rig.stub.clearFaults();
  rig.stub.state.requests.length = 0;
  await popup.getByRole("button", { name: "Try now" }).click();
  await expect(heading(popup)).toHaveText("Done");
  const capture = [...rig.stub.state.captures.values()][0]!;
  expect(capture.result).toMatchObject({ completeness: "complete" });
  // Resume asked what the server holds, sent what was missing and finalized.
  const calls = rig.stub.state.requests.map((r) => `${r.method} ${r.path.replace(capture.id, ":id")} ${r.status}`);
  expect(calls[0]).toBe("GET /api/linkedin/ext/captures/:id 200");
  expect(calls.at(-1)).toBe("POST /api/linkedin/ext/captures/:id/finalize 200");
  expect(calls.filter((c) => c.startsWith("PUT")).length).toBeGreaterThan(0);
  // No second page load on LinkedIn.
  expect(rig.linkedin.requests.filter((r) => r.path.startsWith("/in/")).map((r) => r.path)).toEqual(loadsBefore);
  expectReadOnly(rig, [SLUG]);
  expectOnlyExpandClicks(await rig.clicks(page));
});

test("access token expired mid-capture: one refresh, then the capture completes", async ({ rig }) => {
  const { page, popup } = await startCapture(rig, SLUG);
  await expect.poll(() => rig.stub.state.captures.size).toBe(1);
  rig.stub.expireAccessTokens();
  await expect(heading(popup)).toHaveText("Done");
  const refreshes = rig.stub.state.requests.filter((r) => r.path === "/oauth/token" && r.status === 200);
  expect(refreshes.length).toBe(2); // the code exchange at connect, and exactly one refresh
  expect(rig.stub.state.requests.some((r) => r.status === 401)).toBe(true);
  expect([...rig.stub.state.captures.values()][0]!.result).toMatchObject({ completeness: "complete" });
  expectReadOnly(rig, [SLUG]);
  expectOnlyExpandClicks(await rig.clicks(page));
});

test("connection revoked mid-capture: reading stops; reconnecting finishes sending what was read", async ({ rig }) => {
  const { page, popup } = await startCapture(rig, SLUG);
  await expect.poll(() => rig.stub.state.captures.size).toBe(1);
  rig.stub.revokeAll();
  await expect(heading(popup)).toHaveText("Connect to Scouty again");
  await expect(popup.getByText("Do it in the next few minutes to finish this capture.")).toBeVisible();
  const loads = rig.linkedin.requests.filter((r) => r.path.startsWith("/in/")).length;
  expect([...rig.stub.state.captures.values()][0]!.status).toBe("open");
  await popup.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(heading(popup)).toHaveText("Partly done");
  const capture = [...rig.stub.state.captures.values()][0]!;
  expect(capture.status).toBe("finalized");
  expect(capture.manifest!.stop).toBe("signed_out_of_scouty");
  expect(capture.manifest!.sections.filter((s) => s.state === "skipped").every((s) => s.reason === "signed_out_of_scouty")).toBe(true);
  expect(rig.linkedin.requests.filter((r) => r.path.startsWith("/in/")).length).toBe(loads);
  expectReadOnly(rig, [SLUG]);
  expectOnlyExpandClicks(await rig.clicks(page));
});

test("extension below the minimum version: told to update, nothing is read", async ({ rig }) => {
  const { page, tabId } = await rig.openProfile(SLUG);
  const popup = await rig.openPopup(tabId);
  await rig.connect(popup);
  await expect(heading(popup)).toHaveText("Before you start");
  rig.stub.state.minVersion = "99.0.0";
  await popup.getByRole("button", { name: "Got it, capture" }).click();
  await expect(heading(popup)).toHaveText("Update Scouty");
  await expect(popup.getByRole("button", { name: "Update", exact: true })).toBeVisible();
  expect(rig.stub.state.captures.size).toBe(0);
  expect(rig.linkedin.requests.filter((r) => r.path.startsWith("/in/")).map((r) => r.path)).toEqual([`/in/${SLUG}/`]); // the user's own page load
  expect(await rig.clicks(page)).toEqual([]);
  expect(await page.evaluate(() => document.querySelector("scouty-capture-overlay"))).toBeNull();
});

test("recently captured: offers what Scouty has, and Capture again reads the profile again", async ({ rig }) => {
  rig.stub.state.caps = { posts: 0, comments: 0, reactions: 0 };
  const { page, popup } = await startCapture(rig, "no-activity-person");
  await expect(heading(popup)).toHaveText("Done");
  await popup.getByRole("button", { name: "Close", exact: true }).click();
  await expect(heading(popup)).toHaveText("Capture this profile");
  const loads = rig.linkedin.requests.filter((r) => r.path.startsWith("/in/")).length;
  await popup.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(heading(popup)).toHaveText("Captured today");
  await expect(popup.getByRole("button", { name: "Open in Scouty" })).toBeVisible();
  expect(rig.linkedin.requests.filter((r) => r.path.startsWith("/in/")).length).toBe(loads); // nothing was read
  expect(rig.stub.state.captures.size).toBe(1);
  await popup.getByRole("button", { name: "Capture again" }).click();
  await expect(heading(popup)).toHaveText("Done");
  expect(rig.stub.state.captures.size).toBe(2);
  expect([...rig.stub.state.captures.values()].every((c) => c.status === "finalized")).toBe(true);
  expectReadOnly(rig, ["no-activity-person"]);
  expectOnlyExpandClicks(await rig.clicks(page));
});

test("a profile with no activity: the activity sections are declared unavailable, not uploaded", async ({ rig }) => {
  rig.stub.state.caps = { posts: 5, comments: 5, reactions: 5 };
  const { page, popup } = await startCapture(rig, "no-activity-person");
  await expect(heading(popup)).toHaveText("Done");
  const capture = [...rig.stub.state.captures.values()][0]!;
  expect(capture.manifest!.sections.slice(3).map((s) => `${s.section}:${s.state}:${s.reason}`)).toEqual([
    "posts:unavailable:no_such_section", "comments:unavailable:no_such_section", "reactions:unavailable:no_such_section",
  ]);
  expect(capture.result).toMatchObject({ completeness: "complete", captured: { posts: 0, comments: 0, reactions: 0 } });
  expectReadOnly(rig, ["no-activity-person"]);
  expectOnlyExpandClicks(await rig.clicks(page));
});

test("permission not granted: the popup asks first and offers nothing else", async ({ rig }) => {
  // A required host permission cannot be removed by the extension itself, so the test does what a
  // user does: on the extension's details page it sets "Site access" to "On click", which withholds
  // both host permissions (the state Firefox starts in).
  const settings = await rig.context.newPage();
  await settings.goto(`chrome://extensions/?id=${rig.extensionId}`);
  await settings.evaluate(async (id) => {
    const dev = (globalThis as unknown as { chrome: { developerPrivate: { updateExtensionConfiguration(update: { extensionId: string; hostAccess: string }): Promise<void> } } }).chrome.developerPrivate;
    await dev.updateExtensionConfiguration({ extensionId: id, hostAccess: "ON_CLICK" });
  }, rig.extensionId);
  await settings.close();
  const sw = await rig.worker();
  expect(await sw.evaluate(() => chrome.permissions.contains({ origins: ["http://linkedin.test/in/*", "http://scouty.test/*"] }))).toBe(false);

  // Without the permission the extension cannot even see the tab's address: the newest tab is it.
  const page = await rig.context.newPage();
  await page.goto(`http://linkedin.test/in/${SLUG}/`);
  const tabId = await sw.evaluate(async () => Math.max(...(await chrome.tabs.query({})).map((tab) => tab.id ?? -1)));
  expect(await sw.evaluate(async (id) => (await chrome.tabs.get(id)).url ?? null, tabId)).toBeNull();
  const popup = await rig.openPopup(tabId);
  await expect(heading(popup)).toHaveText("Allow access");
  await expect(popup.getByRole("button", { name: "Allow" })).toBeVisible();
  await expect(popup.getByRole("button", { name: "Connect", exact: true })).toHaveCount(0);
  await expect(popup.getByRole("button", { name: "Capture", exact: true })).toHaveCount(0);
  expect(rig.stub.state.requests).toEqual([]);
  expect(rig.linkedin.requests.filter((r) => r.path.startsWith("/in/")).map((r) => r.path)).toEqual([`/in/${SLUG}/`]); // the user's own page load
  expectReadOnly(rig, [SLUG]);
  expect(await rig.clicks(page)).toEqual([]);
  expect(await page.evaluate(() => document.querySelector("scouty-capture-overlay"))).toBeNull();
});
