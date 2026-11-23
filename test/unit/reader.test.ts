import { describe, expect, it } from "vitest";
import { validateSectionPayload } from "../../src/protocol";
import { readSection, uiLanguageSupported, type ReaderEnv } from "../../src/reader/index";
import type { ReaderArgs } from "../../src/messages";
import { FIXED_NOW, load, testIsVisible, type Loaded } from "../helpers/fixture";

const args = (section: ReaderArgs["section"], over: Partial<ReaderArgs> = {}): ReaderArgs =>
  ({ section, profileKey: "synthetic-person-one", seq: 1, cap: 50, browser: "chrome", ...over });

function env(page: Loaded, over: Partial<ReaderEnv> = {}): ReaderEnv & { progress: number[] } {
  const progress: number[] = [];
  return {
    doc: page.doc, isVisible: testIsVisible, wait: async () => undefined, random: () => 0, now: () => FIXED_NOW,
    onProgress: async (count) => { progress.push(count); return "continue"; },
    progress, ...over,
  };
}

describe("reader", () => {
  it("reads the posts page into a valid payload", async () => {
    const page = load("activity-posts", "/in/synthetic-person-one/recent-activity/all/");
    const e = env(page);
    const result = await readSection(args("posts"), e);
    if (result.kind !== "read") throw new Error(result.kind);
    expect(result.state).toBe("complete");
    expect(validateSectionPayload(JSON.parse(JSON.stringify(result.payload)))).toMatchObject({ ok: true });
    expect(result.payload).toMatchObject({
      section: "posts", seq: 1, pageSlug: "synthetic-person-one", capturedAt: new Date(FIXED_NOW).toISOString(),
      selectorsVersion: 1, browser: "chrome", locale: "en", read: "ok", expanded: true, reachedCap: false, blockCount: 3, profile: null,
    });
    // One expand, then one load-more after three idle steps; nothing else.
    expect(page.clicks.map((el) => el.textContent)).toEqual(["…see more", "Show more results"]);
    expect(e.progress.length).toBeGreaterThanOrEqual(6);
    expect(page.scrolls()).toBe(6);
  });

  it("stops at the cap and says so", async () => {
    const page = load("activity-posts", "/in/synthetic-person-one/recent-activity/all/");
    const result = await readSection(args("posts", { cap: 2 }), env(page));
    if (result.kind !== "read") throw new Error(result.kind);
    expect(result.payload.blockCount).toBe(2);
    expect(result.payload.reachedCap).toBe(true);
    expect(result.state).toBe("complete");
    expect(page.scrolls()).toBe(0);
  });

  it("reads the profile and the detail pages into valid payloads", async () => {
    const profile = await readSection(args("profile"), env(load("profile")));
    if (profile.kind !== "read") throw new Error(profile.kind);
    expect(validateSectionPayload(profile.payload)).toMatchObject({ ok: true });
    expect(profile.payload.blockCount).toBe(4);
    expect(profile.payload.profile?.name).toBe("Synthetic Person One");
    expect(profile.payload.blocks).toEqual([]);
    const skills = await readSection(args("skills"), env(load("details-skills", "/in/synthetic-person-one/details/skills/")));
    if (skills.kind !== "read") throw new Error(skills.kind);
    expect(validateSectionPayload(skills.payload)).toMatchObject({ ok: true });
    expect(skills.payload.profile).toMatchObject({ name: null, headline: null });
  });

  it('an empty profile and a no-activity page are read: "empty"', async () => {
    const profile = await readSection(args("profile", { profileKey: "synthetic-person-two" }), env(load("profile-empty", "/in/synthetic-person-two/")));
    const posts = await readSection(args("posts", { profileKey: "synthetic-person-two" }), env(load("activity-empty", "/in/synthetic-person-two/recent-activity/all/")));
    if (profile.kind !== "read" || posts.kind !== "read") throw new Error("not read");
    expect(profile.payload.read).toBe("empty");
    expect(profile.payload.blockCount).toBe(0);
    expect(posts.payload).toMatchObject({ read: "empty", blockCount: 0, blocks: [] });
    expect(validateSectionPayload(posts.payload)).toMatchObject({ ok: true });
  });

  it("with the block selectors removed, returns one degraded block with no URNs", async () => {
    const page = load("activity-posts", "/in/synthetic-person-one/recent-activity/all/");
    for (const el of Array.from(page.doc.querySelectorAll(".feed-shared-update-v2"))) { el.className = "x"; el.removeAttribute("data-urn"); }
    const result = await readSection(args("posts"), env(page));
    if (result.kind !== "read") throw new Error(result.kind);
    expect(result.payload).toMatchObject({ read: "degraded", blockCount: 1 });
    expect(result.payload.blocks[0]).toMatchObject({ urn: null, urnTime: null, truncated: true });
    expect(validateSectionPayload(result.payload)).toMatchObject({ ok: true });
  });

  it("refuses to read a different slug and reports the address LinkedIn uses", async () => {
    const page = load("profile", "/in/renamed-person/");
    const result = await readSection(args("profile"), env(page));
    expect(result).toMatchObject({ kind: "stopped", reason: "wrong_profile", address: "https://www.linkedin.com/in/renamed-person/" });
    expect(page.clicks).toHaveLength(0);
    expect(page.scrolls()).toBe(0);
  });

  it("matches the slug after normalization (case and percent-encoding)", async () => {
    const result = await readSection(args("profile"), env(load("profile", "/in/Synthetic-Person-One/")));
    expect(result.kind).toBe("read");
    if (result.kind === "read") expect(result.payload.pageSlug).toBe("Synthetic-Person-One");
  });

  it.each([
    ["reduced-profile", "reduced_profile"], ["authwall", "logged_out"], ["checkpoint", "checkpoint"],
    ["not-found", "not_found"], ["unrelated", "unknown_page"],
  ])("%s stops with %s and reads nothing", async (name, reason) => {
    const page = load(name);
    const result = await readSection(args("profile"), env(page));
    expect(result).toMatchObject({ kind: "stopped", reason });
    expect(page.clicks).toHaveLength(0);
    expect(page.scrolls()).toBe(0);
  });

  it("discards everything when a checkpoint appears mid-scroll", async () => {
    const page = load("activity-posts", "/in/synthetic-person-one/recent-activity/all/");
    let steps = 0;
    const e = env(page, { onProgress: async () => { steps += 1; if (steps === 2) page.doc.body.insertAdjacentHTML("beforeend", `<div id="captcha-internal"></div>`); return "continue"; } });
    expect(await readSection(args("posts"), e)).toMatchObject({ kind: "stopped", reason: "checkpoint" });
  });

  it("a user stop keeps what was read, as partial", async () => {
    const page = load("activity-posts", "/in/synthetic-person-one/recent-activity/all/");
    const result = await readSection(args("posts"), env(page, { onProgress: async () => "stop" }));
    expect(result).toMatchObject({ kind: "read", state: "partial", reason: "user_stopped" });
    if (result.kind === "read") expect(result.payload.blockCount).toBe(3);
  });

  it('with <html lang="de"> nothing is clicked and expanded is false', async () => {
    const page = load("activity-posts", "/in/synthetic-person-one/recent-activity/all/");
    page.doc.documentElement.setAttribute("lang", "de");
    expect(uiLanguageSupported(page.doc)).toBe(false);
    const result = await readSection(args("posts"), env(page));
    if (result.kind !== "read") throw new Error(result.kind);
    expect(page.clicks).toHaveLength(0);
    expect(result.payload.expanded).toBe(false);
    expect(result.payload.locale).toBe("de");
    expect(result.payload.blocks[1]!.truncated).toBe(true);
    expect(page.scrolls()).toBeGreaterThan(0);
  });

  it("supports en and vi page languages, with region tags", () => {
    const page = load("profile");
    for (const [lang, ok] of [["en", true], ["en-US", true], ["vi", true], ["vi_VN", true], ["de", false], ["", false]] as const) {
      page.doc.documentElement.setAttribute("lang", lang);
      expect(uiLanguageSupported(page.doc)).toBe(ok);
    }
  });

  it("holds the payload under the byte budget and sets reachedCap", async () => {
    const page = load("activity-posts", "/in/synthetic-person-one/recent-activity/all/");
    const list = page.doc.querySelector(".scaffold-finite-scroll__content")!;
    const big = "🙂".repeat(1990); // 3,980 UTF-16 units, 7,960 UTF-8 bytes per block
    for (let i = 0; i < 200; i += 1) {
      list.insertAdjacentHTML("beforeend", `<div class="feed-shared-update-v2" data-urn="urn:li:activity:71303168000000${String(10000 + i)}"><div class="update-components-text">${big}</div></div>`);
    }
    const result = await readSection(args("posts", { cap: 100 }), env(page));
    if (result.kind !== "read") throw new Error(result.kind);
    const bytes = new TextEncoder().encode(JSON.stringify(result.payload)).length;
    expect(bytes).toBeLessThanOrEqual(1_200_000);
    expect(result.payload.blockCount).toBe(100);
    expect(result.payload.reachedCap).toBe(true);
    expect(validateSectionPayload(result.payload)).toMatchObject({ ok: true });
  });
});
