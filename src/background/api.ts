// THE ONLY FILE THAT CALLS fetch.
// Every URL is built from config.API_ORIGIN and a fixed list of paths; anything else is refused.
import { API_ORIGIN, EXTENSION_VERSION, RETRY } from "../config";
import {
  PROTOCOL_VERSION, SECTION_NAMES, serialize,
  type CreateCreated, type CreateRecent, type CreateRequest, type ErrorBody, type FinalizeResponse, type Manifest,
  type SectionName, type SessionResponse, type StatusResponse,
} from "../protocol";

const ID = "[A-Za-z0-9_-]{8,128}";
const ALLOWED_PATHS: readonly RegExp[] = [
  /^\/oauth\/token$/,
  /^\/oauth\/revoke$/,
  /^\/api\/linkedin\/ext\/session$/,
  /^\/api\/linkedin\/ext\/captures$/,
  new RegExp(`^/api/linkedin/ext/captures/${ID}$`),
  new RegExp(`^/api/linkedin/ext/captures/${ID}/sections/(${SECTION_NAMES.join("|")})$`),
  new RegExp(`^/api/linkedin/ext/captures/${ID}/finalize$`),
];

/** Builds a Scouty API URL, or throws. The only way a request URL is made. */
export function apiUrl(path: string): string {
  if (!ALLOWED_PATHS.some((pattern) => pattern.test(path))) throw new Error("Refused: not a Scouty API path.");
  const url = new URL(path, API_ORIGIN);
  assertAllowedUrl(url.toString());
  return url.toString();
}

export function assertAllowedUrl(raw: string): void {
  const url = new URL(raw);
  if (url.origin !== API_ORIGIN || url.username || url.password || url.search || url.hash) throw new Error("Refused: not the Scouty API origin.");
  if (!ALLOWED_PATHS.some((pattern) => pattern.test(url.pathname))) throw new Error("Refused: not a Scouty API path.");
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string | null, readonly body: ErrorBody | null, readonly retryAfterMs: number | null) {
    super(`Scouty API ${status}${code ? ` ${code}` : ""}`);
  }
}
/** The request never got an answer (offline, connection dropped, timed out). */
export class NetworkError extends Error {}
/** No usable connection to Scouty: no token, or a 401 that a refresh did not cure. */
export class SignedOutError extends Error {}

export type TokenSource = {
  /** A valid access token (refreshing first when it is about to expire), or null when signed out. */
  current(): Promise<string | null>;
  /** Called once after a 401 with the token that failed. Returns a new token or null. */
  refreshAfter401(failed: string): Promise<string | null>;
};

export type ApiDeps = {
  /** Sends one request. The default is the platform fetch; tests put the API stub here. */
  transport: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  now: () => number;
};

const defaults: ApiDeps = {
  transport: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
  now: Date.now,
};
let deps: ApiDeps = defaults;
export function setApiDeps(over: Partial<ApiDeps> | null): void {
  deps = over ? { ...defaults, ...over } : defaults;
}

const REQUEST_TIMEOUT_MS = 25_000;
const RETRYABLE = new Set([408, 429]);
/** Codes that answer a 5xx but are not outages: the feature is switched off. Never retried. */
const FINAL_CODES = new Set(["LINKEDIN_DISABLED"]);
const retryable = (error: ApiError): boolean => (RETRYABLE.has(error.status) || error.status >= 500) && !(error.code !== null && FINAL_CODES.has(error.code));
const versionHeaders = (): Record<string, string> => ({
  "X-Scouty-Extension-Version": EXTENSION_VERSION,
  "X-Scouty-Protocol": String(PROTOCOL_VERSION),
});

function retryAfterMs(response: Response, now: number): number | null {
  const header = response.headers.get("Retry-After");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/** Exponential backoff with full jitter: base 1 s, doubling, capped at 30 s. */
export function backoffMs(attempt: number, random: () => number): number {
  return Math.round(random() * Math.min(RETRY.capMs, RETRY.baseMs * 2 ** (attempt - 1)));
}

type Call = {
  method: "GET" | "POST" | "PUT";
  path: string;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
  tokens: TokenSource | null;
  /** Retries stop when the next wait would pass this time (the capture's expiry). */
  deadline?: number;
  /** False for calls that must never be repeated (token refresh). */
  retry?: boolean;
  onRetry?: (attempt: number) => void;
};

async function errorFrom(response: Response): Promise<ApiError> {
  let body: ErrorBody | null = null;
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object") body = parsed as ErrorBody;
  } catch {
    body = null;
  }
  return new ApiError(response.status, typeof body?.code === "string" ? body.code : null, body, retryAfterMs(response, deps.now()));
}

async function call<T>(c: Call): Promise<T> {
  const url = apiUrl(c.path);
  let token = c.tokens ? await c.tokens.current() : null;
  if (c.tokens && !token) throw new SignedOutError("Not connected to Scouty.");
  let refreshed = false;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    let failure: ApiError | NetworkError;
    try {
      const headers: Record<string, string> = { Accept: "application/json", ...versionHeaders(), ...c.headers };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await deps.transport(url, {
        method: c.method, headers, body: c.body as BodyInit | undefined,
        credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) {
        if (response.status === 204) return null as T;
        return (await response.json()) as T;
      }
      if (response.status === 401 && c.tokens && token && !refreshed) {
        refreshed = true;
        token = await c.tokens.refreshAfter401(token);
        if (!token) throw new SignedOutError("The connection to Scouty ended.");
        attempt -= 1; // the one retry after a refresh is not a backoff attempt
        continue;
      }
      if (response.status === 401 && c.tokens) throw new SignedOutError("The connection to Scouty ended.");
      const answer = await errorFrom(response);
      failure = answer;
      if (!retryable(answer)) throw answer;
    } catch (error) {
      if (error instanceof ApiError || error instanceof SignedOutError) {
        if (!(error instanceof ApiError) || !retryable(error)) throw error;
        failure = error;
      } else {
        failure = new NetworkError(error instanceof Error ? error.message : "network error");
      }
    }
    if (c.retry === false || attempt >= RETRY.maxAttempts) throw failure;
    const hinted = failure instanceof ApiError ? failure.retryAfterMs : null;
    const delay = hinted ?? backoffMs(attempt, deps.random);
    // A wait longer than the backoff cap is not a retry, it is an answer (for example a daily limit).
    if (delay > RETRY.capMs) throw failure;
    if (c.deadline !== undefined && deps.now() + delay >= c.deadline) throw failure;
    c.onRetry?.(attempt);
    await deps.sleep(delay);
  }
}

// ---- OAuth endpoints (public client; no Authorization header) ----

export type TokenResponse = { access_token: string; refresh_token: string; expires_in: number; token_type: string; scope?: string };

/** POST /oauth/token. Never retried: a repeated refresh token would revoke the grant. */
export function tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
  return call<TokenResponse>({
    method: "POST", path: "/oauth/token", tokens: null, retry: false,
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString(),
  });
}

export function revokeRequest(form: Record<string, string>): Promise<unknown> {
  return call<unknown>({
    method: "POST", path: "/oauth/revoke", tokens: null, retry: false,
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString(),
  });
}

// ---- Capture API ----

const JSON_TYPE = { "Content-Type": "application/json" };
const encoder = new TextEncoder();

export type CaptureRef = { captureId: string; uploadToken: string; expiresAt: number };
export type SectionUpload = { section: SectionName; body: string; digestBase64: string };

export function createApi(tokens: TokenSource) {
  return {
    session: (): Promise<SessionResponse> => call({ method: "GET", path: "/api/linkedin/ext/session", tokens }),

    createCapture: (request: CreateRequest, idempotencyKey: string): Promise<CreateCreated | CreateRecent> =>
      call({
        method: "POST", path: "/api/linkedin/ext/captures", tokens,
        headers: { ...JSON_TYPE, "Idempotency-Key": idempotencyKey }, body: serialize(request),
      }),

    /** One PUT per section. The digest is over the exact bytes sent. */
    putSection: (capture: CaptureRef, upload: SectionUpload, onRetry?: (attempt: number) => void): Promise<null> =>
      call({
        method: "PUT", path: `/api/linkedin/ext/captures/${capture.captureId}/sections/${upload.section}`, tokens,
        headers: { ...JSON_TYPE, "X-Capture-Token": capture.uploadToken, "Content-Digest": `sha-256=:${upload.digestBase64}:` },
        body: encoder.encode(upload.body), deadline: capture.expiresAt, onRetry,
      }),

    finalize: (capture: CaptureRef, manifest: Manifest, idempotencyKey: string, onRetry?: (attempt: number) => void): Promise<FinalizeResponse> =>
      call({
        method: "POST", path: `/api/linkedin/ext/captures/${capture.captureId}/finalize`, tokens,
        headers: { ...JSON_TYPE, "X-Capture-Token": capture.uploadToken, "Idempotency-Key": idempotencyKey },
        body: serialize(manifest), deadline: capture.expiresAt, onRetry,
      }),

    status: (capture: CaptureRef): Promise<StatusResponse> =>
      call({
        method: "GET", path: `/api/linkedin/ext/captures/${capture.captureId}`, tokens,
        headers: { "X-Capture-Token": capture.uploadToken }, deadline: capture.expiresAt,
      }),
  };
}

export type Api = ReturnType<typeof createApi>;
