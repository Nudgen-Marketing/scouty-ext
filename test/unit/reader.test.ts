import { describe, expect, it } from "vitest";
import { validateSectionPayload } from "../../src/protocol";
import { readSection, uiLanguageSupported, type ReaderEnv } from "../../src/reader/index";
import type { ReaderArgs } from "../../src/messages";
import { FIXED_NOW, load, PATHS, testIsVisible, type Loaded } from "../helpers/fixture";

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
    const page = load("sdui-activity-posts", PATHS.posts);
    const e = env(page);
    const result = await readSection(args("posts"), e);
    if (result.kind !== "read") throw new Error(result.kind);
    expect(result.state).toBe("complete");
    expect(validateSectionPayload(JSON.parse(JSON.stringify(result.payload)))).toMatchObject({ ok: true });
    expect(result.payload).toMatchObject({
      section: "posts", seq: 1, pageSlug: "synthetic-person-one", capturedAt: new Date(FIXED_NOW).toISOString(),
      selectorsVersion: 3, browser: "chrome", locale: "en", read: "ok", expanded: true, reachedCap: false, blockCount: 3, profile: null,
    });
    // One expand, nothing else (the SDUI list scrolls endlessly: no load-more control); stops after three idle steps.
    expect(page.clicks.map((el) => el.getAttribute("data-testid"))).toEqual(["expandable-text-button"]);
    expect(e.progress.length).toBeGreaterThanOrEqual(3);
    expect(page.scrolls()).toBe(3);
  });

  it("stops at the cap and says so", async () => {
    const page = load("sdui-activity-posts", PATHS.posts);
    const result = await readSection(args("posts", { cap: 2 }), env(page));
    if (result.kind !== "read") throw new Error(result.kind);
    expect(result.payload.blockCount).toBe(2);
    expect(result.payload.reachedCap).toBe(true);
    expect(result.state).toBe("complete");
    expect(page.scrolls()).toBe(0);
  });

  it("reads the profile and the detail pages into valid payloads", async () => {
    const profile = await readSection(args("profile"), env(load("sdui-profile")));
    if (profile.kind !== "read") throw new Error(profile.kind);
    expect(validateSectionPayload(profile.payload)).toMatchObject({ ok: true });
    expect(profile.payload.blockCount).toBe(6);
    expect(profile.payload.profile?.name).toBe("Synthetic Person One");
    expect(profile.payload.blocks).toEqual([]);
    const skills = await readSection(args("skills"), env(load("sdui-details-skills", PATHS.skills)));
    if (skills.kind !== "read") throw new Error(skills.kind);
    expect(validateSectionPayload(skills.payload)).toMatchObject({ ok: true });
    expect(skills.payload.profile).toMatchObject({ name: null, headline: null });
  });

  it('an empty profile and a no-activity page are read: "empty"', async () => {
    const profile = await readSection(args("profile", { profileKey: "synthetic-person-two" }), env(load("sdui-profile-empty", "/in/synthetic-person-two/")));
    const posts = await readSection(args("posts", { profileKey: "synthetic-person-two" }), env(load("sdui-activity-empty", "/in/synthetic-person-two/recent-activity/all/")));
    if (profile.kind !== "read" || posts.kind !== "read") throw new Error("not read");
    expect(profile.payload.read).toBe("empty");
    expect(profile.payload.blockCount).toBe(0);
    expect(posts.payload).toMatchObject({ read: "empty", blockCount: 0, blocks: [] });
    expect(validateSectionPayload(posts.payload)).toMatchObject({ ok: true });
  });

  it("with the block selectors removed, returns one degraded block with no URNs", async () => {
    const page = load("sdui-activity-posts", PATHS.posts);
    page.doc.querySelector("[role='list']")!.removeAttribute("data-component-type");
    const result = await readSection(args("posts"), env(page));
    if (result.kind !== "read") throw new Error(result.kind);
    expect(result.payload).toMatchObject({ read: "degraded", blockCount: 1 });
    expect(result.payload.blocks[0]).toMatchObject({ urn: null, urnTime: null, truncated: true });
    expect(validateSectionPayload(result.payload)).toMatchObject({ ok: true });
  });

  it("refuses to read a different slug and reports the address LinkedIn uses", async () => {
    const page = load("sdui-profile", "/in/renamed-person/");
    const result = await readSection(args("profile"), env(page));
    expect(result).toMatchObject({ kind: "stopped", reason: "wrong_profile", address: "https://www.linkedin.com/in/renamed-person/" });
    expect(page.clicks).toHaveLength(0);
    expect(page.scrolls()).toBe(0);
  });

  it("matches the slug after normalization (case and percent-encoding)", async () => {
    const result = await readSection(args("profile"), env(load("sdui-profile", "/in/Synthetic-Person-One/")));
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
    const page = load("sdui-activity-posts", PATHS.posts);
    let steps = 0;
    const e = env(page, { onProgress: async () => { steps += 1; if (steps === 2) page.doc.body.insertAdjacentHTML("beforeend", `<div id="captcha-internal"></div>`); return "continue"; } });
    expect(await readSection(args("posts"), e)).toMatchObject({ kind: "stopped", reason: "checkpoint" });
  });

  it("an in-page navigation to another profile mid-read stops with wrong_profile and keeps nothing", async () => {
    const page = load("sdui-activity-posts", PATHS.posts);
    let steps = 0;
    const e = env(page, {
      onProgress: async () => {
        steps += 1;
        // The screen name stays the same: only the address says it is someone else now.
        if (steps === 2) page.dom.window.history.pushState({}, "", "/in/someone-else/recent-activity/all/");
        return "continue";
      },
    });
    const result = await readSection(args("posts"), e);
    expect(result).toEqual({ kind: "stopped", reason: "wrong_profile", address: "https://www.linkedin.com/in/someone-else/", clickLog: expect.any(Array) });
    expect(steps).toBe(2);
  });

  it("the final check catches a navigation to another profile during the last step", async () => {
    const page = load("sdui-activity-posts", PATHS.posts);
    const e = env(page, {
      onProgress: async () => {
        page.dom.window.history.pushState({}, "", "/in/someone-else/recent-activity/all/");
        return "stop";
      },
    });
    expect(await readSection(args("posts"), e)).toMatchObject({ kind: "stopped", reason: "wrong_profile", address: "https://www.linkedin.com/in/someone-else/" });
  });

  it("a navigation off the profile pages mid-read stops with left_linkedin", async () => {
    const page = load("sdui-activity-posts", PATHS.posts);
    const e = env(page, { onProgress: async () => { page.dom.window.history.pushState({}, "", "/feed/"); return "continue"; } });
    expect(await readSection(args("posts"), e)).toMatchObject({ kind: "stopped", reason: "left_linkedin", address: null });
  });

  it("a user stop keeps what was read, as partial", async () => {
    const page = load("sdui-activity-posts", PATHS.posts);
    const result = await readSection(args("posts"), env(page, { onProgress: async () => "stop" }));
    expect(result).toMatchObject({ kind: "read", state: "partial", reason: "user_stopped" });
    if (result.kind === "read") expect(result.payload.blockCount).toBe(3);
  });

  it('with <html lang="de"> nothing is clicked and expanded is false', async () => {
    const page = load("sdui-activity-posts", PATHS.posts);
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
    const page = load("sdui-profile");
    for (const [lang, ok] of [["en", true], ["en-US", true], ["vi", true], ["vi_VN", true], ["de", false], ["", false]] as const) {
      page.doc.documentElement.setAttribute("lang", lang);
      expect(uiLanguageSupported(page.doc)).toBe(ok);
    }
  });

  it("holds the payload under the byte budget and sets reachedCap", async () => {
    const page = load("sdui-activity-posts", PATHS.posts);
    const list = page.doc.querySelector("[role='list']")!;
    const big = "🙂".repeat(1990); // 3,980 UTF-16 units, 7,960 UTF-8 bytes per block
    for (let i = 0; i < 200; i += 1) {
      list.insertAdjacentHTML("beforeend", `<div role="listitem"><span data-testid="expandable-text-box">${big}</span><a href="/feed/update/urn:li:activity:71303168000000${String(10000 + i)}/">x</a></div>`);
    }
    const result = await readSection(args("posts", { cap: 100 }), env(page));
    if (result.kind !== "read") throw new Error(result.kind);
    const bytes = new TextEncoder().encode(JSON.stringify(result.payload)).length;
    expect(bytes).toBeLessThanOrEqual(1_200_000);
    expect(result.payload.blockCount).toBe(100);
    expect(result.payload.reachedCap).toBe(true);
    expect(validateSectionPayload(result.payload)).toMatchObject({ ok: true });
  });
  it("a page on another screen than the section's stops with unknown_page and reads nothing", async () => {
    const page = load("sdui-activity-posts", PATHS.comments);
    const result = await readSection(args("comments"), env(page));
    expect(result).toMatchObject({ kind: "stopped", reason: "unknown_page" });
    expect(page.clicks).toHaveLength(0);
    expect(page.scrolls()).toBe(0);
  });

  it.each([["/uas/login?session_redirect=%2Fin%2Fsynthetic-person-one%2F", "logged_out"], ["/authwall?trk=x", "logged_out"], ["/checkpoint/challenge/x", "checkpoint"]])(
    "the address %s stops with %s before anything is read", async (path, reason) => {
      const page = load("sdui-profile", path);
      expect(await readSection(args("profile"), env(page))).toMatchObject({ kind: "stopped", reason });
      expect(page.clicks).toHaveLength(0);
    });

  it("on the profile, waits for the top card LinkedIn draws late after a navigation", async () => {
    const page = load("sdui-profile-nested");
    const marker = page.doc.querySelector("[id$='Topcard']")!;
    const held = marker.innerHTML;
    marker.innerHTML = "";
    marker.id = "pending";
    let waits = 0;
    const e = env(page, {
      wait: async () => {
        waits += 1;
        // Later than the scroll loop alone would wait (it ends after three idle steps).
        if (waits === 8) {
          marker.id = "com.linkedin.sdui.profile.card.ref0000001Topcard";
          marker.innerHTML = held;
        }
      },
    });
    const result = await readSection(args("profile"), e);
    if (result.kind !== "read") throw new Error(result.kind);
    expect(result.payload.profile).toMatchObject({ name: "Synthetic Person One", headline: "Head of Placeholder Operations at Example Fabrication Co" });
  });

  it("on the profile, reads on without a name when the top card never comes", async () => {
    const page = load("sdui-profile-nested");
    page.doc.querySelector("[id$='Topcard']")!.remove();
    let waits = 0;
    const result = await readSection(args("profile"), env(page, { wait: async () => { waits += 1; } }));
    if (result.kind !== "read") throw new Error(result.kind);
    expect(result.payload.profile?.name).toBeNull();
    expect(result.payload.profile?.sections.map((s) => s.label)).toEqual(["About", "Experience"]);
    expect(waits).toBeGreaterThanOrEqual(20);
  });

  it("waits while LinkedIn's loader shows and reads the items it brings", async () => {
    const page = load("sdui-activity-posts", PATHS.posts);
    const main = page.doc.querySelector("main")!;
    const list = page.doc.querySelector("[role='list']")!;
    let waits = 0;
    // After the first scroll the loader shows for two pauses, then two more items arrive.
    page.dom.window.scrollBy = (() => { if (!page.doc.querySelector("[data-testid='loader']") && waits === 0) main.insertAdjacentHTML("beforeend", `<div data-testid="loader"></div>`); }) as typeof page.dom.window.scrollBy;
    const e = env(page, {
      wait: async () => {
        waits += 1;
        if (waits === 3) {
          page.doc.querySelector("[data-testid='loader']")?.remove();
          for (const n of [1, 2]) list.insertAdjacentHTML("beforeend", `<div role="listitem"><span data-testid="expandable-text-box">Lazy invented post ${n}.</span></div>`);
        }
      },
    });
    const result = await readSection(args("posts"), e);
    if (result.kind !== "read") throw new Error(result.kind);
    expect(result.payload.blockCount).toBe(5);
  });
});
