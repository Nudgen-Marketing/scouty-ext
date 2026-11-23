import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
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
    await outbox.begin(created({ expiresAt: new Date(1000).toISOString() }));
    expect(await outbox.purgeIfExpired(500)).toBe(false);
    expect(await outbox.purgeIfExpired(1000)).toBe(true);
    expect(await outbox.load()).toBeNull();
  });
});

describe("outbox with the controller", () => {
  it("a section is in the outbox before its upload, and stops being pending only when acknowledged", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    const seenAtUpload: boolean[] = [];
    const original = r.stub.handle.bind(r.stub);
    r.stub.handle = (request) => {
      if (request.method === "PUT") seenAtUpload.push(fake.session.data.has("outbox.body.profile") && outbox.pending(fake.session.data.get("outbox") as outbox.Outbox).length === 1);
      return original(request);
    };
    r.stub.fail(/PUT .*sections\/profile/, "503", 1);
    await r.read();
    expect(seenAtUpload).toEqual([true, true]); // present and pending at the failed attempt and at the retry
    const box = (await outbox.load())!;
    expect(outbox.pending(box)).toEqual([]);
    expect(box.sections[0]).toMatchObject({ section: "profile", acked: true });
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
    expect(await r.controller.current()).toEqual({ phase: "idle", notice: { kind: "outdated", storeUrl: "https://example.invalid/store" } });
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
