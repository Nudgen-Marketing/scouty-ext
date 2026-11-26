import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import * as auth from "../../src/background/auth";
import * as outbox from "../../src/background/outbox";
import { serialize, validateManifest, type CreateCreated } from "../../src/protocol";
import { fake } from "../helpers/fake-ext";
import { okResult, PROFILE_URL, rig, TAB } from "../helpers/session";
import { samplePayload, unwire } from "../helpers/stub";

afterEach(() => unwire());

const created = (over: Partial<CreateCreated> = {}): CreateCreated => ({
  captureId: "capture-0001", uploadToken: "token-0001", profileKey: "synthetic-person-one", profileUrl: PROFILE_URL,
  expected: ["profile", "experience", "skills", "posts", "comments", "reactions"], caps: { posts: 50, comments: 50, reactions: 50 },
  expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(), serverTime: new Date().toISOString(), ...over,
});

describe("outbox", () => {
  it("lives only in storage.session", async () => {
    await outbox.begin(created());
    await outbox.addSection(samplePayload("profile"), "complete", null);
    expect([...fake.session.data.keys()].sort()).toEqual(["outbox", "outbox.body.profile"]);
    expect(fake.local.data.size).toBe(0);
    expect(fake.sync.data.size).toBe(0);
  });

  it("the digest is over the exact bytes of the stored body, multi-byte text included", async () => {
    await outbox.begin(created());
    const payload = samplePayload("posts", 1, "synthetic-person-one", "🙂 قيد الاختبار Tiếng Việt");
    const entry = (await outbox.addSection(payload, "complete", null))!;
    const body = (await outbox.bodyOf("posts"))!;
    expect(body).toBe(serialize(payload));
    expect(entry.sha256).toBe(createHash("sha256").update(body, "utf8").digest("hex"));
    expect(entry.digestBase64).toBe(createHash("sha256").update(body, "utf8").digest("base64"));
    expect(entry.bytes).toBe(Buffer.byteLength(body, "utf8"));
  });

  it("builds the manifest from what it holds: one entry per expected section", async () => {
    await outbox.begin(created());
    await outbox.addSection(samplePayload("profile"), "complete", null);
    await outbox.addSection(samplePayload("posts"), "partial", "user_stopped");
    await outbox.declare("experience", { state: "unavailable", reason: "no_such_section" });
    await outbox.setStop("user_stopped");
    const box = (await outbox.load())!;
    const manifest = outbox.manifestOf(box);
    expect(validateManifest(manifest, box.expected)).toMatchObject({ ok: true });
    expect(manifest.stop).toBe("user_stopped");
    expect(manifest.sections.map((e) => `${e.section}:${e.state}:${e.reason}`)).toEqual([
      "profile:complete:null", "experience:unavailable:no_such_section", "skills:skipped:user_stopped",
      "posts:partial:user_stopped", "comments:skipped:user_stopped", "reactions:skipped:user_stopped",
    ]);
    expect(manifest.sections[0]).toMatchObject({ seq: 1, blockCount: 1, sha256: box.sections[0]!.sha256 });
    expect(manifest.sections[2]).toMatchObject({ seq: null, blockCount: null, sha256: null });
  });

  it("keeps the same finalize key while the manifest is the same, and a new one when it changes", async () => {
    await outbox.begin(created({ expected: ["profile"] }));
    await outbox.addSection(samplePayload("profile"), "complete", null);
    let n = 0;
    const key = (): string => `k${(n += 1)}`;
    expect((await outbox.finalizeRequest(key))!.key).toBe("k1");
    expect((await outbox.finalizeRequest(key))!.key).toBe("k1");
    await outbox.addSection(samplePayload("profile", 2), "complete", null);
    expect((await outbox.finalizeRequest(key))!.key).toBe("k2");
  });

  it("the 8 MB bound drops confirmed bytes first, then turns the oldest unsent section into skipped: read_failed", async () => {
    await outbox.begin(created());
    const big = (section: "profile" | "experience" | "skills" | "posts" | "comments" | "reactions") => {
      const payload = samplePayload(section);
      if (payload.profile) payload.profile.sections = Array.from({ length: 5 }, (_, i) => ({ label: `L${i}`, text: "x".repeat(7900) }));
      else { payload.blocks = Array.from({ length: 100 }, () => ({ text: "x".repeat(3990), urn: null, urnTime: null, truncated: false })); payload.blockCount = 100; }
      return payload;
    };
    const sections = ["posts", "comments", "reactions"] as const;
    for (const section of sections) await outbox.addSection(big(section), "complete", null);
    const first = (await outbox.load())!.sections.find((s) => s.section === "posts")!;
    await outbox.ack("posts", first.sha256);
    // Three bodies of about 0.4 MB are held. Lower the bound instead of storing 8 MB in a test.
    const { HARD_LIMITS } = await import("../../src/config");
    const original = HARD_LIMITS.outboxBytes;
    (HARD_LIMITS as { outboxBytes: number }).outboxBytes = first.bytes * 2 + 100_000;
    try {
      await outbox.addSection(big("profile"), "complete", null); // over the bound: the confirmed bytes of "posts" go first
      let box = (await outbox.load())!;
      expect(box.sections.find((s) => s.section === "posts")).toMatchObject({ acked: true, held: false });
      expect(await outbox.bodyOf("posts")).toBeNull();
      expect(box.declared).toEqual({});
      (HARD_LIMITS as { outboxBytes: number }).outboxBytes = first.bytes + 100_000;
      await outbox.addSection(big("experience"), "complete", null); // still over: the oldest unsent ("comments") is dropped
      box = (await outbox.load())!;
      expect(box.declared.comments).toEqual({ state: "skipped", reason: "read_failed" });
      expect(box.sections.some((s) => s.section === "comments")).toBe(false);
      expect(await outbox.bodyOf("comments")).toBeNull();
      const manifest = outbox.manifestOf(box);
      expect(manifest.sections.find((e) => e.section === "comments")).toMatchObject({ state: "skipped", reason: "read_failed", sha256: null });
      // The confirmed section is still declared as uploaded.
      expect(manifest.sections.find((e) => e.section === "posts")).toMatchObject({ state: "complete", sha256: first.sha256 });
    } finally {
      (HARD_LIMITS as { outboxBytes: number }).outboxBytes = original;
    }
  });

  it("is purged on browser start, and when expired", async () => {
    await outbox.begin(created());
    await outbox.addSection(samplePayload("profile"), "complete", null);
    await outbox.purgeOnStartup();
    expect(fake.session.data.size).toBe(0);
    await outbox.begin(created({ expiresAt: new Date(1000).toISOString(), serverTime: new Date(0).toISOString() }), 0);
    expect(await outbox.purgeIfExpired(500)).toBe(false);
    expect(await outbox.purgeIfExpired(1000)).toBe(true);
    expect(await outbox.load()).toBeNull();
  });
});

describe("capture expiry on this browser's clock (from Scouty's expiresAt - serverTime)", () => {
  const MIN = 60_000;
  const server = Date.UTC(2026, 10, 26, 12, 0, 0);
  const answer = { expiresAt: new Date(server + 20 * MIN).toISOString(), serverTime: new Date(server).toISOString() };

  it.each([["30 minutes behind", -30 * MIN], ["30 minutes ahead", 30 * MIN], ["right", 0]])("a browser clock %s still gets the full 20 minutes", async (_label, skew) => {
    const local = server + skew;
    expect(outbox.localExpiresAt(answer, local)).toBe(local + 20 * MIN);
    const box = (await outbox.begin(created(answer), local))!;
    expect(box.expiresAt).toBe(local + 20 * MIN);
    expect(await outbox.purgeIfExpired(local + 20 * MIN - 1)).toBe(false);
    expect(await outbox.purgeIfExpired(local + 20 * MIN)).toBe(true);
  });

  it("a longer window from the server is cut to 20 minutes (the privacy promise is kept on this browser)", async () => {
    const long = { expiresAt: new Date(server + 6 * 60 * MIN).toISOString(), serverTime: new Date(server).toISOString() };
    expect(outbox.localExpiresAt(long, server)).toBe(server + 20 * MIN);
    const box = (await outbox.begin(created(long), server))!;
    expect(await outbox.purgeIfExpired(server + 20 * MIN)).toBe(true);
    expect(box.expiresAt).toBe(server + 20 * MIN);
  });

  it.each([
    ["an unreadable expiresAt", { ...answer, expiresAt: "soon" }],
    ["an unreadable serverTime", { ...answer, serverTime: "" }],
    ["a missing serverTime", { ...answer, serverTime: undefined as unknown as string }],
  ])("%s: nothing is kept (null)", async (_label, times) => {
    expect(outbox.localExpiresAt(times, server)).toBeNull();
    expect(await outbox.begin(created(times), server)).toBeNull();
    expect(await outbox.load()).toBeNull();
  });

  it.each([["behind", -30 * 60_000], ["ahead", 30 * 60_000]])("with the controller: Scouty's clock 30 minutes %s of the browser's does not end the capture early or late", async (_label, skew) => {
    const holder: { clock?: { now: number } } = {};
    const r = await rig({ now: () => (holder.clock?.now ?? Date.UTC(2026, 10, 23, 9, 0, 0)) - skew });
    holder.clock = r.clock;
    const startedAt = r.clock.now;
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    expect(await r.phase()).toBe("running");
    expect((await outbox.load())!.expiresAt).toBe(startedAt + 20 * MIN);
    r.clock.now = startedAt + 20 * MIN - 1;
    expect(await r.phase()).toBe("running");
    r.clock.now = startedAt + 20 * MIN;
    expect(await r.controller.current()).toEqual({ phase: "idle", notice: { kind: "expired" } });
  });

  it("with the controller: a create answer whose times cannot be read ends as 'couldn't receive', nothing kept", async () => {
    const r = await rig();
    const create = r.api.createCapture;
    r.api.createCapture = async (...args) => ({ ...(await create(...args)), serverTime: "not a time" });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    expect(await r.controller.current()).toEqual({ phase: "idle", notice: { kind: "failed" } });
    expect(await outbox.load()).toBeNull();
    expect(r.injected).toEqual([]);
  });
});

describe("outbox with the controller", () => {
  it("a section is in the outbox before its upload, and stops being pending only when acknowledged", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    const seenAtUpload: boolean[] = [];
    const original = r.stub.handle.bind(r.stub);
    const pendingNow = (): string[] => outbox.pending(fake.session.data.get("outbox") as outbox.Outbox).map((e) => e.section);
    r.stub.handle = (request) => {
      if (request.method === "PUT" && request.url.endsWith("/sections/profile")) seenAtUpload.push(fake.session.data.has("outbox.body.profile") && pendingNow().includes("profile"));
      return original(request);
    };
    r.stub.fail(/PUT .*sections\/profile/, "503", 1);
    await r.read();
    // One attempt during reading (DEVIATIONS 27): present and pending then; it failed, so it stays pending.
    expect(seenAtUpload).toEqual([true]);
    expect(pendingNow()).toEqual(["profile"]);
    // Finalize sends it from the outbox, still pending at that PUT; the outbox is cleared only after it is acknowledged and finalized.
    await r.readAll();
    expect(seenAtUpload).toEqual([true, true]);
    expect(await r.phase()).toBe("done");
    expect(await outbox.load()).toBeNull();
  });

  it("resumes after a network drop: status fetched, only the missing sections re-sent, finalize sent, LinkedIn not re-read", async () => {
    const r = await rig({ capsBySlug: { "synthetic-person-one": { comments: 0, reactions: 0 } } });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read(); // profile is uploaded
    r.stub.fail(/^(PUT|POST|GET) \/api\/linkedin\/ext\/captures\//, "drop", 999);
    await r.readAll(); // experience, skills, posts are read while the API is unreachable
    expect(await r.phase()).toBe("finalizing");
    expect((await r.controller.current())).toMatchObject({ blocked: "offline" });
    const navigations = r.tab.updates.length;
    const injections = r.injected.length;
    expect(outbox.pending((await outbox.load())!).map((s) => s.section)).toEqual(["experience", "skills", "posts"]);

    r.stub.clearFaults();
    r.stub.state.requests.length = 0;
    await r.controller.resume();
    expect(await r.phase()).toBe("done");
    const id = [...r.stub.state.captures.keys()][0]!;
    expect(r.stub.state.requests.map((q) => `${q.method} ${q.path.replace(id, ":id")}`)).toEqual([
      "GET /api/linkedin/ext/captures/:id",
      "PUT /api/linkedin/ext/captures/:id/sections/experience",
      "PUT /api/linkedin/ext/captures/:id/sections/skills",
      "PUT /api/linkedin/ext/captures/:id/sections/posts",
      "POST /api/linkedin/ext/captures/:id/finalize",
    ]);
    expect(r.tab.updates.length).toBe(navigations);
    expect(r.injected.length).toBe(injections);
    expect(await outbox.load()).toBeNull();
  });

  it("resumes after a simulated restart of the background context", async () => {
    const r = await rig({ capsBySlug: { "synthetic-person-one": { posts: 0, comments: 0, reactions: 0 } } });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    await r.read();
    r.stub.fail(/POST .*finalize/, "drop", 999);
    await r.read();
    expect(await r.controller.current()).toMatchObject({ phase: "finalizing", blocked: "offline" });
    r.stub.clearFaults();
    // A new controller knows nothing but what storage.session holds.
    const restarted = r.newController();
    const navigations = r.tab.updates.length;
    await restarted.resume();
    expect((await restarted.current()).phase).toBe("done");
    expect(r.tab.updates.length).toBe(navigations);
    expect(r.stub.state.requests.filter((q) => q.method === "PUT" && q.status === 204)).toHaveLength(3);
  });

  it("reconciles once on LINKEDIN_MANIFEST_MISMATCH and finalizes again", async () => {
    const r = await rig({ capsBySlug: { "synthetic-person-one": { posts: 0, comments: 0, reactions: 0 } } });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    await r.read();
    // The server loses a staged section just before finalize.
    const capture = [...r.stub.state.captures.values()][0]!;
    capture.sections.delete("experience");
    await r.read();
    expect(await r.phase()).toBe("done");
    const tail = r.stub.state.requests.slice(-3).map((q) => `${q.method} ${q.path.split("/").slice(-2).join("/")} ${q.status}`);
    expect(tail).toEqual([`POST ${capture.id}/finalize 409`, "PUT sections/experience 204", `POST ${capture.id}/finalize 200`]);
  });

  it("mismatch re-sends an acknowledged section without re-reading LinkedIn", async () => {
    const r = await rig({ capsBySlug: { "synthetic-person-one": { posts: 0, comments: 0, reactions: 0 } } });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read(); // profile
    await r.read(); // experience
    const acked = (await outbox.load())!.sections.find((s) => s.section === "experience")!;
    expect(acked).toMatchObject({ acked: true });
    const sentBefore = r.stub.state.requests.find((q) => q.method === "PUT" && q.path.endsWith("/sections/experience"))!;
    const capture = [...r.stub.state.captures.values()][0]!;
    capture.sections.delete("experience"); // the server lost the acknowledged section
    const navigations = r.tab.updates.length; // skills, the last page, is already open with its reader
    const readers = r.injected.filter((f) => f === "reader.js").length;
    await r.read(); // skills, the last section: finalize → 409 mismatch → re-send experience → finalize
    expect(await r.phase()).toBe("done");
    const resent = r.stub.state.requests.filter((q) => q.method === "PUT" && q.path.endsWith("/sections/experience"));
    expect(resent).toHaveLength(2);
    expect(resent[1]!.status).toBe(204);
    expect(sentBefore.headers["content-digest"]).toMatch(/^sha-256=:/);
    expect(resent[1]!.headers["content-digest"]).toBe(sentBefore.headers["content-digest"]); // the same bytes, from the outbox
    // LinkedIn was not read again: no page opened and no reader injected for the re-send.
    expect(r.tab.updates).toHaveLength(navigations);
    expect(r.injected.filter((f) => f === "reader.js")).toHaveLength(readers);
  });

  it("invalid_grant mid-capture clears tokens but keeps the outbox while the capture is in flight and unexpired; reconnect resumes and finalizes", async () => {
    const r = await rig({ capsBySlug: { "synthetic-person-one": { posts: 0, comments: 0, reactions: 0 } } });
    auth.onConnectionEnded(() => r.controller.connectionEnded()); // as src/background/index.ts wires it
    try {
      await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
      await r.read(); // profile sent
      r.stub.revokeAll(); // the grant is revoked: the next call gets 401, and the refresh invalid_grant
      await r.read(); // experience is read, its upload is refused
      const refresh = r.stub.state.requests.filter((q) => q.path === "/oauth/token").at(-1)!;
      expect(refresh.status).toBe(400);
      expect(fake.session.data.has("auth.access")).toBe(false);
      expect(fake.local.data.has("auth.refresh")).toBe(false);
      expect(await auth.isConnected()).toBe(false);
      const state = await r.controller.current();
      expect(state).toMatchObject({ phase: "finalizing", blocked: "auth" });
      const box = (await outbox.load())!;
      expect(box.expiresAt).toBeGreaterThan(r.clock.now);
      expect(outbox.pending(box).map((s) => s.section)).toEqual(["experience"]);
      expect(await outbox.bodyOf("experience")).not.toBeNull();
      const navigations = r.tab.updates.length;
      // Reconnect (a new grant) and resume: only the unsent section goes, then finalize.
      await auth.connect();
      await r.controller.resume();
      expect(await r.controller.current()).toMatchObject({ phase: "done", result: { stop: "signed_out_of_scouty" } });
      expect(r.stub.state.requests.filter((q) => q.method === "PUT" && q.path.endsWith("/sections/experience") && q.status === 204)).toHaveLength(1);
      expect(r.stub.state.requests.filter((q) => q.path.endsWith("/finalize")).at(-1)!.status).toBe(200);
      expect(r.tab.updates).toHaveLength(navigations);
      expect(await outbox.load()).toBeNull();
    } finally {
      auth.onConnectionEnded(() => undefined);
    }
  });

  it("invalid_grant with no capture in flight clears the outbox too", async () => {
    const r = await rig();
    auth.onConnectionEnded(() => r.controller.connectionEnded());
    try {
      await outbox.begin(created()); // a leftover outbox with the controller idle
      r.stub.revokeAll();
      r.stub.expireAccessTokens();
      r.clock.now += 16 * 60_000;
      expect(await auth.tokenSource.current()).toBeNull();
      expect(await outbox.load()).toBeNull();
    } finally {
      auth.onConnectionEnded(() => undefined);
    }
  });

  it("Disconnect always clears the outbox: while reading, while waiting for a reconnect, and while offline", async () => {
    const caps = { capsBySlug: { "synthetic-person-one": { posts: 0, comments: 0, reactions: 0 } } };
    const disconnect = async (r: Awaited<ReturnType<typeof rig>>): Promise<void> => {
      // What src/background/index.ts does on Disconnect.
      await auth.signOut();
      await r.controller.reset();
      expect([...fake.session.data.keys()].filter((k) => k.startsWith("outbox"))).toEqual([]);
      expect(await r.phase()).toBe("idle");
    };
    // while reading
    let r = await rig(caps);
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    expect(await outbox.load()).not.toBeNull();
    await disconnect(r);
    // while waiting for a reconnect (the outbox was kept for it)
    unwire(); fake.session.data.clear(); fake.local.data.clear();
    r = await rig(caps);
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    r.stub.revokeAll();
    await r.read();
    expect(await r.controller.current()).toMatchObject({ phase: "finalizing", blocked: "auth" });
    expect(await outbox.load()).not.toBeNull();
    await disconnect(r);
    // while offline, with sections waiting to be sent
    unwire(); fake.session.data.clear(); fake.local.data.clear();
    r = await rig(caps);
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read(); // profile is uploaded
    r.stub.fail(/^(PUT|POST|GET) \/api\/linkedin\/ext\/captures\//, "drop", 999);
    await r.readAll();
    expect(await r.controller.current()).toMatchObject({ phase: "finalizing", blocked: "offline" });
    expect(await outbox.load()).not.toBeNull();
    r.stub.clearFaults();
    await disconnect(r);
  });

  it("gives up after one reconcile and clears the outbox", async () => {
    const r = await rig({ capsBySlug: { "synthetic-person-one": { posts: 0, comments: 0, reactions: 0 } } });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    await r.read();
    const capture = [...r.stub.state.captures.values()][0]!;
    const original = r.stub.handle.bind(r.stub);
    r.stub.handle = (request) => { if (request.method === "POST" && request.url.endsWith("/finalize")) capture.sections.delete("experience"); return original(request); };
    await r.read();
    expect(await r.controller.current()).toEqual({ phase: "idle", notice: { kind: "failed" } });
    expect(r.stub.state.requests.filter((q) => q.path.endsWith("/finalize"))).toHaveLength(2);
    expect(await outbox.load()).toBeNull();
  });

  it("is deleted on finalize, on a terminal error, on expiry and on Disconnect", async () => {
    const caps = { capsBySlug: { "synthetic-person-one": { posts: 0, comments: 0, reactions: 0 } } };
    // finalize
    let r = await rig(caps);
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.readAll();
    expect(await r.phase()).toBe("done");
    expect([...fake.session.data.keys()].filter((k) => k.startsWith("outbox"))).toEqual([]);
    // terminal error
    unwire(); fake.session.data.clear(); fake.local.data.clear();
    r = await rig(caps);
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    r.stub.state.minVersion = "9.9.9";
    await r.read();
    expect(await r.controller.current()).toEqual({ phase: "idle", notice: { kind: "outdated", storeUrl: "https://chromewebstore.google.com/detail/synthetic-store-entry" } });
    expect([...fake.session.data.keys()].filter((k) => k.startsWith("outbox"))).toEqual([]);
    // expiry
    unwire(); fake.session.data.clear(); fake.local.data.clear();
    r = await rig(caps);
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    r.clock.now += 21 * 60_000;
    expect(await r.phase()).toBe("idle");
    expect([...fake.session.data.keys()].filter((k) => k.startsWith("outbox"))).toEqual([]);
    // Disconnect
    unwire(); fake.session.data.clear(); fake.local.data.clear();
    r = await rig(caps);
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read(okResult);
    await r.controller.reset();
    expect([...fake.session.data.keys()].filter((k) => k.startsWith("outbox"))).toEqual([]);
    expect(await r.phase()).toBe("idle");
  });
});
