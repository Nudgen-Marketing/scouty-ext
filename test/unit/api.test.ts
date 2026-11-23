import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError, NetworkError, SignedOutError, apiUrl, assertAllowedUrl, backoffMs, setApiDeps, type CaptureRef } from "../../src/background/api";
import * as auth from "../../src/background/auth";
import { serialize, type CreateCreated } from "../../src/protocol";
import { samplePayload, unwire, wire, type Wired } from "../helpers/stub";

let w: Wired;
const PROFILE = "https://www.linkedin.com/in/synthetic-person-one/";

async function created(): Promise<CaptureRef> {
  const answer = (await w.api.createCapture({ linkedinUrl: PROFILE, recapture: false }, "idem-0001")) as CreateCreated;
  return { captureId: answer.captureId, uploadToken: answer.uploadToken, expiresAt: Date.parse(answer.expiresAt) };
}
const upload = (text = "Invented text") => {
  const body = serialize(samplePayload("posts", 1, "synthetic-person-one", text));
  return { section: "posts" as const, body, digestBase64: createHash("sha256").update(body, "utf8").digest("base64") };
};

beforeEach(async () => { w = wire(); await auth.connect(); w.stub.state.requests.length = 0; });
afterEach(() => unwire());

describe("api client", () => {
  it("refuses any URL outside the API origin and the fixed path list", () => {
    expect(apiUrl("/api/linkedin/ext/session")).toBe("https://scouty.to/api/linkedin/ext/session");
    for (const path of [
      "/api/me", "/api/linkedin/coach", "/oauth/authorize", "/api/linkedin/ext/captures/../../me", "/api/linkedin/ext/captures/abcdefgh/sections/contact",
      "//evil.example/oauth/token", "https://evil.example/oauth/token", "/oauth/token?x=1", "/api/linkedin/ext/captures/abcdefgh/sections/posts/extra", "",
    ]) expect(() => apiUrl(path), path).toThrow(/Refused/);
    for (const url of [
      "https://www.linkedin.com/in/someone/", "https://scouty.to.evil.example/oauth/token", "http://scouty.to/oauth/token", "https://scouty.to:8443/oauth/token",
      "https://user@scouty.to/oauth/token", "https://scouty.to/oauth/token#x", "https://scouty.to/api/other",
    ]) expect(() => assertAllowedUrl(url), url).toThrow(/Refused/);
    expect(() => assertAllowedUrl("https://scouty.to/oauth/revoke")).not.toThrow();
  });

  it("sends the version, protocol and bearer headers on every capture call", async () => {
    const ref = await created();
    await w.api.session();
    await w.api.putSection(ref, upload());
    await w.api.status(ref);
    expect(w.stub.state.requests.length).toBe(4);
    for (const request of w.stub.state.requests) {
      expect(request.headers["x-scouty-extension-version"]).toBe("0.1.0");
      expect(request.headers["x-scouty-protocol"]).toBe("1");
      expect(request.headers.authorization).toMatch(/^Bearer .{20,}$/);
      expect(request.status).toBeLessThan(300);
    }
    expect(w.stub.state.requests.map((r) => `${r.method} ${r.path.replace(ref.captureId, ":id")}`)).toEqual([
      "POST /api/linkedin/ext/captures", "GET /api/linkedin/ext/session", "PUT /api/linkedin/ext/captures/:id/sections/posts", "GET /api/linkedin/ext/captures/:id",
    ]);
  });

  it("Content-Digest is the SHA-256 of the exact body bytes, multi-byte text included", async () => {
    const ref = await created();
    const seen: { digest: string; bytes: Uint8Array }[] = [];
    setApiDeps({ transport: (url, init) => { seen.push({ digest: (init.headers as Record<string, string>)["Content-Digest"]!, bytes: init.body as Uint8Array }); return w.stub.fetch(url, init); }, sleep: async () => undefined });
    const text = "قيد الاختبار 🙂 Tiếng Việt 日本語   \"quoted\"";
    const item = upload(text);
    await expect(w.api.putSection(ref, item)).resolves.toBeNull();
    expect(ArrayBuffer.isView(seen[0]!.bytes)).toBe(true);
    expect(seen[0]!.digest).toBe(`sha-256=:${createHash("sha256").update(seen[0]!.bytes).digest("base64")}:`);
    expect(new TextDecoder().decode(seen[0]!.bytes)).toBe(item.body);
    // The stub verified it too: a wrong digest is refused and nothing is stored.
    await expect(w.api.putSection(ref, { ...upload("other"), digestBase64: item.digestBase64 })).rejects.toMatchObject({ status: 400, code: "LINKEDIN_DIGEST_MISMATCH" });
  });

  it("keeps the Idempotency-Key stable across retries of the same operation", async () => {
    w.stub.fail(/POST \/api\/linkedin\/ext\/captures$/, "503", 2);
    await w.api.createCapture({ linkedinUrl: PROFILE, recapture: false }, "idem-stable");
    const creates = w.stub.state.requests.filter((r) => r.path === "/api/linkedin/ext/captures");
    expect(creates).toHaveLength(3);
    expect(new Set(creates.map((r) => r.headers["idempotency-key"]))).toEqual(new Set(["idem-stable"]));
  });

  it("backs off with full jitter, doubling from 1 s and capped at 30 s", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => backoffMs(n, () => 1))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(backoffMs(3, () => 0)).toBe(0);
    expect(backoffMs(3, () => 0.5)).toBe(2000);
  });

  it("retries network errors and 5xx at most 6 times, then gives up", async () => {
    w.stub.fail(/GET \/api\/linkedin\/ext\/session/, "503", 99);
    await expect(w.api.session()).rejects.toMatchObject({ status: 503 });
    expect(w.stub.state.requests).toHaveLength(6);
    expect(w.sleeps).toEqual([500, 1000, 2000, 4000, 8000]);
    w.stub.clearFaults();
    w.stub.state.requests.length = 0;
    w.stub.fail(/GET \/api\/linkedin\/ext\/session/, "drop", 99);
    await expect(w.api.session()).rejects.toBeInstanceOf(NetworkError);
    expect(w.stub.state.requests).toHaveLength(6);
  });

  it("recovers when the server comes back (503 twice, then success)", async () => {
    w.stub.fail(/GET \/api\/linkedin\/ext\/session/, "503", 2);
    await expect(w.api.session()).resolves.toMatchObject({ protocol: 1 });
    expect(w.stub.state.requests).toHaveLength(3);
  });

  it("honours Retry-After", async () => {
    w.stub.fail(/GET \/api\/linkedin\/ext\/session/, "429", 1);
    await w.api.session();
    expect(w.sleeps).toEqual([1000]);
  });

  it("never retries past the capture's expiry", async () => {
    const ref = await created();
    w.stub.state.requests.length = 0;
    w.stub.fail(/PUT /, "503", 99);
    await expect(w.api.putSection({ ...ref, expiresAt: w.clock.now + 2500 }, upload())).rejects.toMatchObject({ status: 503 });
    // Waits of 0.5 s and 1 s fit; the 2 s wait would pass the expiry.
    expect(w.sleeps).toEqual([500, 1000]);
    expect(w.stub.state.requests).toHaveLength(3);
  });

  it.each([
    [400, "LINKEDIN_INVALID_PAYLOAD"], [403, "LINKEDIN_NOT_AVAILABLE"], [404, "LINKEDIN_CAPTURE_NOT_FOUND"], [409, "LINKEDIN_CAPTURE_FINALIZED"],
    [410, "LINKEDIN_CAPTURE_EXPIRED"], [413, "LINKEDIN_PAYLOAD_TOO_LARGE"], [415, null], [426, "LINKEDIN_EXTENSION_OUTDATED"],
  ])("does not retry %i", async (status, code) => {
    let calls = 0;
    setApiDeps({ transport: async () => { calls += 1; return new Response(JSON.stringify({ error: "x", ...(code ? { code } : {}) }), { status }); }, sleep: async () => undefined });
    const error = await w.api.session().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, code });
    expect(calls).toBe(1);
  });

  it("the outdated answer carries the minimum version and the store link", async () => {
    w.stub.state.minVersion = "9.0.0";
    await expect(w.api.session()).rejects.toMatchObject({ status: 426, body: { minVersion: "9.0.0", storeUrl: "https://example.invalid/store" } });
  });

  it("on a 401, refreshes once and retries once", async () => {
    w.stub.expireAccessTokens();
    await expect(w.api.session()).resolves.toMatchObject({ protocol: 1 });
    expect(w.stub.state.requests.map((r) => `${r.path} ${r.status}`)).toEqual([
      "/api/linkedin/ext/session 401", "/oauth/token 200", "/api/linkedin/ext/session 200",
    ]);
  });

  it("a 401 after the refresh ends the connection instead of looping", async () => {
    w.stub.fail(/GET \/api\/linkedin\/ext\/session/, "401", 99);
    await expect(w.api.session()).rejects.toBeInstanceOf(SignedOutError);
    expect(w.stub.state.requests.filter((r) => r.path.endsWith("/session"))).toHaveLength(2);
    expect(w.stub.state.requests.filter((r) => r.path === "/oauth/token")).toHaveLength(1);
  });

  it("a revoked connection ends with SignedOutError and no tokens", async () => {
    w.stub.revokeAll();
    await expect(w.api.session()).rejects.toBeInstanceOf(SignedOutError);
    expect(await auth.isConnected()).toBe(false);
  });

  it("without a connection nothing is sent", async () => {
    await auth.signOut();
    w.stub.state.requests.length = 0;
    await expect(w.api.session()).rejects.toBeInstanceOf(SignedOutError);
    expect(w.stub.state.requests).toHaveLength(0);
  });

  it("never sends cookies or follows redirects", async () => {
    let init: RequestInit | null = null;
    setApiDeps({ transport: async (url, i) => { init = i; return w.stub.fetch(url, i); }, sleep: async () => undefined });
    await w.api.session();
    expect(init).toMatchObject({ credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store" });
  });
});
