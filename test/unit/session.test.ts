import { afterEach, describe, expect, it } from "vitest";
import * as auth from "../../src/background/auth";
import * as outbox from "../../src/background/outbox";
import {
  EVENT_TYPES, IDLE, PAGE_STATE_STOPS, PHASES, noticeFor, transition,
  type CaptureEvent, type CaptureState, type DoneResult, type EventType, type Phase,
} from "../../src/background/session";
import { ApiError, NetworkError } from "../../src/background/api";
import { captureUi } from "../../src/background/ui-state";
import { validateManifest, type Manifest, type SectionName, type StopReason } from "../../src/protocol";
import { fake } from "../helpers/fake-ext";
import { okResult, PROFILE_URL, rig, TAB } from "../helpers/session";
import { samplePayload, unwire } from "../helpers/stub";

afterEach(() => unwire());

const caps = { posts: 50, comments: 50, reactions: 50 };
const result: DoneResult = { completeness: "complete", captured: { profileSections: 1, posts: 1, comments: 0, reactions: 0 }, appUrl: "https://scouty.to/dashboard", stop: null, address: null, sections: [], notExpanded: false };
const expected: SectionName[] = ["profile", "experience", "skills", "posts"];

const samples: Record<Phase, CaptureState> = {
  idle: IDLE,
  starting: { phase: "starting", tabId: TAB, profileKey: "k" },
  running: { phase: "running", tabId: TAB, profileKey: "k", section: "profile", count: 0, loading: true, expected, caps, finished: [] },
  stopped: { phase: "stopped", tabId: TAB, reason: "user_stopped", address: null },
  finalizing: { phase: "finalizing", tabId: TAB, stop: null, address: null, blocked: "offline", slow: false },
  done: { phase: "done", tabId: TAB, result },
};
const events: Record<EventType, CaptureEvent> = {
  capture: { type: "capture", tabId: TAB, profileKey: "k" },
  created: { type: "created", expected, caps },
  recent: { type: "recent", notice: { kind: "recent", finalizedAt: "2026-11-20T00:00:00.000Z", tabId: TAB, url: PROFILE_URL } },
  failed: { type: "failed", notice: { kind: "failed" } },
  loaded: { type: "loaded" },
  progress: { type: "progress", section: "profile", count: 3 },
  sectionDone: { type: "sectionDone", section: "profile" },
  stop: { type: "stop", reason: "user_stopped", address: null },
  settled: { type: "settled" },
  blocked: { type: "blocked", by: "auth" },
  slow: { type: "slow" },
  resume: { type: "resume" },
  finalized: { type: "finalized", result },
  dismiss: { type: "dismiss" },
  expired: { type: "expired" },
};

/** Every legal transition and the phase it lands in. Every other pair must be refused. */
const LEGAL: Record<Phase, Partial<Record<EventType, Phase>>> = {
  idle: { capture: "starting", dismiss: "idle" },
  starting: { created: "running", recent: "idle", failed: "idle", expired: "idle" },
  running: { loaded: "running", progress: "running", sectionDone: "running", stop: "stopped", failed: "idle", expired: "idle" },
  stopped: { settled: "finalizing", failed: "idle", expired: "idle" },
  finalizing: { blocked: "finalizing", slow: "finalizing", resume: "finalizing", finalized: "done", failed: "idle", expired: "idle" },
  done: { dismiss: "idle", capture: "starting" },
};

describe("state machine: every state × event pair", () => {
  for (const phase of PHASES) {
    for (const type of EVENT_TYPES) {
      const target = LEGAL[phase][type];
      it(`${phase} + ${type} → ${target ?? "refused"}`, () => {
        const before = structuredClone(samples[phase]);
        const next = transition(samples[phase], events[type]);
        expect(samples[phase]).toEqual(before); // never mutated
        if (target) expect(next?.phase).toBe(target);
        else expect(next).toBeNull();
      });
    }
  }

  it("covers all 6 × 15 pairs", () => {
    expect(PHASES.length * EVENT_TYPES.length).toBe(90);
    expect(Object.keys(samples).sort()).toEqual([...PHASES].sort());
    expect(Object.keys(events).sort()).toEqual([...EVENT_TYPES].sort());
  });

  it("walks the sections in order and finalizes after the last", () => {
    let state = transition(samples.starting, events.created)!;
    const seen: string[] = [];
    while (state.phase === "running") {
      seen.push(state.section);
      state = transition(state, { type: "sectionDone", section: state.section })!;
    }
    expect(seen).toEqual(expected);
    expect(state).toMatchObject({ phase: "finalizing", stop: null, blocked: null });
  });

  it("refuses progress or completion for a section that is not the current one, and resume when nothing blocks", () => {
    expect(transition(samples.running, { type: "progress", section: "posts", count: 1 })).toBeNull();
    expect(transition(samples.running, { type: "sectionDone", section: "posts" })).toBeNull();
    expect(transition({ ...samples.finalizing, blocked: null } as CaptureState, events.resume)).toBeNull();
    expect(transition(samples.starting, { type: "created", expected: [], caps })).toBeNull();
  });

  it("a refused event has no side effects on the controller", async () => {
    const r = await rig();
    await r.controller.dismiss();
    await r.controller.resume();
    await r.controller.userStop();
    await r.controller.tabRemoved(TAB);
    await r.controller.readerResult(TAB, "profile", 1, okResult("profile", 1));
    expect(await r.controller.readerHello(TAB)).toEqual({ args: null });
    expect(await r.phase()).toBe("idle");
    expect(r.stub.state.requests).toEqual([]);
    expect(r.injected).toEqual([]);
    expect(r.tab.updates).toEqual([]);
  });
});

const manifestOf = (r: Awaited<ReturnType<typeof rig>>): Manifest => [...r.stub.state.captures.values()][0]!.manifest!;
const line = (m: Manifest): string[] => m.sections.map((e) => `${e.section}:${e.state}:${e.reason}`);

describe("capture controller", () => {
  it("happy path: six pages, one PUT per section, finalize, done", async () => {
    const r = await rig();
    expect(await r.controller.start({ tabId: TAB, url: PROFILE_URL + "?trk=x#y", recapture: false })).toBe("started");
    await r.readAll();
    const state = await r.controller.current();
    expect(state).toMatchObject({ phase: "done", result: { completeness: "complete", stop: null, captured: { profileSections: 3, posts: 1, comments: 1, reactions: 1 } } });
    // The profile page was already open; the other five were opened with tabs.update, built from the key.
    expect(r.tab.updates).toEqual([
      "https://www.linkedin.com/in/synthetic-person-one/details/experience/", "https://www.linkedin.com/in/synthetic-person-one/details/skills/",
      "https://www.linkedin.com/in/synthetic-person-one/recent-activity/all/", "https://www.linkedin.com/in/synthetic-person-one/recent-activity/comments/",
      "https://www.linkedin.com/in/synthetic-person-one/recent-activity/reactions/",
    ]);
    expect(r.injected.filter((f) => f === "reader.js")).toHaveLength(6);
    const create = r.stub.state.requests[0]!;
    expect(create).toMatchObject({ method: "POST", path: "/api/linkedin/ext/captures" });
    expect(r.stub.state.requests.filter((q) => q.method === "PUT")).toHaveLength(6);
    const manifest = manifestOf(r);
    expect(validateManifest(manifest, ["profile", "experience", "skills", "posts", "comments", "reactions"])).toMatchObject({ ok: true });
    expect(manifest.sections.every((e) => e.state === "complete")).toBe(true);
    expect(manifest.stop).toBeNull();
  });

  it("start is idempotent: a second press is a no-op, and another profile is told a capture is running", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    expect(await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false })).toBe("busy");
    expect(await r.controller.start({ tabId: 99, url: "https://www.linkedin.com/in/synthetic-person-two/", recapture: false })).toBe("busy");
    expect(r.stub.state.requests.filter((q) => q.path === "/api/linkedin/ext/captures")).toHaveLength(1);
    expect(await r.controller.start({ tabId: 5, url: "https://www.linkedin.com/feed/", recapture: false })).toBe("not_profile");
    expect(await r.controller.start({ tabId: 5, url: "https://evil.example/in/synthetic-person-one/", recapture: false })).toBe("not_profile");
  });

  it("a recent capture offers reuse, and Capture again sends recapture: true", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.readAll();
    await r.controller.dismiss();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    const state = await r.controller.current();
    expect(state).toMatchObject({ phase: "idle", notice: { kind: "recent", tabId: TAB } });
    expect(r.injected.filter((f) => f === "reader.js")).toHaveLength(6); // nothing was read again
    const bodies: string[] = [];
    const original = r.stub.handle.bind(r.stub);
    r.stub.handle = (request) => { if (request.method === "POST" && request.url.endsWith("/captures")) bodies.push(new TextDecoder().decode(request.body)); return original(request); };
    r.tab.info = { url: PROFILE_URL, status: "complete" };
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: true });
    expect(JSON.parse(bodies[0]!)).toEqual({ linkedinUrl: PROFILE_URL, recapture: true });
    expect(await r.phase()).toBe("running");
  });

  it("the reader gets its arguments only in the capture tab while running", async () => {
    const r = await rig({ caps: { posts: 30, comments: 0, reactions: 500 } });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.controller.settledWork();
    expect(await r.controller.readerHello(99)).toEqual({ args: null });
    expect(await r.controller.readerHello(TAB)).toEqual({ args: { section: "profile", profileKey: "synthetic-person-one", seq: 1, cap: 0, browser: "chrome" } });
    await r.read(); await r.read(); await r.read();
    expect((await r.controller.readerHello(TAB)).args).toMatchObject({ section: "posts", cap: 30 });
    await r.read();
    // comments has cap 0 and is not expected; the reactions cap is clamped to 100.
    expect((await r.controller.readerHello(TAB)).args).toMatchObject({ section: "reactions", cap: 100 });
  });

  it("user stop: the current section is uploaded as partial, later ones are skipped", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read(); await r.read(); await r.read();
    await r.controller.userStop();
    expect(await r.controller.readerProgress(TAB, "posts", 2)).toEqual({ stop: true });
    await r.read((section, seq) => ({ kind: "read", payload: samplePayload(section, seq), state: "partial", reason: "user_stopped", clickLog: [] }));
    const state = await r.controller.current();
    expect(state).toMatchObject({ phase: "done", result: { completeness: "partial", stop: "user_stopped" } });
    const manifest = manifestOf(r);
    expect(manifest.stop).toBe("user_stopped");
    expect(line(manifest)).toEqual([
      "profile:complete:null", "experience:complete:null", "skills:complete:null",
      "posts:partial:user_stopped", "comments:skipped:user_stopped", "reactions:skipped:user_stopped",
    ]);
    expect(validateManifest(manifest, [...manifest.sections.map((e) => e.section)])).toMatchObject({ ok: true });
    expect([...r.stub.state.captures.values()][0]!.sections.has("posts")).toBe(true);
    expect(r.tab.updates).toHaveLength(3); // comments and reactions were never opened
  });

  it("user stop while a page is still loading stops without waiting for a reader", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.controller.settledWork();
    await r.controller.userStop();
    r.timers.find((t) => t.ms === 6000)!.fire();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await r.controller.settledWork();
    expect(await r.controller.current()).toMatchObject({ phase: "done", result: { completeness: "insufficient", stop: "user_stopped" } });
    expect(line(manifestOf(r))[0]).toBe("profile:skipped:user_stopped");
  });

  it.each(PAGE_STATE_STOPS)("a page-state stop (%s) discards that section and never uploads it", async (reason) => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read(); await r.read(); await r.read();
    await r.read(() => ({ kind: "stopped", reason, address: reason === "wrong_profile" ? "https://www.linkedin.com/in/synthetic-person-renamed/" : null, clickLog: [] }));
    const state = await r.controller.current();
    expect(state).toMatchObject({ phase: "done", result: { stop: reason, completeness: "partial" } });
    expect(r.stub.state.requests.some((q) => q.method === "PUT" && q.path.endsWith("/posts"))).toBe(false);
    expect(line(manifestOf(r))).toEqual([
      "profile:complete:null", "experience:complete:null", "skills:complete:null",
      `posts:skipped:${reason}`, `comments:skipped:${reason}`, `reactions:skipped:${reason}`,
    ]);
  });

  it("a page-state stop on the first page uploads nothing and is recorded as insufficient", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read(() => ({ kind: "stopped", reason: "reduced_profile", address: null, clickLog: [] }));
    expect(await r.controller.current()).toMatchObject({ phase: "done", result: { completeness: "insufficient", stop: "reduced_profile" } });
    expect(r.stub.state.requests.filter((q) => q.method === "PUT")).toEqual([]);
    expect(manifestOf(r).sections.every((e) => e.state === "skipped" && e.reason === "reduced_profile")).toBe(true);
  });

  it("the tab closing stops the capture", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    r.tab.info = null;
    await r.controller.tabRemoved(TAB);
    expect(await r.controller.current()).toMatchObject({ phase: "done", result: { stop: "tab_closed", completeness: "partial" } });
    expect(line(manifestOf(r)).slice(0, 2)).toEqual(["profile:complete:null", "experience:skipped:tab_closed"]);
    // Another tab closing changes nothing.
    await r.controller.tabRemoved(12345);
  });

  it("leaving /in/ (sign-in or checkpoint pages live elsewhere) stops with left_linkedin", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    // The address of a page outside the host permission is not visible to the extension.
    r.tab.info = { url: undefined, status: "complete" };
    await r.controller.tabLoaded(TAB);
    expect(await r.controller.current()).toMatchObject({ phase: "done", result: { stop: "left_linkedin" } });
    expect(captureUi(await r.controller.current(), { clickLog: [], minutesLeft: null }, "W", 0)).toEqual({ kind: "linkedinSignIn", workspace: "W" });
  });

  it("a LinkedIn page outside /in/ is never read, even where the browser would allow it", async () => {
    // Chromium grants host permissions per host, so a sign-in or checkpoint page on
    // www.linkedin.com is visible and injectable. The controller refuses it by address.
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    const injectedBefore = r.injected.length;
    r.tab.info = { url: "https://www.linkedin.com/checkpoint/challenge/", status: "complete" };
    await r.controller.tabLoaded(TAB);
    expect(await r.controller.current()).toMatchObject({ phase: "done", result: { stop: "left_linkedin" } });
    expect(r.injected.length).toBe(injectedBefore);
    expect(await r.controller.start({ tabId: TAB, url: "https://www.linkedin.com/feed/", recapture: false })).toBe("not_profile");
  });

  it("a redirect to another slug stops with wrong_profile and shows the address LinkedIn uses", async () => {
    const r = await rig();
    r.tab.info = { url: PROFILE_URL, status: "complete" };
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.controller.settledWork();
    r.tab.info = { url: "https://www.linkedin.com/in/renamed-person/details/experience/", status: "complete" };
    const frozen = r.tab.info;
    // LinkedIn answers the next navigation with the other slug.
    const hello = await r.controller.readerHello(TAB);
    const done = r.controller.readerResult(TAB, "profile", hello.args!.seq, okResult("profile", 1));
    // keep the redirected address whatever the controller asks for
    Object.defineProperty(r.tab, "info", { get: () => frozen, set: () => undefined, configurable: true });
    await done;
    await r.controller.settledWork();
    const state = await r.controller.current();
    expect(state).toMatchObject({ phase: "done", result: { stop: "wrong_profile", address: "https://www.linkedin.com/in/renamed-person/" } });
    expect(captureUi(state, { clickLog: [], minutesLeft: null }, "W", 0)).toEqual({ kind: "addressChanged", address: "https://www.linkedin.com/in/renamed-person/", workspace: "W" });
    expect(r.injected.filter((f) => f === "reader.js")).toHaveLength(1);
  });

  it("an empty activity page is declared unavailable and not uploaded; an unreadable page is skipped: read_failed", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read(); await r.read(); await r.read();
    await r.read((section, seq) => { const payload = samplePayload(section, seq); payload.read = "empty"; payload.blocks = []; payload.blockCount = 0; return { kind: "read", payload, state: "complete", reason: null, clickLog: [] }; });
    await r.read(() => ({ kind: "failed", clickLog: [] }));
    await r.read();
    expect(line(manifestOf(r)).slice(3)).toEqual(["posts:unavailable:no_such_section", "comments:skipped:read_failed", "reactions:complete:null"]);
    expect(await r.controller.current()).toMatchObject({ phase: "done", result: { completeness: "partial" } });
  });

  it("a section that ran out of time is uploaded as partial and the capture goes on", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read(); await r.read(); await r.read();
    await r.read((section, seq) => ({ kind: "read", payload: samplePayload(section, seq), state: "partial", reason: "timeout", clickLog: [] }));
    await r.readAll();
    const manifest = manifestOf(r);
    expect(line(manifest).slice(3)).toEqual(["posts:partial:timeout", "comments:complete:null", "reactions:complete:null"]);
    expect(manifest.stop).toBeNull();
  });

  it("expiry is noticed lazily by the next event and clears everything", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    r.clock.now += 20 * 60_000 + 1;
    expect(await r.controller.readerProgress(TAB, "experience", 3)).toEqual({ stop: true });
    expect(await r.phase()).toBe("idle");
    expect(await outbox.load()).toBeNull();
    expect(await r.controller.readerHello(TAB)).toEqual({ args: null });
  });

  it("a restarted background context picks the capture up from storage", async () => {
    const r = await rig({ capsBySlug: { "synthetic-person-one": { posts: 0, comments: 0, reactions: 0 } } });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    // The reader of the next page is running when the background is restarted.
    await r.controller.settledWork();
    const restarted = r.newController();
    await restarted.recover();
    expect((await restarted.current()).phase).toBe("running");
    // Its messages wake the new context, which carries on.
    await r.readAll();
    expect((await restarted.current()).phase).toBe("done");
    expect(r.injected.filter((f) => f === "reader.js")).toHaveLength(3);
  });

  it("a restart while a page was loading opens that page again", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    const aux = fake.session.data.get("capture.aux") as { readerActive: boolean; navigating: boolean };
    fake.session.data.set("capture.aux", { ...aux, readerActive: false, navigating: true });
    const restarted = r.newController();
    await restarted.recover();
    expect(r.tab.updates.at(-1)).toBe("https://www.linkedin.com/in/synthetic-person-one/details/experience/");
    expect((await restarted.readerHello(TAB)).args).toMatchObject({ section: "experience", seq: 2 });
  });

  it("401 after a refresh: reading stops, the outbox is kept, and reconnecting finishes the capture", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    r.stub.revokeAll();
    await r.read();
    const state = await r.controller.current();
    expect(state).toMatchObject({ phase: "finalizing", stop: "signed_out_of_scouty", blocked: "auth" });
    expect(captureUi(state, { clickLog: [], minutesLeft: null }, "W", 0)).toEqual({ kind: "connectionEnded" });
    expect(await auth.isConnected()).toBe(false);
    const box = (await outbox.load())!;
    expect(outbox.pending(box).map((s) => s.section)).toEqual(["experience"]);
    expect(r.tab.updates).toHaveLength(1); // skills was never opened
    // Reconnect in the same browser session (a new grant) and resume.
    await auth.connect();
    await r.controller.resume();
    expect(await r.controller.current()).toMatchObject({ phase: "done", result: { completeness: "partial", stop: "signed_out_of_scouty" } });
    expect(line(manifestOf(r))).toEqual([
      "profile:complete:null", "experience:complete:null", "skills:skipped:signed_out_of_scouty",
      "posts:skipped:signed_out_of_scouty", "comments:skipped:signed_out_of_scouty", "reactions:skipped:signed_out_of_scouty",
    ]);
  });

  it("404 on a held capture (started again from another browser or device, or removed in Scouty): the takenOver screen, and its outbox is cleared", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read(); // profile sent with this window's upload token
    const held = (await outbox.load())!;
    // Another browser starts the same profile: the server hands it this capture with a new token.
    const other = await r.api.createCapture({ linkedinUrl: PROFILE_URL, recapture: false }, "uuid-other-window");
    expect(other).toMatchObject({ captureId: held.captureId });
    expect("uploadToken" in other && other.uploadToken).not.toBe(held.uploadToken);
    await r.read(); // experience: PUT with the old token → 404 LINKEDIN_CAPTURE_NOT_FOUND
    const put = r.stub.state.requests.filter((q) => q.method === "PUT").at(-1)!;
    expect(put.status).toBe(404);
    const state = await r.controller.current();
    expect(state).toEqual({ phase: "idle", notice: { kind: "takenOver" } });
    expect(captureUi(state, { clickLog: [], minutesLeft: null }, "W", 0)).toEqual({ kind: "takenOver", workspace: "W" });
    expect(await outbox.load()).toBeNull();
    expect(r.tab.updates).toHaveLength(1); // nothing more of LinkedIn was opened
  });

  it("426 ends in the outdated state; 403, 429 and a refused profile have their own", async () => {
    let r = await rig({ minVersion: "9.0.0" });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    const state = await r.controller.current();
    expect(state).toEqual({ phase: "idle", notice: { kind: "outdated", storeUrl: "https://example.invalid/store" } });
    expect(captureUi(state, { clickLog: [], minutesLeft: null }, "W", 0)).toEqual({ kind: "outdated" });
    unwire();
    r = await rig();
    r.stub.state.available = false;
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    expect(await r.controller.current()).toEqual({ phase: "idle", notice: { kind: "notAvailable" } });
    unwire();
    r = await rig({ capturesLeftToday: 0 });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    expect(await r.controller.current()).toMatchObject({ phase: "idle", notice: { kind: "limit" } });
    expect(r.sleeps).toEqual([]); // an hour-long Retry-After is an answer, not a wait
    unwire();
    r = await rig({ suppressed: ["synthetic-person-one"] });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    expect(await r.controller.current()).toEqual({ phase: "idle", notice: { kind: "suppressed" } });
  });

  it("maps errors to one notice each", () => {
    expect(noticeFor(new ApiError(410, "LINKEDIN_CAPTURE_EXPIRED", null, null))).toEqual({ kind: "failed" });
    expect(noticeFor(new ApiError(404, "LINKEDIN_CAPTURE_NOT_FOUND", null, null))).toEqual({ kind: "takenOver" });
    expect(noticeFor(new ApiError(503, "LINKEDIN_DISABLED", null, null))).toEqual({ kind: "notAvailable" });
    expect(noticeFor(new ApiError(503, "LINKEDIN_UNAVAILABLE", null, null))).toEqual({ kind: "failed" });
    expect(noticeFor(new ApiError(404, "LINKEDIN_PROFILE_UNAVAILABLE", null, null), true)).toEqual({ kind: "suppressed" });
    expect(noticeFor(new ApiError(426, null, { error: "x", storeUrl: "javascript:alert(1)" }, null))).toEqual({ kind: "outdated", storeUrl: null });
    expect(noticeFor(new NetworkError("x"))).toEqual({ kind: "failed" });
  });

  // Every code in the server's LINKEDIN_EXT_ERROR_CODES ends in one screen.
  it.each([
    [401, "LINKEDIN_AUTH_REQUIRED", false, "failed"], // (a 401 is first answered with a refresh; this is the fallback)
    [404, "LINKEDIN_PROFILE_UNAVAILABLE", true, "suppressed"],
    [426, "LINKEDIN_EXTENSION_OUTDATED", false, "outdated"],
    [403, "LINKEDIN_NOT_AVAILABLE", false, "notAvailable"],
    [503, "LINKEDIN_DISABLED", false, "notAvailable"],
    [403, "LINKEDIN_ORIGIN_REFUSED", false, "failed"],
    [415, "LINKEDIN_UNSUPPORTED_MEDIA_TYPE", false, "failed"],
    [413, "LINKEDIN_PAYLOAD_TOO_LARGE", false, "failed"],
    [400, "LINKEDIN_DIGEST_MISMATCH", false, "failed"],
    [400, "LINKEDIN_INVALID_PAYLOAD", false, "failed"],
    [400, "LINKEDIN_URL_UNSUPPORTED", true, "failed"],
    [404, "LINKEDIN_CAPTURE_NOT_FOUND", false, "takenOver"],
    [410, "LINKEDIN_CAPTURE_EXPIRED", false, "failed"],
    [409, "LINKEDIN_CAPTURE_FINALIZED", false, "failed"],
    [409, "LINKEDIN_CAPTURE_TARGET_MISMATCH", false, "failed"],
    [409, "LINKEDIN_SECTION_STALE", false, "failed"],
    [409, "LINKEDIN_MANIFEST_MISMATCH", false, "failed"], // after the one reconcile
    [429, "LINKEDIN_CAPTURE_LIMIT", true, "limit"],
    [429, "LINKEDIN_RATE_LIMITED", false, "failed"], // after the bounded retries
    [503, "LINKEDIN_UNAVAILABLE", false, "failed"], // after the bounded retries
  ] as const)("%i %s → %s", (status, code, creating, kind) => {
    expect(noticeFor(new ApiError(status, code, { error: "x", code }, null), creating).kind).toBe(kind);
  });

  it("every stop reason has a screen with a way out", () => {
    const reasons: StopReason[] = ["user_stopped", "tab_closed", "logged_out", "reduced_profile", "checkpoint", "not_found", "wrong_profile", "left_linkedin", "unknown_page", "timeout", "permission_missing", "signed_out_of_scouty"];
    for (const stop of reasons) {
      const ui = captureUi({ phase: "done", tabId: TAB, result: { ...result, completeness: "partial", stop } }, { clickLog: [], minutesLeft: null }, "W", 0);
      expect(ui, stop).not.toBeNull();
    }
  });
});
