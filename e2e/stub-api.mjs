// A faithful stub of the Scouty capture API (plan section 5) and of the parts of its OAuth server
// the extension uses. It validates with the same schema file the extension builds from
// (src/protocol.ts), verifies digests and manifests, and has fault switches for the e2e suite.
// Used by the Playwright suite (over HTTP) and by the vitest contract tests (through handle()).
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { profileKeyFromSlug, slugFromPath } from "../src/profile-key.ts";
import { ACTIVITY_SECTIONS, LIMITS, PROTOCOL_VERSION, SECTION_NAMES, validateManifest, validateSectionPayload } from "../src/protocol.ts";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/;
const opaque = () => randomBytes(32).toString("base64url");
const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256Base64 = (bytes) => createHash("sha256").update(bytes).digest("base64");
const olderThan = (version, minimum) => {
  const a = String(version).split(".").map(Number);
  const b = String(minimum).split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
};

export const EXTENSION_SCOPE = "scouty:linkedin_capture";

export function createStubApi(options = {}) {
  const origin = options.origin ?? "https://scouty.to";
  const resource = `${origin}/api/linkedin/ext`;
  const state = {
    origin,
    now: options.now ?? (() => Date.now()),
    clients: options.clients ?? null, // null: any client id and redirect are accepted (tests)
    minVersion: options.minVersion ?? "0.1.0",
    storeUrl: options.storeUrl ?? "https://example.invalid/store",
    caps: { posts: 50, comments: 50, reactions: 50, ...(options.caps ?? {}) },
    capsBySlug: options.capsBySlug ?? {},
    capturesLeftToday: options.capturesLeftToday ?? 40,
    accessTtlMs: options.accessTtlMs ?? 15 * 60_000,
    captureTtlMs: options.captureTtlMs ?? 20 * 60_000,
    freshMs: 7 * 24 * 3600_000,
    // The app page named for a profile (path and query), after finalize and in a { recent } answer.
    appPath: options.appPath ?? ((profileKey) => `/dashboard?linkedin=${encodeURIComponent(profileKey)}`),
    // Servers before `recent.appUrl` was added leave it out.
    recentAppUrl: options.recentAppUrl ?? true,
    user: { name: "Synthetic Tester", email: "tester@example.invalid" },
    workspace: { id: "ws_synthetic", name: "Synthetic Workspace" },
    available: true,
    suppressed: new Set(options.suppressed ?? []),
    codes: new Map(), access: new Map(), refresh: new Map(), grants: new Map(),
    captures: new Map(), finalizedByKey: new Map(),
    requests: [],
    /** Fault switches: { match: RegExp, times, kind: "503" | "500" | "502" | "504" | "drop" | "429" | "429-long" | "401" | "disabled" | "lose-answer" } */
    faults: [],
  };

  const json = (status, body, headers = {}) => ({
    status, body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Authorization", ...headers },
  });
  const appUrlOf = (profileKey) => `${origin}${state.appPath(profileKey)}`;
  const recentAppUrl = (profileKey) => (state.recentAppUrl ? { appUrl: appUrlOf(profileKey) } : {});
  const error = (status, message, code, extra = {}, headers = {}) => json(status, { error: message, ...(code ? { code } : {}), ...extra }, headers);

  // ---- OAuth ----

  function authorize(url) {
    const p = url.searchParams;
    const redirectUri = p.get("redirect_uri") ?? "";
    const client = p.get("client_id") ?? "";
    if (state.clients && state.clients[client] !== redirectUri) return error(400, "Unknown client or redirect.", "invalid_request");
    if (p.get("response_type") !== "code" || p.get("code_challenge_method") !== "S256" || !p.get("code_challenge")) return error(400, "Bad request.", "invalid_request");
    if (p.get("scope") !== EXTENSION_SCOPE || p.get("resource") !== resource) return error(400, "Bad scope or resource.", "invalid_scope");
    const code = opaque();
    state.codes.set(code, { client, redirectUri, challenge: p.get("code_challenge"), used: false });
    const back = new URL(redirectUri);
    back.searchParams.set("code", code);
    if (p.get("state") !== null) back.searchParams.set("state", p.get("state"));
    back.searchParams.set("iss", origin);
    return { status: 302, headers: { Location: back.toString(), "Cache-Control": "no-store" }, body: null };
  }

  function issue(grantId) {
    const access = opaque();
    const refresh = opaque();
    state.access.set(access, { grantId, expiresAt: state.now() + state.accessTtlMs });
    state.refresh.set(refresh, { grantId, used: false });
    return json(200, { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: Math.round(state.accessTtlMs / 1000), scope: EXTENSION_SCOPE });
  }

  function token(form) {
    if (form.get("resource") !== resource) return error(400, "Bad resource.", "invalid_target");
    if (form.get("grant_type") === "authorization_code") {
      const entry = state.codes.get(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      if (!entry || entry.used || entry.client !== form.get("client_id") || entry.redirectUri !== form.get("redirect_uri") || entry.challenge !== challenge) {
        return error(400, "Invalid code.", "invalid_grant");
      }
      entry.used = true;
      const grantId = opaque();
      state.grants.set(grantId, { revoked: false, client: entry.client });
      return issue(grantId);
    }
    if (form.get("grant_type") === "refresh_token") {
      const entry = state.refresh.get(form.get("refresh_token") ?? "");
      const grant = entry ? state.grants.get(entry.grantId) : null;
      if (!entry || !grant || grant.revoked) return error(400, "Invalid refresh token.", "invalid_grant");
      if (entry.used) {
        grant.revoked = true; // reuse detection: the whole grant is revoked
        return error(400, "Refresh token reused.", "invalid_grant");
      }
      entry.used = true;
      return issue(entry.grantId);
    }
    return error(400, "Unsupported grant type.", "unsupported_grant_type");
  }

  function revoke(form) {
    const entry = state.refresh.get(form.get("token") ?? "");
    const grant = entry ? state.grants.get(entry.grantId) : null;
    if (grant) grant.revoked = true;
    return json(200, {});
  }

  // ---- capture API ----

  function extensionAuth(headers) {
    const version = headers["x-scouty-extension-version"];
    const protocol = headers["x-scouty-protocol"];
    if (!version || protocol !== String(PROTOCOL_VERSION) || olderThan(version, state.minVersion)) {
      return { fail: error(426, "Update the Scouty extension to continue.", "LINKEDIN_EXTENSION_OUTDATED", { minVersion: state.minVersion, storeUrl: state.storeUrl }) };
    }
    const bearer = /^Bearer (.+)$/.exec(headers.authorization ?? "")?.[1];
    const entry = bearer ? state.access.get(bearer) : null;
    const grant = entry ? state.grants.get(entry.grantId) : null;
    if (!entry || !grant || grant.revoked || entry.expiresAt <= state.now()) return { fail: error(401, "Connect the Scouty extension again.", "LINKEDIN_AUTH_REQUIRED") };
    const requestOrigin = headers.origin;
    if (requestOrigin && /^https?:/.test(requestOrigin)) return { fail: error(403, "Origin not allowed.", "LINKEDIN_ORIGIN_REFUSED") };
    if (!state.available) return { fail: error(403, "LinkedIn capture isn't available for this account.", "LINKEDIN_NOT_AVAILABLE") };
    return { grantId: entry.grantId };
  }

  function profileKeyOf(raw) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    const allowed = host === "linkedin.com" || host.endsWith(".linkedin.com") || host === (options.linkedinHost ?? "linkedin.test");
    if (!allowed) return null;
    const slug = slugFromPath(url.pathname);
    return slug ? profileKeyFromSlug(slug) : null;
  }

  function parseJson(bytes, limit) {
    if (bytes.length > limit) return { fail: error(413, "Too large.", "LINKEDIN_PAYLOAD_TOO_LARGE") };
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { fail: error(400, "Invalid encoding.", "LINKEDIN_INVALID_PAYLOAD") };
    }
    try {
      return { value: JSON.parse(text) };
    } catch {
      return { fail: error(400, "Invalid JSON.", "LINKEDIN_INVALID_PAYLOAD") };
    }
  }

  function countsOf(capture) {
    const count = (section) => capture.sections.get(section)?.blockCount ?? 0;
    const profileSections = ["profile", "experience", "skills"].reduce((sum, s) => sum + count(s), 0);
    return { profileSections, posts: count("posts"), comments: count("comments"), reactions: count("reactions") };
  }

  function ownedCapture(captureId, headers) {
    const capture = state.captures.get(captureId);
    const presented = headers["x-capture-token"] ?? "";
    if (!capture || sha256Hex(presented) !== capture.tokenHash) return { fail: error(404, "Capture not found.", "LINKEDIN_CAPTURE_NOT_FOUND") };
    if (capture.status === "expired" || (capture.status === "open" && capture.expiresAt <= state.now())) {
      capture.status = "expired";
      capture.sections.clear();
      return { fail: error(410, "This capture has expired.", "LINKEDIN_CAPTURE_EXPIRED") };
    }
    return { capture };
  }

  function createCapture(headers, bytes) {
    const key = headers["idempotency-key"];
    if (!key || !IDEMPOTENCY_KEY.test(key)) return error(400, "Idempotency-Key is required.", "LINKEDIN_INVALID_PAYLOAD");
    const parsed = parseJson(bytes, LIMITS.maxControlBodyBytes);
    if (parsed.fail) return parsed.fail;
    const body = parsed.value;
    if (!body || typeof body !== "object" || typeof body.linkedinUrl !== "string" || typeof body.recapture !== "boolean" || Object.keys(body).length !== 2) {
      return error(400, "Invalid request.", "LINKEDIN_INVALID_PAYLOAD");
    }
    const profileKey = profileKeyOf(body.linkedinUrl);
    if (!profileKey) return error(400, "That is not a LinkedIn profile address.", "LINKEDIN_URL_UNSUPPORTED");
    if (state.suppressed.has(profileKey)) return error(404, "This profile can't be captured.", "LINKEDIN_PROFILE_UNAVAILABLE");
    // A caller that lost the first answer repeats the create with the same key (as the app does).
    const sameKey = [...state.captures.values()].find((c) => c.idempotencyKey === key);
    if (sameKey && sameKey.profileKey !== profileKey) return error(400, "This request was already used for another profile.", "LINKEDIN_INVALID_PAYLOAD");
    if (sameKey?.status === "finalized") {
      if (sameKey.result.completeness === "insufficient") return error(409, "This capture is already finalized.", "LINKEDIN_CAPTURE_FINALIZED");
      return json(200, { recent: { finalizedAt: new Date(sameKey.finalizedAt).toISOString(), completeness: sameKey.result.completeness, counts: sameKey.result.captured, ...recentAppUrl(profileKey) } });
    }
    if (sameKey && (sameKey.status !== "open" || sameKey.expiresAt <= state.now())) return error(410, "This capture has expired.", "LINKEDIN_CAPTURE_EXPIRED");
    const recent = state.finalizedByKey.get(profileKey);
    if (!sameKey && !body.recapture && recent && state.now() - recent.finalizedAt < state.freshMs) {
      return json(200, { recent: { finalizedAt: new Date(recent.finalizedAt).toISOString(), completeness: recent.completeness, counts: recent.counts, ...recentAppUrl(profileKey) } });
    }
    // At most one open capture per profile: handed back with a new token and nothing staged.
    let capture = sameKey ?? [...state.captures.values()].find((c) => c.status === "open" && c.profileKey === profileKey && c.expiresAt > state.now());
    if (!capture) {
      if (state.capturesLeftToday <= 0) return error(429, "Your workspace has used today's captures.", "LINKEDIN_CAPTURE_LIMIT", {}, { "Retry-After": "3600" });
      state.capturesLeftToday -= 1;
      const caps = { ...state.caps, ...(state.capsBySlug[profileKey] ?? {}) };
      capture = {
        id: opaque(), profileKey, idempotencyKey: key, status: "open", caps,
        expected: ["profile", "experience", "skills", ...ACTIVITY_SECTIONS.filter((s) => caps[s] > 0)],
        sections: new Map(), manifestText: null, result: null,
      };
      state.captures.set(capture.id, capture);
    }
    // A repeated create mints a new upload token and clears what was staged (plan 5.5).
    const uploadToken = opaque();
    capture.tokenHash = sha256Hex(uploadToken);
    capture.sections.clear();
    capture.expiresAt = state.now() + state.captureTtlMs;
    return json(201, {
      captureId: capture.id, uploadToken, profileKey, profileUrl: `https://www.linkedin.com/in/${encodeURIComponent(profileKey)}/`,
      expected: capture.expected, caps: capture.caps, expiresAt: new Date(capture.expiresAt).toISOString(), serverTime: new Date(state.now()).toISOString(),
    });
  }

  function putSection(capture, section, headers, bytes) {
    if (capture.status === "finalized") return error(409, "This capture is already finalized.", "LINKEDIN_CAPTURE_FINALIZED");
    if (bytes.length > LIMITS.maxSectionBodyBytes) return error(413, "Too large.", "LINKEDIN_PAYLOAD_TOO_LARGE");
    const digest = /^sha-256=:([A-Za-z0-9+/=]+):$/.exec(headers["content-digest"] ?? "")?.[1];
    if (!digest || digest !== sha256Base64(bytes)) return error(400, "The upload did not arrive intact.", "LINKEDIN_DIGEST_MISMATCH");
    const parsed = parseJson(bytes, LIMITS.maxSectionBodyBytes);
    if (parsed.fail) return parsed.fail;
    const checked = validateSectionPayload(parsed.value);
    if (!checked.ok) return error(400, checked.message, checked.code);
    const payload = checked.value;
    if (payload.section !== section || !capture.expected.includes(section)) return error(400, "Section does not match the path.", "LINKEDIN_INVALID_PAYLOAD");
    if (profileKeyFromSlug(payload.pageSlug) !== capture.profileKey) return error(409, "This page belongs to a different profile.", "LINKEDIN_CAPTURE_TARGET_MISMATCH");
    const sha256 = sha256Hex(bytes);
    const stored = capture.sections.get(section);
    if (stored && stored.sha256 === sha256) return { status: 204, headers: { "Cache-Control": "no-store", Vary: "Authorization" }, body: null };
    if (stored && payload.seq <= stored.seq) return error(409, "A newer read of this section is already stored.", "LINKEDIN_SECTION_STALE");
    capture.sections.set(section, { seq: payload.seq, sha256, blockCount: payload.blockCount, byteLength: bytes.length, payload });
    return { status: 204, headers: { "Cache-Control": "no-store", Vary: "Authorization" }, body: null };
  }

  function completenessOf(capture, manifest) {
    const entry = (section) => manifest.sections.find((e) => e.section === section);
    const degraded = [...capture.sections.values()].some((s) => s.payload.read === "degraded");
    if (!degraded && manifest.sections.every((e) => e.state === "complete" || e.state === "unavailable")) return "complete";
    const profileOk = entry("profile")?.state === "complete";
    const activityOk = ACTIVITY_SECTIONS.some((s) => ["complete", "partial"].includes(entry(s)?.state) && (capture.sections.get(s)?.blockCount ?? 0) > 0);
    return profileOk || activityOk ? "partial" : "insufficient";
  }

  function finalize(capture, headers, bytes) {
    if (!IDEMPOTENCY_KEY.test(headers["idempotency-key"] ?? "")) return error(400, "Idempotency-Key is required.", "LINKEDIN_INVALID_PAYLOAD");
    const parsed = parseJson(bytes, LIMITS.maxControlBodyBytes);
    if (parsed.fail) return parsed.fail;
    const checked = validateManifest(parsed.value);
    if (!checked.ok) return error(400, checked.message, checked.code);
    const manifest = checked.value;
    const text = JSON.stringify(manifest);
    if (capture.status === "finalized") {
      return capture.manifestText === text ? json(200, capture.result) : error(409, "This capture is already finalized.", "LINKEDIN_CAPTURE_FINALIZED");
    }
    // Every expected section exactly once, and no other.
    const missing = capture.expected.filter((section) => !manifest.sections.some((e) => e.section === section));
    const mismatched = manifest.sections.filter((e) => !capture.expected.includes(e.section)).map((e) => e.section);
    for (const entry of manifest.sections) {
      const stored = capture.sections.get(entry.section);
      if (entry.state === "complete" || entry.state === "partial") {
        if (!stored) missing.push(entry.section);
        else if (stored.seq !== entry.seq || stored.sha256 !== entry.sha256 || stored.blockCount !== entry.blockCount) mismatched.push(entry.section);
      } else if (entry.state === "unavailable" && stored) {
        mismatched.push(entry.section);
      }
    }
    if (missing.length || mismatched.length) return error(409, "What was sent does not match what was received.", "LINKEDIN_MANIFEST_MISMATCH", { missing, mismatched });
    for (const entry of manifest.sections) if (entry.state === "skipped") capture.sections.delete(entry.section);
    const completeness = completenessOf(capture, manifest);
    capture.status = "finalized";
    capture.finalizedAt = state.now();
    capture.manifestText = text;
    capture.manifest = manifest;
    capture.result = {
      status: "finalized", completeness, captured: countsOf(capture),
      appUrl: appUrlOf(capture.profileKey),
    };
    if (completeness !== "insufficient") state.finalizedByKey.set(capture.profileKey, { finalizedAt: state.now(), completeness, counts: capture.result.captured });
    return json(200, capture.result);
  }

  function route(method, url, headers, bytes) {
    const path = url.pathname;
    const form = () => new URLSearchParams(new TextDecoder().decode(bytes));
    if (method === "GET" && path === "/oauth/authorize") return authorize(url);
    if (method === "POST" && path === "/oauth/token") return token(form());
    if (method === "POST" && path === "/oauth/revoke") return revoke(form());
    if (method === "GET" && (path === "/" || path === "/dashboard" || path.startsWith("/dashboard/") || path === "/privacy")) {
      return { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: "<!doctype html><title>Stub Scouty</title><h1>Stub Scouty app</h1>" };
    }
    if (!path.startsWith("/api/linkedin/ext/")) return error(404, "Not found.");
    const auth = extensionAuth(headers);
    if (auth.fail) return auth.fail;
    if (method !== "GET" && !/^application\/json\b/.test(headers["content-type"] ?? "")) return error(415, "Content-Type must be application/json.", "LINKEDIN_UNSUPPORTED_MEDIA_TYPE");
    if (method === "GET" && path === "/api/linkedin/ext/session") {
      return json(200, { protocol: PROTOCOL_VERSION, user: state.user, workspace: state.workspace, caps: state.caps, limits: { capturesLeftToday: state.capturesLeftToday }, serverTime: new Date(state.now()).toISOString() });
    }
    if (method === "POST" && path === "/api/linkedin/ext/captures") return createCapture(headers, bytes);
    const match = /^\/api\/linkedin\/ext\/captures\/([A-Za-z0-9_-]+)(?:\/(sections|finalize)(?:\/([a-z]+))?)?$/.exec(path);
    if (!match) return error(404, "Not found.");
    const owned = ownedCapture(match[1], headers);
    if (owned.fail) return owned.fail;
    const capture = owned.capture;
    if (method === "GET" && !match[2]) {
      return json(200, {
        status: capture.status,
        // As the app: a finalized capture lists nothing as received (its staging is gone).
        received: capture.status === "finalized" ? [] : [...capture.sections.entries()].map(([section, s]) => ({ section, seq: s.seq, sha256: s.sha256, blockCount: s.blockCount })),
        expiresAt: new Date(capture.expiresAt).toISOString(),
      });
    }
    if (method === "PUT" && match[2] === "sections" && SECTION_NAMES.includes(match[3])) return putSection(capture, match[3], headers, bytes);
    if (method === "POST" && match[2] === "finalize" && !match[3]) return finalize(capture, headers, bytes);
    return error(404, "Not found.");
  }

  /** Handles one request. `headers` has lower-case names; `body` is the raw bytes. Returns "drop" for a cut connection. */
  function handle({ method, url, headers = {}, body = new Uint8Array() }) {
    const parsed = new URL(url, origin);
    const record = { method, path: parsed.pathname, headers: { ...headers }, bytes: body.length, at: state.now() };
    state.requests.push(record);
    const fault = state.faults.find((f) => f.times > 0 && f.match.test(`${method} ${parsed.pathname}`));
    if (fault) {
      fault.times -= 1;
      record.fault = fault.kind;
      if (fault.kind === "drop") return "drop";
      if (fault.kind === "503") return error(503, "Scouty is busy. Try again.", "LINKEDIN_UNAVAILABLE");
      // A server fault (500) and gateway answers (502, 504), without a LINKEDIN_ code.
      if (fault.kind === "500" || fault.kind === "502" || fault.kind === "504") return error(Number(fault.kind), "Something went wrong.");
      if (fault.kind === "429") return error(429, "Slow down.", "LINKEDIN_RATE_LIMITED", {}, { "Retry-After": "1" });
      // The app's per-account rate limit: a wait longer than the client's backoff cap.
      if (fault.kind === "429-long") return error(429, "Slow down.", "LINKEDIN_RATE_LIMITED", {}, { "Retry-After": "60" });
      if (fault.kind === "disabled") return error(503, "The LinkedIn coach is not available yet.", "LINKEDIN_DISABLED");
      if (fault.kind === "lose-answer") {
        // The request is processed, but its answer never arrives.
        route(method, parsed, headers, body);
        return "drop";
      }
      if (fault.kind === "401") return error(401, "Connect the Scouty extension again.", "LINKEDIN_AUTH_REQUIRED");
    }
    const response = route(method, parsed, headers, body);
    record.status = response.status;
    return response;
  }

  function listen(port = 0) {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(", ") : (v ?? "")]));
        const response = api.handle({ method: req.method ?? "GET", url: req.url ?? "/", headers, body: new Uint8Array(Buffer.concat(chunks)) });
        if (response === "drop") return void req.socket.destroy();
        res.writeHead(response.status, response.headers);
        res.end(response.body ?? undefined);
      });
    });
    return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
  }

  // handle() is called through this object, so a test can wrap it.
  const api = {
    state, handle, listen,
    /** Makes every access token issued so far expired (the refresh tokens stay valid). */
    expireAccessTokens() { for (const entry of state.access.values()) entry.expiresAt = 0; },
    /** Revokes every connection, as the user would from Connected Apps. */
    revokeAll() { for (const grant of state.grants.values()) grant.revoked = true; },
    fail(match, kind, times = 1) { state.faults.push({ match, kind, times }); },
    clearFaults() { state.faults.length = 0; },
    /** A fetch() that talks to this stub in-process, for tests. */
    fetch: async (url, init = {}) => {
      const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
      const raw = init.body;
      const body = raw == null ? new Uint8Array() : typeof raw === "string" ? new TextEncoder().encode(raw) : new Uint8Array(raw);
      const response = api.handle({ method: init.method ?? "GET", url, headers, body });
      if (response === "drop") throw new TypeError("Failed to fetch");
      return new Response(response.status === 204 || response.status === 302 ? null : response.body, { status: response.status === 302 ? 200 : response.status, headers: response.headers });
    },
  };
  return api;
}
