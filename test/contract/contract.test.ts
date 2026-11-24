import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as auth from "../../src/background/auth";
import { digest } from "../../src/background/outbox";
import {
  buildActivityPayload, buildManifest, buildProfilePayload, validateManifest, validateSectionPayload,
  type CreateCreated, type CreateRecent, type ErrorBody, type FinalizeResponse, type Manifest, type SectionName, type SectionPayload, type SessionResponse, type StatusResponse,
} from "../../src/protocol";
import type { StubApi } from "../../e2e/stub-api.mjs";
import { PROFILE_URL, rig, TAB } from "../helpers/session";
import { unwire, wire } from "../helpers/stub";

const dir = path.join(process.cwd(), "protocol-v1");
const walk = (d: string, base = ""): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), `${base}${e.name}/`) : [`${base}${e.name}`]));
const read = (file: string): string => readFileSync(path.join(dir, file), "utf8");
const json = <T>(file: string): T => JSON.parse(read(file)) as T;
const pretty = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";
const sha = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");

type Index = { protocol: number; valid: { file: string; kind: "section" | "manifest" | "create"; pathSection?: SectionName; sha256?: string }[]; invalid: string[] };
type Wrapped = { note: string; kind: "section" | "manifest" | "create"; pathSection: SectionName | null; expect: { status: number; code: string }; body: unknown };
const index = json<Index>("index.json");
const SECTIONS: SectionName[] = ["profile", "experience", "skills", "posts", "comments", "reactions"];

afterEach(() => unwire());

describe("protocol-v1 contract directory", () => {
  it("matches its checksum file", () => {
    const files = walk(dir).filter((file) => file !== "CHECKSUMS.sha256").sort();
    expect(read("CHECKSUMS.sha256")).toBe(files.map((file) => `${sha(readFileSync(path.join(dir, file)))}  ${file}`).join("\n") + "\n");
    expect(index.protocol).toBe(1);
    expect([...index.valid.map((v) => v.file), ...index.invalid, "index.json", ...walk(path.join(dir, "responses")).map((f) => `responses/${f}`)].sort()).toEqual(files);
  });

  // Release gate 3: when the app repository is checked out next to this one, the two copies must be identical.
  const appCopy = path.join(process.cwd(), "..", "scouty", "src", "lib", "linkedin", "__fixtures__", "protocol-v1");
  it.skipIf(!existsSync(appCopy))("is byte-identical to the app's copy", () => {
    expect(walk(appCopy).sort()).toEqual(walk(dir).sort());
    for (const file of walk(dir)) expect(readFileSync(path.join(appCopy, file), "utf8"), file).toBe(read(file));
  });

  it("is labelled synthetic and names only public or reserved hosts", () => {
    // Every host in a URL or an email address is a public host the extension already talks to, or a
    // name reserved for examples and tests (RFC 2606, RFC 6761). Anything else fails, internal or not.
    const PUBLIC = new Set(["www.linkedin.com", "scouty.to", "chromewebstore.google.com"]);
    const RESERVED = /(^|\.)(example|invalid|test|localhost)$|^example\.(com|net|org)$/;
    const hosts = new Set<string>();
    for (const file of walk(dir).filter((f) => f !== "CHECKSUMS.sha256")) {
      for (const m of read(file).matchAll(/\b[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@\s"]*@)?([^/?#:\s"]+)/gi)) hosts.add(m[1]!.toLowerCase());
      for (const m of read(file).matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) hosts.add(m[1]!.toLowerCase());
    }
    expect(hosts.size).toBeGreaterThan(0);
    expect([...hosts].filter((h) => !PUBLIC.has(h) && !RESERVED.test(h)).sort()).toEqual([]);
    expect(read("index.json")).toContain("All content is synthetic");
  });
});

describe("the extension's builders produce the valid example shapes", () => {
  it.each(index.valid.filter((v) => v.kind === "section"))("$file", async ({ file, pathSection, sha256 }) => {
    const example = json<SectionPayload>(file);
    const meta = {
      seq: example.seq, pageSlug: example.pageSlug, capturedAt: example.capturedAt, selectorsVersion: example.selectorsVersion,
      browser: example.browser, locale: example.locale, read: example.read, expanded: example.expanded, reachedCap: example.reachedCap,
    };
    const built = example.profile ? buildProfilePayload(example.section, meta, example.profile) : buildActivityPayload(example.section, meta, example.blocks);
    // Same keys, same order, same values: the builder's output prints to exactly the committed file.
    expect(pretty(built)).toBe(read(file));
    expect(example.section).toBe(pathSection);
    expect(validateSectionPayload(built)).toMatchObject({ ok: true });
    // The digest the extension computes over these bytes is the one the contract records.
    expect((await digest(read(file))).sha256).toBe(sha256);
  });

  it.each(index.valid.filter((v) => v.kind === "manifest"))("$file", ({ file }) => {
    const example = json<Manifest>(file);
    expect(pretty(buildManifest(example.sections, example.stop))).toBe(read(file));
    expect(validateManifest(example, SECTIONS)).toMatchObject({ ok: true });
  });

  it("the complete manifest records the digests of the six section files", () => {
    const manifest = json<Manifest>("valid/manifest-complete.json");
    for (const entry of manifest.sections) expect(entry.sha256).toBe(sha(read(`valid/section-${entry.section}.json`)));
  });

  it("the response examples have the shapes the extension reads", () => {
    const created = json<CreateCreated>("responses/create-created.json");
    expect(Object.keys(created).sort()).toEqual(["caps", "captureId", "expected", "expiresAt", "profileKey", "profileUrl", "serverTime", "uploadToken"]);
    const recent = json<CreateRecent>("responses/create-recent.json");
    expect(Object.keys(recent.recent.counts).sort()).toEqual(["comments", "posts", "profileSections", "reactions"]);
    const finalized = json<FinalizeResponse>("responses/finalize.json");
    expect(finalized).toMatchObject({ status: "finalized", completeness: "complete" });
    expect(Object.keys(finalized.captured).sort()).toEqual(["comments", "posts", "profileSections", "reactions"]);
    expect(new URL(finalized.appUrl).pathname).toMatch(APP_PATH);
    // The app may also name a campaign page; the extension opens whatever it names on the Scouty origin.
    for (const url of [finalized.appUrl, "https://scouty.example/dashboard/proj_1/campaigns/camp_1?linkedin=synthetic-person-0001&person=person_1"]) {
      expect(new URL(url).origin).toBe(new URL(finalized.appUrl).origin);
      expect(new URL(url).pathname).toMatch(APP_PATH);
    }
    // `recent.appUrl` is optional: the fixture predates it, and the extension falls back without it.
    expect(recent.recent.appUrl === undefined || new URL(recent.recent.appUrl).pathname.match(APP_PATH) !== null).toBe(true);
    expect(json<SessionResponse>("responses/session.json")).toMatchObject({ protocol: 1, limits: { capturesLeftToday: 40 } });
    expect(json<StatusResponse>("responses/status.json").received[0]).toMatchObject({ section: "profile", seq: 1 });
    expect(json<ErrorBody>("responses/error-manifest-mismatch.json")).toMatchObject({ code: "LINKEDIN_MANIFEST_MISMATCH", missing: ["reactions"], mismatched: ["posts"] });
    expect(json<ErrorBody>("responses/error-outdated.json")).toMatchObject({ code: "LINKEDIN_EXTENSION_OUTDATED", minVersion: "0.1.0" });
  });
});

/** The app pages a capture may name: the dashboard, or a campaign in a project. */
const APP_PATH = /^\/dashboard(\/[^/]+\/campaigns\/[^/]+)?$/;

describe("every example gets its recorded outcome from the stub that implements section 5", () => {
  type Session = { stub: StubApi; headers: Record<string, string>; id: string };
  const send = (s: Session, method: string, url: string, body: string, extra: Record<string, string> = {}) => {
    const bytes = new TextEncoder().encode(body);
    const res = s.stub.handle({ method, url, body: bytes, headers: { ...s.headers, "content-type": "application/json", "content-digest": `sha-256=:${createHash("sha256").update(bytes).digest("base64")}:`, ...extra } });
    if (res === "drop") throw new Error("dropped");
    return { status: res.status, code: res.body ? (JSON.parse(res.body) as { code?: string }).code : undefined, body: res.body };
  };

  async function open(uploadAll: boolean): Promise<Session> {
    const w = wire();
    await auth.connect();
    const access = [...w.stub.state.access.keys()].at(-1)!;
    const headers = { authorization: `Bearer ${access}`, "x-scouty-extension-version": "0.1.0", "x-scouty-protocol": "1" };
    const created = send({ stub: w.stub, headers, id: "" }, "POST", "/api/linkedin/ext/captures", read("valid/create-request.json"), { "idempotency-key": "contract-key-1" });
    expect(created.status).toBe(201);
    const answer = JSON.parse(created.body!) as CreateCreated;
    const s = { stub: w.stub, headers: { ...headers, "x-capture-token": answer.uploadToken }, id: answer.captureId };
    if (uploadAll) for (const section of SECTIONS) expect(send(s, "PUT", `/api/linkedin/ext/captures/${s.id}/sections/${section}`, read(`valid/section-${section}.json`)).status).toBe(204);
    return s;
  }

  it("the valid sections are accepted byte for byte and the complete manifest finalizes", async () => {
    const s = await open(true);
    const capture = s.stub.state.captures.get(s.id)!;
    for (const v of index.valid.filter((x) => x.kind === "section")) expect(capture.sections.get(v.pathSection!)!.sha256).toBe(v.sha256);
    const done = send(s, "POST", `/api/linkedin/ext/captures/${s.id}/finalize`, read("valid/manifest-complete.json"), { "idempotency-key": "contract-key-2" });
    expect(done).toMatchObject({ status: 200 });
    expect(JSON.parse(done.body!)).toMatchObject({ status: "finalized", completeness: "complete", captured: { posts: 3, comments: 2, reactions: 1 } });
  });

  it.each(index.invalid)("%s", async (file) => {
    const example = json<Wrapped>(file);
    const s = await open(example.kind === "manifest");
    const body = JSON.stringify(example.body);
    const answer =
      example.kind === "section" ? send(s, "PUT", `/api/linkedin/ext/captures/${s.id}/sections/${example.pathSection}`, body)
      : example.kind === "manifest" ? send(s, "POST", `/api/linkedin/ext/captures/${s.id}/finalize`, body, { "idempotency-key": "contract-key-3" })
      : send(s, "POST", "/api/linkedin/ext/captures", body, { "idempotency-key": "contract-key-4" });
    expect({ status: answer.status, code: answer.code }).toEqual(example.expect);
    // The extension's own mirror of the schema agrees wherever the schema alone decides.
    if (example.expect.code === "LINKEDIN_INVALID_PAYLOAD" && example.kind === "section" && (example.body as { section?: string }).section === example.pathSection) {
      expect(validateSectionPayload(example.body).ok).toBe(false);
    }
    if (example.expect.code === "LINKEDIN_INVALID_PAYLOAD" && example.kind === "manifest") expect(validateManifest(example.body).ok).toBe(false);
  });
});

describe("the API client's requests against the stub", () => {
  it("a whole capture: method, path, headers and digest of every request are accepted", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.readAll();
    const id = [...r.stub.state.captures.keys()][0]!;
    expect(r.stub.state.requests.map((q) => `${q.method} ${q.path.replace(id, ":id")} ${q.status}`)).toEqual([
      "POST /api/linkedin/ext/captures 201",
      ...SECTIONS.map((s) => `PUT /api/linkedin/ext/captures/:id/sections/${s} 204`),
      "POST /api/linkedin/ext/captures/:id/finalize 200",
    ]);
    for (const q of r.stub.state.requests) {
      expect(q.headers["x-scouty-protocol"]).toBe("1");
      expect(q.headers["x-scouty-extension-version"]).toBe("0.1.0");
      expect(q.headers["content-type"]).toBe("application/json");
      expect(q.headers.cookie).toBeUndefined();
    }
    const [create, ...rest] = r.stub.state.requests;
    expect(create!.headers["idempotency-key"]).toMatch(/^[A-Za-z0-9._:-]{8,200}$/);
    expect(create!.headers["x-capture-token"]).toBeUndefined();
    for (const q of rest) expect(q.headers["x-capture-token"]).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    for (const q of rest.slice(0, 6)) expect(q.headers["content-digest"]).toMatch(/^sha-256=:[A-Za-z0-9+/]{43}=:$/);
    expect(rest[6]!.headers["idempotency-key"]).toMatch(/^[A-Za-z0-9._:-]{8,200}$/);
    expect(r.stub.state.captures.get(id)!.result).toMatchObject({ status: "finalized", completeness: "complete" });
  });

  it("the stub refuses a wrong content type, a missing or wrong digest, a wrong token, a stale read and anything after finalize", async () => {
    const r = await rig();
    await r.controller.start({ tabId: TAB, url: PROFILE_URL, recapture: false });
    await r.read();
    const id = [...r.stub.state.captures.keys()][0]!;
    const put = r.stub.state.requests.find((q) => q.method === "PUT")!;
    const stored = r.stub.state.captures.get(id)!.sections.get("profile")!.payload;
    const call = (body: string, over: Record<string, string> = {}) => {
      const bytes = new TextEncoder().encode(body);
      const res = r.stub.handle({ method: "PUT", url: `/api/linkedin/ext/captures/${id}/sections/profile`, body: bytes, headers: { ...put.headers, "content-digest": `sha-256=:${createHash("sha256").update(bytes).digest("base64")}:`, ...over } });
      return res === "drop" ? null : { status: res.status, code: res.body ? (JSON.parse(res.body) as { code?: string }).code : undefined };
    };
    const same = JSON.stringify(stored);
    expect(call(same)).toEqual({ status: 204, code: undefined }); // identical bytes: nothing changes
    expect(call(same, { "content-type": "text/plain" })).toEqual({ status: 415, code: "LINKEDIN_UNSUPPORTED_MEDIA_TYPE" });
    expect(call(same, { "content-digest": "" })).toEqual({ status: 400, code: "LINKEDIN_DIGEST_MISMATCH" });
    expect(call(same, { "content-digest": "sha-256=:AAAA:" })).toEqual({ status: 400, code: "LINKEDIN_DIGEST_MISMATCH" });
    expect(call(same, { "x-capture-token": "wrong" })).toEqual({ status: 404, code: "LINKEDIN_CAPTURE_NOT_FOUND" });
    expect(call(JSON.stringify({ ...stored, locale: "vi" }))).toEqual({ status: 409, code: "LINKEDIN_SECTION_STALE" });
    expect(call(JSON.stringify({ ...stored, seq: 2 }))).toEqual({ status: 204, code: undefined }); // a re-read replaces
    expect(call("x".repeat(1_500_001))).toEqual({ status: 413, code: "LINKEDIN_PAYLOAD_TOO_LARGE" });
    await r.controller.userStop();
    r.timers.find((t) => t.ms === 6000)?.fire();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await r.controller.settledWork();
    // The manifest named seq 1 for the profile but the server holds seq 2: one reconcile cannot fix a stale read.
    expect((await r.controller.current()).phase).toBe("idle");
  });
});
