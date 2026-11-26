import { afterEach, describe, expect, it } from "vitest";
import * as auth from "../../src/background/auth";
import * as outbox from "../../src/background/outbox";
import {
  EVENT_TYPES, EXPIRED, IDLE, OFFLINE_RETRY_MS, PAGE_STATE_STOPS, PHASES, READER_WATCHDOG_MS, SERVER_RETRY_MS, isTransient, noticeFor, transition,
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

  it("expired lands in idle carrying the expired notice, from every phase that holds a capture", () => {
    for (const phase of ["starting", "running", "stopped", "finalizing"] as const) {
      expect(transition(samples[phase], events.expired), phase).toEqual({ phase: "idle", notice: { kind: "expired" } });
    }
    expect(EXPIRED).toEqual({ phase: "idle", notice: { kind: "expired" } });
    // Its notice is dismissed like any other, and Capture starts a new capture from it.
    expect(transition(EXPIRED, events.dismiss)).toEqual(IDLE);
    expect(transition(EXPIRED, events.capture)).toMatchObject({ phase: "starting" });
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

  it("started from another page of the profile: opens the main profile page first and reads it", async () => {
    const r = await rig();
    const activity = "https://www.linkedin.com/in/synthetic-person-one/recent-activity/all/";
    r.tab.info = { url: activity, status: "complete" };
    expect(await r.controller.start({ tabId: TAB, url: activity, recapture: false })).toBe("started");
    await r.readAll();
    expect(r.tab.updates[0]).toBe("https://www.linkedin.com/in/synthetic-person-one/");
    const manifest = manifestOf(r);
    expect(manifest.sections.find((e) => e.section === "profile")).toMatchObject({ state: "complete" });
    expect(manifest.sections.every((e) => e.state === "complete")).toBe(true);
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

  it("a recent capture keeps the app page the server names, and none when the server names none", async () => {
    const campaign = (key: string) => `/dashboard/proj_1/campaigns/camp_1?linkedin=${key}&person=person_1`;
    const r = await rig({ appPath: campaign });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.readAll();
    await r.controller.dismiss();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    expect(await r.controller.current()).toMatchObject({ phase: "idle", notice: { kind: "recent", appUrl: `https://scouty.to${campaign("synthetic-person-one")}` } });
    await r.controller.dismiss();
    r.stub.state.recentAppUrl = false;
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    const state = await r.controller.current();
    expect(state.phase === "idle" && state.notice?.kind === "recent" && "appUrl" in state.notice).toBe(false);
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

  it("leaving /in/ for an address the extension cannot see stops with left_linkedin: 'The page changed', not a sign-in", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    // The address of a page outside the host permission is not visible to the extension.
    r.tab.info = { url: undefined, status: "complete" };
    await r.controller.tabLoaded(TAB);
    expect(await r.controller.current()).toMatchObject({ phase: "done", result: { stop: "left_linkedin" } });
    expect(captureUi(await r.controller.current(), { minutesLeft: null }, "W", 0)).toEqual({ kind: "linkedinSignIn", workspace: "W", left: true });
  });

  it("a sign-in page the tab was sent to keeps its own screen (logged_out), apart from leaving", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    r.tab.info = { url: "https://www.linkedin.com/authwall?trk=x", status: "complete" };
    await r.controller.tabLoaded(TAB);
    expect(await r.controller.current()).toMatchObject({ phase: "done", result: { stop: "logged_out" } });
    expect(captureUi(await r.controller.current(), { minutesLeft: null }, "W", 0)).toEqual({ kind: "linkedinSignIn", workspace: "W" });
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
    // The address says what it is: the security check, not "left the page".
    expect(await r.controller.current()).toMatchObject({ phase: "done", result: { stop: "checkpoint" } });
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
    expect(captureUi(state, { minutesLeft: null }, "W", 0)).toEqual({ kind: "addressChanged", address: "https://www.linkedin.com/in/renamed-person/", workspace: "W" });
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

  it("expiry is noticed lazily by the next event, clears everything and says so (screen 27)", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    r.clock.now += 20 * 60_000 + 1;
    expect(await r.controller.readerProgress(TAB, "experience", 3)).toEqual({ stop: true });
    const state = await r.controller.current();
    expect(state).toEqual({ phase: "idle", notice: { kind: "expired" } });
    expect(captureUi(state, { minutesLeft: null }, "W", 0)).toEqual({ kind: "expired", workspace: "W" });
    expect(await outbox.load()).toBeNull();
    expect(await r.controller.readerHello(TAB)).toEqual({ args: null });
    // Not silent: the notice stays until the user dismisses it or captures again.
    expect(await r.controller.current()).toEqual(state);
    await r.controller.dismiss();
    expect(await r.controller.current()).toEqual(IDLE);
  });

  it("expiry while finalizing waits (offline) ends in the expired notice on the next look, with nothing sent", async () => {
    const r = await rig({ capsBySlug: { "synthetic-person-one": { posts: 0, comments: 0, reactions: 0 } } });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    r.stub.fail(/POST .*\/finalize$/, "drop", 99);
    await r.readAll();
    expect(await r.controller.current()).toMatchObject({ phase: "finalizing", blocked: "offline" });
    r.clock.now += 20 * 60_000 + 1;
    const before = r.stub.state.requests.length;
    expect(await r.controller.current()).toEqual({ phase: "idle", notice: { kind: "expired" } });
    await r.controller.resume();
    expect(r.stub.state.requests).toHaveLength(before);
    expect(await outbox.load()).toBeNull();
  });

  it("a restart after the capture ran out of time ends in the expired notice", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    await r.controller.settledWork();
    r.clock.now += 20 * 60_000 + 1;
    const restarted = r.newController();
    await restarted.recover();
    expect(await restarted.current()).toEqual({ phase: "idle", notice: { kind: "expired" } });
    expect(await outbox.load()).toBeNull();
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

  describe("a reader that is gone", () => {
    const flush = async (r: Awaited<ReturnType<typeof rig>>): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await r.controller.settledWork();
    };

    it("a reload of the page being read (not started by the extension) reads that section again, with a new seq", async () => {
      const r = await rig();
      await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
      await r.read();
      await r.controller.settledWork();
      const hello = await r.controller.readerHello(TAB);
      expect(hello.args).toMatchObject({ section: "experience", seq: 1 });
      const opened = r.tab.updates.length;
      // The user reloads: same address, the reader's document is gone.
      r.reader.alive = false;
      await r.controller.tabLoaded(TAB);
      expect(r.tab.updates).toHaveLength(opened); // not navigated: it is already the right page
      expect(r.injected.filter((f) => f === "reader.js")).toHaveLength(3);
      expect((await r.controller.readerHello(TAB)).args).toMatchObject({ section: "experience", seq: 2 });
      // A result of the old reader is ignored; the new one carries on to the end.
      await r.controller.readerResult(TAB, "experience", 1, okResult("experience", 1));
      expect(await r.controller.current()).toMatchObject({ phase: "running", section: "experience" });
      await r.readAll();
      expect(await r.controller.current()).toMatchObject({ phase: "done", result: { completeness: "complete" } });
    });

    it("the load the extension started itself, handled after its reader began, changes nothing", async () => {
      const r = await rig();
      await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
      await r.read();
      r.reader.alive = true;
      const injected = r.injected.length;
      await r.controller.tabLoaded(TAB);
      expect(r.reader.probes).toBe(1);
      expect(r.injected).toHaveLength(injected);
      expect((await r.controller.readerHello(TAB)).args).toMatchObject({ section: "experience", seq: 1 });
    });

    it("watchdog: a reader silent for 15 s that is gone is started again once; silent again, the capture ends as partial", async () => {
      const r = await rig();
      await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
      await r.read();
      await r.controller.settledWork();
      const fire = async (): Promise<void> => {
        const timer = r.timers.filter((tm) => tm.ms === READER_WATCHDOG_MS).at(-1)!;
        expect(timer).toBeDefined();
        r.timers.splice(r.timers.indexOf(timer), 1);
        r.clock.now += READER_WATCHDOG_MS;
        timer.fire();
        await flush(r);
      };
      r.reader.alive = false;
      await fire();
      expect((await r.controller.readerHello(TAB)).args).toMatchObject({ section: "experience", seq: 2 });
      expect(await r.controller.current()).toMatchObject({ phase: "running", section: "experience" });
      await fire();
      const state = await r.controller.current();
      expect(state).toMatchObject({ phase: "done", result: { stop: "timeout", completeness: "partial" } });
      expect(line(manifestOf(r)).slice(0, 2)).toEqual(["profile:complete:null", "experience:skipped:timeout"]);
      expect(captureUi(state, { minutesLeft: null }, "W", 0)).toMatchObject({ kind: "donePartial" });
    });

    it("watchdog: a reader that is still there (or still reporting) is left alone", async () => {
      const r = await rig();
      await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
      await r.controller.settledWork();
      const timer = r.timers.find((tm) => tm.ms === READER_WATCHDOG_MS)!;
      // Progress 10 s in: the check 15 s in waits for the rest of the quiet time.
      r.clock.now += 10_000;
      await r.controller.readerProgress(TAB, "profile", 1);
      r.clock.now += 5_000;
      timer.fire();
      await flush(r);
      expect(r.reader.probes).toBe(0);
      expect(r.timers.map((tm) => tm.ms)).toContain(10_000);
      // Quiet but alive: probed, and watched again.
      r.reader.alive = true;
      r.clock.now += 10_000;
      r.timers.find((tm) => tm.ms === 10_000)!.fire();
      await flush(r);
      expect(r.reader.probes).toBe(1);
      expect(await r.controller.current()).toMatchObject({ phase: "running", section: "profile" });
      expect((await r.controller.readerHello(TAB)).args).toMatchObject({ seq: 1 });
      await r.readAll();
      expect(await r.phase()).toBe("done");
    });
  });

  it("401 after a refresh: reading stops, the outbox is kept, and reconnecting finishes the capture", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    r.stub.revokeAll();
    await r.read();
    const state = await r.controller.current();
    expect(state).toMatchObject({ phase: "finalizing", stop: "signed_out_of_scouty", blocked: "auth" });
    expect(captureUi(state, { minutesLeft: null }, "W", 0)).toEqual({ kind: "connectionEnded" });
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
    expect(captureUi(state, { minutesLeft: null }, "W", 0)).toEqual({ kind: "takenOver", workspace: "W" });
    expect(await outbox.load()).toBeNull();
    expect(r.tab.updates).toHaveLength(1); // nothing more of LinkedIn was opened
  });

  describe("410 LINKEDIN_CAPTURE_EXPIRED on a held capture (Scouty's clock): screen 27, outbox cleared, not retried", () => {
    const NO_NETWORK = { capsBySlug: { "synthetic-person-one": { posts: 0, comments: 0, reactions: 0 } } };
    /** Ends the capture on the server only; this browser's clock still has time left. */
    const expireOnServer = (r: Awaited<ReturnType<typeof rig>>): void => {
      for (const capture of r.stub.state.captures.values()) capture.expiresAt = r.clock.now - 1;
    };
    const expectExpired = async (r: Awaited<ReturnType<typeof rig>>, method: string, path: RegExp): Promise<void> => {
      const answered = r.stub.state.requests.filter((q) => q.method === method && path.test(q.path));
      expect(answered.at(-1)?.status).toBe(410);
      expect(answered.filter((q) => q.status === 410)).toHaveLength(1); // not retried
      const state = await r.controller.current();
      expect(state).toEqual({ phase: "idle", notice: { kind: "expired" } });
      expect(captureUi(state, { minutesLeft: null }, "W", 0)).toEqual({ kind: "expired", workspace: "W" });
      expect(await outbox.load()).toBeNull();
      expect(r.timers.map((tm) => tm.ms)).not.toContain(SERVER_RETRY_MS);
    };

    it("on a section PUT", async () => {
      const r = await rig();
      await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
      await r.read();
      expireOnServer(r);
      await r.read();
      await expectExpired(r, "PUT", /sections\/experience$/);
      expect(r.tab.updates).toHaveLength(1); // nothing more of LinkedIn was opened
    });

    it("on finalize", async () => {
      const r = await rig(NO_NETWORK);
      await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
      const original = r.stub.handle.bind(r.stub);
      r.stub.handle = (request) => {
        if (request.method === "POST" && request.url.endsWith("/finalize")) expireOnServer(r);
        return original(request);
      };
      await r.readAll();
      await expectExpired(r, "POST", /\/finalize$/);
    });

    it("on status, when a capture waiting to be sent is resumed", async () => {
      const r = await rig(NO_NETWORK);
      await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
      r.stub.fail(/POST .*\/finalize$/, "drop", 6);
      await r.readAll();
      expect(await r.controller.current()).toMatchObject({ phase: "finalizing", blocked: "offline" });
      r.stub.clearFaults();
      expireOnServer(r);
      await r.controller.resume();
      await expectExpired(r, "GET", /\/captures\/[^/]+$/);
    });

    it("a 410 on create is not expected and stays 'failed'", async () => {
      expect(noticeFor(new ApiError(410, "LINKEDIN_CAPTURE_EXPIRED", null, null), true)).toEqual({ kind: "failed" });
    });
  });

  it("426 ends in the outdated state; 403, 429 and a refused profile have their own", async () => {
    let r = await rig({ minVersion: "9.0.0" });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    const state = await r.controller.current();
    expect(state).toEqual({ phase: "idle", notice: { kind: "outdated", storeUrl: "https://example.invalid/store" } });
    expect(captureUi(state, { minutesLeft: null }, "W", 0)).toEqual({ kind: "outdated" });
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

  it("waits out network errors, 408, 429, 502, 503 and 504; 500 and every other 5xx are terminal", () => {
    expect(isTransient(new NetworkError("x"))).toBe(true);
    for (const status of [408, 429, 502, 503, 504]) expect(isTransient(new ApiError(status, null, null, null)), String(status)).toBe(true);
    expect(isTransient(new ApiError(503, "LINKEDIN_UNAVAILABLE", null, null))).toBe(true);
    expect(isTransient(new ApiError(503, "LINKEDIN_DISABLED", null, null))).toBe(false);
    for (const status of [500, 501, 505, 507, 599, 400, 404, 409, 410]) expect(isTransient(new ApiError(status, null, null, null)), String(status)).toBe(false);
    expect(isTransient(new Error("x"))).toBe(false);
  });

  it("maps errors to one notice each", () => {
    expect(noticeFor(new ApiError(410, "LINKEDIN_CAPTURE_EXPIRED", null, null))).toEqual({ kind: "expired" });
    expect(noticeFor(new ApiError(410, null, null, null))).toEqual({ kind: "expired" });
    expect(noticeFor(new ApiError(404, "LINKEDIN_CAPTURE_NOT_FOUND", null, null))).toEqual({ kind: "takenOver" });
    expect(noticeFor(new ApiError(503, "LINKEDIN_DISABLED", null, null))).toEqual({ kind: "notAvailable" });
    expect(noticeFor(new ApiError(503, "LINKEDIN_UNAVAILABLE", null, null))).toEqual({ kind: "failed" });
    expect(noticeFor(new ApiError(404, "LINKEDIN_PROFILE_UNAVAILABLE", null, null), true)).toEqual({ kind: "suppressed" });
    expect(noticeFor(new ApiError(426, null, { error: "x", storeUrl: "javascript:alert(1)" }, null))).toEqual({ kind: "outdated", storeUrl: null });
    expect(noticeFor(new NetworkError("x"))).toEqual({ kind: "failed" });
    expect(noticeFor(new ApiError(500, null, { error: "x" }, null))).toEqual({ kind: "failed" });
    expect(noticeFor(new ApiError(501, null, { error: "x" }, null))).toEqual({ kind: "failed" });
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
    [410, "LINKEDIN_CAPTURE_EXPIRED", false, "expired"],
    [410, "LINKEDIN_CAPTURE_EXPIRED", true, "failed"], // not expected on create
    [409, "LINKEDIN_CAPTURE_FINALIZED", false, "failed"],
    [409, "LINKEDIN_CAPTURE_TARGET_MISMATCH", false, "failed"],
    [409, "LINKEDIN_SECTION_STALE", false, "failed"],
    [409, "LINKEDIN_MANIFEST_MISMATCH", false, "failed"], // after the one reconcile
    [429, "LINKEDIN_CAPTURE_LIMIT", true, "limit"],
    [429, "LINKEDIN_RATE_LIMITED", false, "failed"], // after the bounded retries
    [503, "LINKEDIN_UNAVAILABLE", false, "failed"], // after the bounded retries
    // At create, Scouty answered but could not start it: screen 26, not 22.
    [503, "LINKEDIN_UNAVAILABLE", true, "notAnswering"],
    [502, null, true, "notAnswering"],
    [504, null, true, "notAnswering"],
    [408, null, true, "notAnswering"],
    [429, "LINKEDIN_RATE_LIMITED", true, "notAnswering"],
    // Real terminal create errors keep their screens.
    [503, "LINKEDIN_DISABLED", true, "notAvailable"],
    [500, null, true, "failed"],
    [400, "LINKEDIN_INVALID_PAYLOAD", true, "failed"],
  ] as const)("%i %s → %s", (status, code, creating, kind) => {
    expect(noticeFor(new ApiError(status, code, { error: "x", code: code ?? undefined }, null), creating).kind).toBe(kind);
  });

  it("every stop reason has a screen with a way out", () => {
    const reasons: StopReason[] = ["user_stopped", "tab_closed", "logged_out", "reduced_profile", "checkpoint", "not_found", "wrong_profile", "left_linkedin", "unknown_page", "timeout", "permission_missing", "signed_out_of_scouty"];
    for (const stop of reasons) {
      const ui = captureUi({ phase: "done", tabId: TAB, result: { ...result, completeness: "partial", stop } }, { minutesLeft: null }, "W", 0);
      expect(ui, stop).not.toBeNull();
    }
  });
});

describe("waiting on Scouty is not being offline", () => {
  const NO_NETWORK_SECTIONS = { "synthetic-person-one": { posts: 0, comments: 0, reactions: 0 } };
  const ui = (state: CaptureState) => captureUi(state, { minutesLeft: null }, "W", 0);
  /** Lets a fired timer's continuation run, then waits for the controller's queue. */
  const flush = async (r: Awaited<ReturnType<typeof rig>>): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await r.controller.settledWork();
  };

  it("the blocked event keeps the next try and the rate limit only for 'server'; resume clears them", () => {
    const finalizing = { ...samples.finalizing, blocked: null } as CaptureState;
    const server = transition(finalizing, { type: "blocked", by: "server", retryAt: 5, rateLimited: true })!;
    expect(server).toMatchObject({ phase: "finalizing", blocked: "server", retryAt: 5, rateLimited: true });
    const offline = transition(server, { type: "blocked", by: "offline" })!;
    expect(offline).toEqual({ ...finalizing, blocked: "offline" });
    expect(transition(server, events.resume)).toEqual(finalizing);
  });

  it("503 on finalize after the retries: 'Scouty isn't responding', not 'offline'; tried again on its own, then done", async () => {
    const r = await rig({ capsBySlug: NO_NETWORK_SECTIONS });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    r.stub.fail(/POST .*\/finalize$/, "503", 6);
    await r.readAll();
    expect(r.stub.state.requests.filter((q) => q.path.endsWith("/finalize"))).toHaveLength(6);
    const state = await r.controller.current();
    expect(state).toMatchObject({ phase: "finalizing", blocked: "server", rateLimited: false, retryAt: r.clock.now + SERVER_RETRY_MS });
    expect(ui(state)).toEqual({ kind: "notAnswering", retryAt: null, sending: true, workspace: "W" });
    // It tries again by itself after the wait; nothing of LinkedIn is opened again.
    const timer = r.timers.find((tm) => tm.ms === SERVER_RETRY_MS)!;
    expect(timer).toBeDefined();
    const opened = r.tab.updates.length;
    r.clock.now += SERVER_RETRY_MS;
    timer.fire();
    await flush(r);
    expect(await r.phase()).toBe("done");
    expect(r.tab.updates).toHaveLength(opened);
  });

  it("429 with a Retry-After over 30 s: not retried at once, 'Scouty isn't responding' with roughly when; tried again after the wait, also after a restart", async () => {
    const r = await rig({ capsBySlug: NO_NETWORK_SECTIONS });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    r.stub.fail(/POST .*\/finalize$/, "429-long", 1);
    await r.readAll();
    expect(r.stub.state.requests.filter((q) => q.path.endsWith("/finalize"))).toHaveLength(1);
    const blockedAt = r.clock.now;
    const state = await r.controller.current();
    expect(state).toMatchObject({ phase: "finalizing", blocked: "server", rateLimited: true, retryAt: blockedAt + 60_000 });
    expect(ui(state)).toEqual({ kind: "notAnswering", retryAt: new Date(blockedAt + 60_000).toISOString(), sending: true, workspace: "W" });
    expect(r.timers.map((tm) => tm.ms)).toContain(60_000);
    // Asked before the wait is over (the popup polls): nothing is sent.
    const before = r.stub.state.requests.length;
    await r.controller.retryIfDue();
    expect(r.stub.state.requests).toHaveLength(before);
    // The background context restarts after the wait (the timer is lost): recover tries again.
    r.clock.now = blockedAt + 60_000;
    r.newController();
    await r.controller.recover();
    await flush(r);
    expect(await r.phase()).toBe("done");
  });

  it("a network failure shows 'You're offline' with no timer; asking for the state tries again once the wait is over", async () => {
    const r = await rig({ capsBySlug: NO_NETWORK_SECTIONS });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    r.stub.fail(/POST .*\/finalize$/, "drop", 6);
    await r.readAll();
    const state = await r.controller.current();
    expect(state).toMatchObject({ phase: "finalizing", blocked: "offline", retryAt: r.clock.now + OFFLINE_RETRY_MS });
    expect(ui(state)).toEqual({ kind: "offline", workspace: "W" });
    expect(r.timers.map((tm) => tm.ms)).not.toContain(SERVER_RETRY_MS);
    // No timer for it: only the readers' watchdogs (one per page read) are waiting.
    expect(r.timers.filter((tm) => tm.ms === OFFLINE_RETRY_MS)).toHaveLength(r.injected.filter((f) => f === "reader.js").length);
    // The popup asks before the wait is over: nothing is sent.
    const before = r.stub.state.requests.length;
    await r.controller.retryIfDue();
    expect(r.stub.state.requests).toHaveLength(before);
    expect(await r.controller.current()).toMatchObject({ blocked: "offline" });
    // Asked again after the wait, with the network back: sent, done; nothing of the site opened again.
    const opened = r.tab.updates.length;
    r.clock.now += OFFLINE_RETRY_MS;
    await r.controller.retryIfDue();
    await r.controller.settledWork();
    expect(await r.phase()).toBe("done");
    expect(r.tab.updates).toHaveLength(opened);
  });

  it("still offline when asked again: stays on 'You're offline' and waits another OFFLINE_RETRY_MS", async () => {
    const r = await rig({ capsBySlug: NO_NETWORK_SECTIONS });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    r.stub.fail(/(GET|POST) \/api\/linkedin\/ext\/captures\/.*/, "drop", 100);
    await r.readAll();
    expect(await r.controller.current()).toMatchObject({ blocked: "offline" });
    r.clock.now += OFFLINE_RETRY_MS;
    const before = r.stub.state.requests.length;
    await r.controller.retryIfDue();
    await r.controller.settledWork();
    expect(r.stub.state.requests.length).toBeGreaterThan(before);
    expect(await r.controller.current()).toMatchObject({ phase: "finalizing", blocked: "offline", retryAt: r.clock.now + OFFLINE_RETRY_MS });
  });

  it("a create that spends its retries on 503: screen 26 with Try now (start again), not 22; a 429 says roughly when", async () => {
    let r = await rig();
    r.stub.fail(/POST \/api\/linkedin\/ext\/captures$/, "503", 6);
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    expect(r.stub.state.requests.filter((q) => q.method === "POST" && q.path === "/api/linkedin/ext/captures")).toHaveLength(6);
    let state = await r.controller.current();
    expect(state).toEqual({ phase: "idle", notice: { kind: "notAnswering", retryAt: null } });
    expect(ui(state)).toEqual({ kind: "notAnswering", retryAt: null, sending: false, workspace: "W" });
    expect(await outbox.load()).toBeNull();
    expect(r.tab.updates).toEqual([]); // nothing of LinkedIn was read
    // Try now starts it again.
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    expect(await r.phase()).toBe("running");
    await r.controller.reset();
    unwire();
    r = await rig();
    r.stub.fail(/POST \/api\/linkedin\/ext\/captures$/, "429-long", 1);
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    state = await r.controller.current();
    expect(state).toMatchObject({ phase: "idle", notice: { kind: "notAnswering", retryAt: expect.any(String) } });
    expect(r.sleeps).toEqual([]);
  });

  it("a create refused for good keeps its screen: 500 → failed, daily limit → limit", async () => {
    let r = await rig();
    r.stub.fail(/POST \/api\/linkedin\/ext\/captures$/, "500", 1);
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    expect(await r.controller.current()).toEqual({ phase: "idle", notice: { kind: "failed" } });
    await r.controller.reset();
    unwire();
    r = await rig({ capturesLeftToday: 0 });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    expect(await r.controller.current()).toMatchObject({ phase: "idle", notice: { kind: "limit" } });
  });

  it("a 500 on finalize stays terminal", async () => {
    const r = await rig({ capsBySlug: NO_NETWORK_SECTIONS });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    r.stub.fail(/POST .*\/finalize$/, "500", 1);
    await r.readAll();
    expect(await r.controller.current()).toEqual({ phase: "idle", notice: { kind: "failed" } });
  });
});
