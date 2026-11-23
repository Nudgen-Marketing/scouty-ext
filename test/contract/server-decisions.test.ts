// The server decisions the extension must match (the app's src/lib/linkedin/protocol.ts and
// ingest.ts are the reference). One test per decision, against the builders, the validators,
// the outbox and the controller wired to the stub of the capture API.
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../../src/background/api";
import * as outbox from "../../src/background/outbox";
import { digest } from "../../src/background/outbox";
import { noticeFor } from "../../src/background/session";
import {
  buildActivityPayload, buildManifest, buildProfilePayload, validateManifest, validateSectionPayload,
  type Counts, type FinalizeResponse,
} from "../../src/protocol";
import { parseActivityUrn, urnTime } from "../../src/reader/urn";
import { PROFILE_URL, rig, TAB } from "../helpers/session";
import { samplePayload, unwire } from "../helpers/stub";

afterEach(() => unwire());

const meta = { seq: 1, pageSlug: "synthetic-person-one", capturedAt: "2026-11-23T09:00:00.000Z", selectorsVersion: 1, browser: "chrome" as const, locale: "en", read: "ok" as const, expanded: true, reachedCap: false };
const profileWith = (name: string, headline: string) => buildProfilePayload("profile", meta, { name, headline, sections: [{ label: "About", text: "Invented" }], truncated: [] });
const NO_NETWORK_SECTIONS = { "synthetic-person-one": { posts: 0, comments: 0, reactions: 0 } };

describe("payload shape", () => {
  it("name ≤ 300 and headline ≤ 500, counted in Unicode code points (an emoji counts once)", () => {
    const emoji = "\u{1F600}"; // two UTF-16 units, one code point
    expect(validateSectionPayload(profileWith(emoji.repeat(300), "h")).ok).toBe(true);
    expect(validateSectionPayload(profileWith(emoji.repeat(301), "h")).ok).toBe(false);
    expect(validateSectionPayload(profileWith("n", emoji.repeat(500))).ok).toBe(true);
    expect(validateSectionPayload(profileWith("n", emoji.repeat(501))).ok).toBe(false);
  });

  it("profile-kind sections send blocks: [] and activity-kind sections send profile: null", () => {
    for (const section of ["profile", "experience", "skills"] as const) {
      const payload = buildProfilePayload(section, meta, { name: "N", headline: "H", sections: [], truncated: [] });
      expect(payload.blocks).toEqual([]);
      expect(payload.profile).not.toBeNull();
      // Only the main profile page carries the name and headline.
      if (section !== "profile") expect(payload.profile).toMatchObject({ name: null, headline: null });
    }
    for (const section of ["posts", "comments", "reactions"] as const) {
      expect(buildActivityPayload(section, meta, []).profile).toBeNull();
    }
  });

  it("urn and urnTime are sent only when valid", () => {
    expect(parseActivityUrn("urn:li:activity:7130316800000000000")).toBe("urn:li:activity:7130316800000000000");
    for (const bad of ["urn:li:share:7130316800000000000", "urn:li:activity:12", "urn:li:activity:7130316800000000000x", " javascript:1", ""]) {
      expect(parseActivityUrn(bad), bad).toBeNull();
      expect(urnTime(bad), bad).toBeNull();
    }
    // An id whose time would be in the future or before LinkedIn's activity ids is not dated.
    expect(urnTime("urn:li:activity:9999999999999999999999")).toBeNull();
    expect(urnTime("urn:li:activity:1000000")).toBeNull();
    const block = buildActivityPayload("posts", meta, [{ text: "t", urn: null, urnTime: null, truncated: false }]).blocks[0]!;
    expect(block).toEqual({ text: "t", urn: null, urnTime: null, truncated: false });
  });

  it("manifest sha256 is lowercase hex; Content-Digest is the same SHA-256 in base64 over the exact body bytes", async () => {
    const body = JSON.stringify(samplePayload("posts", 1, "synthetic-person-one", "Xin chào \u{1F600} مرحبا"));
    const { sha256, digestBase64, bytes } = await digest(body);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(digestBase64, "base64").toString("hex")).toBe(sha256);
    expect(bytes).toBe(Buffer.byteLength(body, "utf8"));
    const entry = { section: "posts" as const, state: "complete" as const, reason: null, seq: 1, blockCount: 1, sha256 };
    expect(validateManifest(buildManifest([entry], null)).ok).toBe(true);
    expect(validateManifest(buildManifest([{ ...entry, sha256: sha256.toUpperCase() }], null)).ok).toBe(false);
  });

  it("Counts is exactly { profileSections, posts, comments, reactions }", async () => {
    const r = await rig({ capsBySlug: NO_NETWORK_SECTIONS });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.readAll();
    const result = [...r.stub.state.captures.values()][0]!.result as FinalizeResponse;
    expect(Object.keys(result.captured)).toEqual(["profileSections", "posts", "comments", "reactions"] satisfies (keyof Counts)[]);
    expect(await r.controller.current()).toMatchObject({ phase: "done", result: { captured: result.captured } });
  });
});

describe("error codes end in a sensible screen", () => {
  it.each([
    [401, "LINKEDIN_AUTH_REQUIRED", "failed"], // only after the refresh-and-retry has failed (then: connection ended)
    [404, "LINKEDIN_PROFILE_UNAVAILABLE", "suppressed"],
    [403, "LINKEDIN_ORIGIN_REFUSED", "failed"],
    [415, "LINKEDIN_UNSUPPORTED_MEDIA_TYPE", "failed"],
    [429, "LINKEDIN_RATE_LIMITED", "failed"],
    [503, "LINKEDIN_UNAVAILABLE", "failed"],
    [503, "LINKEDIN_DISABLED", "notAvailable"],
    [409, "LINKEDIN_SECTION_STALE", "failed"],
    [409, "LINKEDIN_CAPTURE_FINALIZED", "failed"],
    [410, "LINKEDIN_CAPTURE_EXPIRED", "failed"],
  ] as const)("%i %s → %s", (status, code, kind) => {
    expect(noticeFor(new ApiError(status, code, { error: "x", code }, null), code === "LINKEDIN_PROFILE_UNAVAILABLE").kind).toBe(kind);
  });

  it("LINKEDIN_DISABLED during an upload is an answer, not an outage: not retried, ends in notAvailable", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    r.stub.fail(/PUT .*sections\/profile/, "disabled", 99);
    await r.read();
    expect(r.stub.state.requests.filter((q) => q.method === "PUT")).toHaveLength(1);
    expect(r.sleeps).toEqual([]);
    expect(await r.controller.current()).toEqual({ phase: "idle", notice: { kind: "notAvailable" } });
    expect(await outbox.load()).toBeNull();
  });

  it("a 500 during an upload is terminal: not retried, not deferred, ends in failed with Capture again", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    r.stub.fail(/PUT .*sections\/profile/, "500", 99);
    await r.read();
    expect(r.stub.state.requests.filter((q) => q.method === "PUT")).toHaveLength(1);
    expect(r.sleeps).toEqual([]);
    expect(await r.controller.current()).toEqual({ phase: "idle", notice: { kind: "failed" } });
    expect(await outbox.load()).toBeNull();
  });

  it("a 500 on finalize is terminal; a 502 or 504 on finalize is retried and the capture finishes", async () => {
    let r = await rig({ capsBySlug: NO_NETWORK_SECTIONS });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    r.stub.fail(/POST .*\/finalize$/, "500", 99);
    await r.readAll();
    expect(r.stub.state.requests.filter((q) => q.path.endsWith("/finalize"))).toHaveLength(1);
    expect(await r.controller.current()).toEqual({ phase: "idle", notice: { kind: "failed" } });
    for (const kind of ["502", "504"] as const) {
      unwire();
      r = await rig({ capsBySlug: NO_NETWORK_SECTIONS });
      await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
      r.stub.fail(/POST .*\/finalize$/, kind, 2);
      await r.readAll();
      expect(r.stub.state.requests.filter((q) => q.path.endsWith("/finalize")), kind).toHaveLength(3);
      expect(await r.phase(), kind).toBe("done");
    }
  });

  it("LINKEDIN_RATE_LIMITED and LINKEDIN_UNAVAILABLE during an upload are waited out with Retry-After, then the capture finishes", async () => {
    const r = await rig({ capsBySlug: NO_NETWORK_SECTIONS });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    r.stub.fail(/PUT .*sections\/profile/, "429", 1);
    r.stub.fail(/PUT .*sections\/experience/, "503", 2);
    await r.readAll();
    expect(r.sleeps).toContain(1000); // the stub's Retry-After: 1
    expect(await r.phase()).toBe("done");
  });

  it("an expired capture (410) clears everything and says so once", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    // The server expires the capture early (its clock, not ours).
    for (const capture of r.stub.state.captures.values()) capture.expiresAt = r.clock.now - 1;
    await r.read();
    expect(await r.controller.current()).toEqual({ phase: "idle", notice: { kind: "failed" } });
    expect(await outbox.load()).toBeNull();
  });
});

describe("create, finalize and resume", () => {
  it("a create while this user has an open capture of the profile returns the same capture with a new token and nothing staged: every section is sent again", async () => {
    const r = await rig({ capsBySlug: NO_NETWORK_SECTIONS });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    await r.read();
    const first = [...r.stub.state.captures.values()][0]!;
    expect([...first.sections.keys()]).toEqual(["profile", "experience"]);
    const oldToken = r.stub.state.requests.find((q) => q.method === "PUT")!.headers["x-capture-token"]!;
    // The browser restarts: the outbox is purged, the server still holds the open capture.
    await r.controller.reset();
    r.newController();
    r.tab.info = { url: PROFILE_URL, status: "complete" }; // the user is back on the profile page
    r.stub.state.requests.length = 0;
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    expect(r.stub.state.captures.size).toBe(1);
    expect(first.sections.size).toBe(0); // staging cleared
    await r.readAll();
    const puts = r.stub.state.requests.filter((q) => q.method === "PUT");
    expect(puts.map((q) => q.path.split("/").at(-1))).toEqual(["profile", "experience", "skills"]);
    expect(puts.every((q) => q.headers["x-capture-token"] !== oldToken)).toBe(true);
    expect(first.status).toBe("finalized");
    // The old token is refused.
    const stale = r.stub.handle({ method: "GET", url: `/api/linkedin/ext/captures/${first.id}`, headers: { ...puts[0]!.headers, "x-capture-token": oldToken } });
    expect(stale !== "drop" && stale.status).toBe(404);
  });

  it("a create whose answer was lost is repeated with the same key and gets the same capture", async () => {
    const r = await rig({ capsBySlug: NO_NETWORK_SECTIONS });
    r.stub.fail(/^POST \/api\/linkedin\/ext\/captures$/, "lose-answer", 1);
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    const creates = r.stub.state.requests.filter((q) => q.method === "POST" && q.path === "/api/linkedin/ext/captures");
    expect(creates).toHaveLength(2);
    expect(creates[0]!.headers["idempotency-key"]).toBe(creates[1]!.headers["idempotency-key"]);
    expect(r.stub.state.captures.size).toBe(1);
    await r.readAll();
    expect(await r.phase()).toBe("done");
  });

  it("a repeated create key on a finalized, analyzable capture returns { recent }", async () => {
    const r = await rig({ capsBySlug: NO_NETWORK_SECTIONS });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: true });
    await r.readAll();
    const create = r.stub.state.requests.find((q) => q.method === "POST" && q.path === "/api/linkedin/ext/captures")!;
    const again = r.stub.handle({ method: "POST", url: "/api/linkedin/ext/captures", headers: create.headers, body: new TextEncoder().encode(JSON.stringify({ linkedinUrl: PROFILE_URL, recapture: true })) });
    expect(again !== "drop" && again.status).toBe(200);
    expect(again !== "drop" && JSON.parse(again.body!)).toEqual({ recent: { finalizedAt: expect.any(String), completeness: "complete", counts: { profileSections: 3, posts: 0, comments: 0, reactions: 0 } } });
    expect(r.stub.state.captures.size).toBe(1);
  });

  it("finalize carries an Idempotency-Key; a lost answer is repeated with the same key and manifest and gets the same result", async () => {
    const r = await rig({ capsBySlug: NO_NETWORK_SECTIONS });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    r.stub.fail(/POST .*\/finalize$/, "lose-answer", 99);
    await r.readAll();
    // The finalize got through every time; only its answers were lost.
    const capture = [...r.stub.state.captures.values()][0]!;
    expect(capture.status).toBe("finalized");
    expect(await r.controller.current()).toMatchObject({ phase: "finalizing", blocked: "offline" });
    r.stub.clearFaults();
    r.stub.state.requests.length = 0;
    await r.controller.resume();
    expect(await r.controller.current()).toMatchObject({ phase: "done", result: { completeness: "complete" } });
    // Resume saw a finalized capture (which lists nothing as received) and sent no section again.
    expect(r.stub.state.requests.map((q) => `${q.method} ${q.path.replace(capture.id, ":id")} ${q.status}`)).toEqual([
      "GET /api/linkedin/ext/captures/:id 200", "POST /api/linkedin/ext/captures/:id/finalize 200",
    ]);
    expect(await outbox.load()).toBeNull();
  });

  it("finalize keys: the same key and identical manifest bytes on every repeat", async () => {
    const r = await rig({ capsBySlug: NO_NETWORK_SECTIONS });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    r.stub.fail(/POST .*\/finalize$/, "503", 2);
    await r.readAll();
    const finals = r.stub.state.requests.filter((q) => q.path.endsWith("/finalize"));
    expect(finals).toHaveLength(3);
    expect(new Set(finals.map((q) => q.headers["idempotency-key"])).size).toBe(1);
    expect(new Set(finals.map((q) => q.bytes)).size).toBe(1);
    expect(await r.phase()).toBe("done");
  });

  it("a PUT refused with LINKEDIN_CAPTURE_FINALIZED sends nothing more and repeats the same finalize", async () => {
    const r = await rig({ capsBySlug: NO_NETWORK_SECTIONS });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    r.stub.fail(/POST .*\/finalize$/, "lose-answer", 99);
    await r.readAll();
    const capture = [...r.stub.state.captures.values()][0]!;
    expect(capture.status).toBe("finalized");
    r.stub.clearFaults();
    // A status answer that does not say "finalized" (a race with the finalize): resume re-sends.
    const original = r.stub.handle.bind(r.stub);
    r.stub.handle = (request) => (request.method === "GET" && request.url.endsWith(capture.id)
      ? { status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "open", received: [], expiresAt: new Date(r.clock.now + 60_000).toISOString() }) }
      : original(request));
    r.stub.state.requests.length = 0;
    await r.controller.resume();
    expect(await r.controller.current()).toMatchObject({ phase: "done", result: { completeness: "complete" } });
    expect(r.stub.state.requests.map((q) => `${q.method} ${q.path.split("/").at(-1)} ${q.status}`)).toEqual([
      "PUT profile 409", "POST finalize 200",
    ]);
  });

  it("a resumed upload re-sends the same bytes for the same seq", async () => {
    const r = await rig({ capsBySlug: NO_NETWORK_SECTIONS });
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    // The first PUT of the experience section is stored, but its answer is lost.
    r.stub.fail(/PUT .*sections\/experience/, "lose-answer", 1);
    await r.readAll();
    const puts = r.stub.state.requests.filter((q) => q.method === "PUT" && q.path.endsWith("/experience"));
    expect(puts).toHaveLength(2);
    expect(puts[0]!.headers["content-digest"]).toBe(puts[1]!.headers["content-digest"]);
    expect(puts[0]!.bytes).toBe(puts[1]!.bytes);
    expect(puts[1]!.status).toBe(204); // identical bytes: a no-op on the server
    const stored = [...r.stub.state.captures.values()][0]!.sections.get("experience")!;
    expect(`sha-256=:${Buffer.from(stored.sha256, "hex").toString("base64")}:`).toBe(puts[1]!.headers["content-digest"]);
    expect(await r.phase()).toBe("done");
  });
});
