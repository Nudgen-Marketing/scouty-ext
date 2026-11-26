import { afterEach, describe, expect, it } from "vitest";
import * as auth from "../../src/background/auth";
import { EXPIRED } from "../../src/background/session";
import { captureTarget, giveConsent, minutesLeft, popupUi, startCapture, targetIsProfile, type UiContext } from "../../src/background/ui-state";
import { fake, installFakeExt } from "../helpers/fake-ext";
import { PROFILE_URL, rig, TAB, type Rig } from "../helpers/session";
import { unwire } from "../helpers/stub";

afterEach(() => { unwire(); installFakeExt("chrome"); });

const grant = (): void => { fake.granted.add("https://www.linkedin.com/in/*"); fake.granted.add("https://scouty.to/*"); };
const ctx = (r: Rig, connecting = false): UiContext => ({ api: r.api, controller: r.controller, connecting: () => connecting, now: () => r.clock.now });
const on = { tabId: TAB, tabUrl: PROFILE_URL, settings: false };

describe("starting a capture (background)", () => {
  it("starts nothing without consent, even when a Capture action skips the notice; starts once it is given", async () => {
    const r = await rig();
    grant();
    const urlOf = async (): Promise<string> => PROFILE_URL;
    expect(await startCapture(r.controller, TAB, false, urlOf)).toBe(false);
    expect(await r.controller.current()).toMatchObject({ phase: "idle" });
    expect(r.stub.state.requests.filter((q) => q.method === "POST")).toEqual([]);
    await giveConsent();
    expect(await startCapture(r.controller, TAB, false, urlOf)).toBe(true);
    expect((await r.controller.current()).phase).not.toBe("idle");
  });

  it("starts nothing without a tab address", async () => {
    const r = await rig();
    grant();
    await giveConsent();
    expect(await startCapture(r.controller, TAB, false, async () => null)).toBe(false);
    expect(await r.controller.current()).toMatchObject({ phase: "idle" });
  });
});

describe("popup state", () => {
  it("without both host permissions, asks for them and offers nothing else (the Firefox default)", async () => {
    const r = await rig();
    expect(await popupUi(ctx(r), on)).toEqual({ kind: "permission" });
    fake.granted.add("https://www.linkedin.com/in/*");
    expect(await popupUi(ctx(r), on)).toEqual({ kind: "permission" });
    expect(r.stub.state.requests).toEqual([]); // nothing is read or sent until both are granted
    grant();
    expect((await popupUi(ctx(r), on)).kind).toBe("consent");
  });

  it("the same flow works through a Firefox-shaped browser.* namespace", async () => {
    installFakeExt("browser");
    expect((globalThis as { chrome?: unknown }).chrome).toBeUndefined();
    const { ext } = await import("../../src/ext");
    // ext.ts reads the namespace once at load; both shapes expose the same promise API.
    expect(typeof ext.storage.session.get).toBe("function");
  });

  it("signed out, connecting, then connected", async () => {
    const r = await rig();
    grant();
    await auth.signOut();
    expect(await popupUi(ctx(r), on)).toEqual({ kind: "signedOut" });
    expect(await popupUi(ctx(r, true), on)).toEqual({ kind: "connecting" });
    await auth.connect();
    expect(await popupUi(ctx(r), { tabId: 3, tabUrl: "https://www.linkedin.com/feed/", settings: false })).toEqual({ kind: "notOnProfile", workspace: "Synthetic Workspace" });
    expect(await popupUi(ctx(r), { tabId: 3, tabUrl: null, settings: false })).toEqual({ kind: "notOnProfile", workspace: "Synthetic Workspace" });
  });

  it("on a profile: consent first, then ready with the allowance", async () => {
    const r = await rig();
    grant();
    expect(await popupUi(ctx(r), on)).toEqual({ kind: "consent", slug: "synthetic-person-one", workspace: "Synthetic Workspace" });
    await giveConsent();
    expect(await popupUi(ctx(r), on)).toEqual({ kind: "ready", slug: "synthetic-person-one", workspace: "Synthetic Workspace", capturesLeft: 40 });
    expect(fake.local.data.get("consent.v1")).toBe(true);
  });

  it("settings, a running capture, and a capture running in another tab", async () => {
    const r = await rig();
    grant();
    await giveConsent();
    expect(await popupUi(ctx(r), { ...on, settings: true })).toEqual({ kind: "settings", name: "Synthetic Tester", email: "tester@example.invalid", workspace: "Synthetic Workspace", version: "0.1.0" });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.controller.settledWork();
    expect(await popupUi(ctx(r), on)).toMatchObject({ kind: "capturing", section: "profile", cap: 0 });
    expect(await popupUi(ctx(r), { tabId: 99, tabUrl: "https://www.linkedin.com/in/synthetic-person-two/", settings: false })).toEqual({ kind: "busy", workspace: "Synthetic Workspace" });
  });

  it("an outdated extension or an account without access says so before anything else", async () => {
    let r = await rig({ minVersion: "9.0.0" });
    grant();
    expect(await popupUi(ctx(r), on)).toEqual({ kind: "outdated" });
    unwire();
    fake.session.data.clear();
    r = await rig();
    grant();
    r.stub.state.available = false;
    expect(await popupUi(ctx(r), on)).toEqual({ kind: "notAvailable" });
  });

  it("27 expired: Capture can start only when the popup's tab is a LinkedIn profile (no dead button)", async () => {
    const r = await rig();
    grant();
    await giveConsent();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    r.clock.now += 20 * 60_000 + 1;
    expect(await r.controller.current()).toEqual(EXPIRED);
    expect(await popupUi(ctx(r), on)).toEqual({ kind: "expired", workspace: "Synthetic Workspace", onProfile: true });
    expect(await popupUi(ctx(r), { tabId: 3, tabUrl: "https://www.linkedin.com/feed/", settings: false })).toEqual({ kind: "expired", workspace: "Synthetic Workspace", onProfile: false });
    expect(await popupUi(ctx(r), { tabId: 3, tabUrl: "https://example.com/", settings: false })).toMatchObject({ kind: "expired", onProfile: false });
  });

  it("the capture target is the popup's tab first, then the capture's, then the recent notice's", async () => {
    expect(captureTarget(EXPIRED, 5)).toBe(5);
    expect(captureTarget(EXPIRED, null)).toBeNull();
    expect(captureTarget({ phase: "idle", notice: { kind: "recent", finalizedAt: "2026-11-23T09:00:00.000Z", tabId: 8, url: PROFILE_URL } }, null)).toBe(8);
    expect(await targetIsProfile(EXPIRED, null, null)).toBe(false);
    expect(await targetIsProfile(EXPIRED, 5, PROFILE_URL)).toBe(true);
    expect(await targetIsProfile(EXPIRED, 5, "https://www.linkedin.com/feed/")).toBe(false);
  });

  it("the time estimate comes from the sections left and never counts up", () => {
    const running = { phase: "running" as const, tabId: 1, profileKey: "k", section: "profile" as const, count: 0, loading: false, expected: ["profile", "experience", "skills", "posts", "comments", "reactions"] as const, caps: { posts: 50, comments: 50, reactions: 50 }, finished: [] as never[] };
    const all = minutesLeft({ ...running, expected: [...running.expected] }, null);
    expect(all).toBe(3);
    const later = minutesLeft({ ...running, expected: [...running.expected], finished: ["profile", "experience", "skills", "posts", "comments"] }, all);
    expect(later).toBe(1);
    expect(minutesLeft({ ...running, expected: [...running.expected] }, 1)).toBe(1);
  });
});
