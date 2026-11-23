// Sign-in to Scouty: OAuth authorization code with PKCE through identity.launchWebAuthFlow.
// All token handling lives here. Access token: storage.session (memory). Refresh token:
// storage.local. Nothing goes to storage.sync, cookies, logs or any injected script.
import { API_ORIGIN, CLIENT_ID, OAUTH_RESOURCE, OAUTH_SCOPE, REFRESH_MARGIN_MS } from "../config";
import { ext } from "../ext";
import { ApiError, revokeRequest, tokenRequest, type TokenResponse, type TokenSource } from "./api";

const ACCESS_KEY = "auth.access";
const REFRESH_KEY = "auth.refresh";
const LOCK = "scouty-refresh";

type Access = { token: string; expiresAt: number };

let now: () => number = Date.now;
export function setAuthClock(clock: (() => number) | null): void {
  now = clock ?? Date.now;
}

let connectionEnded: () => Promise<void> | void = () => undefined;
/** Called when tokens were dropped because the connection ended (not on an explicit sign-out). */
export function onConnectionEnded(hook: () => Promise<void> | void): void {
  connectionEnded = hook;
}

// ---- PKCE ----

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function redirectUri(): string {
  return ext.identity.getRedirectURL();
}

export function authorizeUrl(input: { redirectUri: string; challenge: string; state: string }): string {
  const url = new URL("/oauth/authorize", API_ORIGIN);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", OAUTH_SCOPE);
  url.searchParams.set("resource", OAUTH_RESOURCE);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  return url.toString();
}

/** Reads the code from the redirect the browser handed back, refusing a wrong state or issuer. */
export function codeFromRedirect(returned: string | undefined, expected: { redirectUri: string; state: string }): string {
  if (!returned || !returned.startsWith(expected.redirectUri)) throw new Error("Sign-in did not finish.");
  const params = new URL(returned).searchParams;
  if (params.get("state") !== expected.state) throw new Error("Sign-in was refused: the response did not match the request.");
  if (params.get("iss") !== API_ORIGIN) throw new Error("Sign-in was refused: unexpected issuer.");
  if (params.get("error")) throw new Error("Sign-in was not approved.");
  const code = params.get("code");
  if (!code) throw new Error("Sign-in did not finish.");
  return code;
}

// ---- storage ----

async function store(tokens: TokenResponse): Promise<string> {
  const access: Access = { token: tokens.access_token, expiresAt: now() + Math.max(0, tokens.expires_in) * 1000 };
  await ext.storage.local.set({ [REFRESH_KEY]: tokens.refresh_token });
  await ext.storage.session.set({ [ACCESS_KEY]: access });
  return access.token;
}

async function readAccess(): Promise<Access | null> {
  const found = (await ext.storage.session.get(ACCESS_KEY))[ACCESS_KEY] as Access | undefined;
  return found && typeof found.token === "string" ? found : null;
}

async function readRefresh(): Promise<string | null> {
  const found = (await ext.storage.local.get(REFRESH_KEY))[REFRESH_KEY] as string | undefined;
  return typeof found === "string" && found ? found : null;
}

async function clearTokens(): Promise<void> {
  await ext.storage.session.remove(ACCESS_KEY);
  await ext.storage.local.remove(REFRESH_KEY);
}

/** Keeps extension storage out of reach of injected scripts where the browser supports the call. */
export async function hardenStorage(): Promise<void> {
  for (const area of [ext.storage.local, ext.storage.session]) {
    try {
      await area.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
    } catch {
      // Not supported here (Firefox, older Chromium): the areas are still not handed to the reader,
      // which contains no storage call at all.
    }
  }
}

export async function isConnected(): Promise<boolean> {
  return (await readRefresh()) !== null;
}

// ---- connect / disconnect ----

let attempt = 0;

/** Opens the browser's web-auth window on the app's consent page and stores the tokens it yields. */
export async function connect(): Promise<void> {
  const mine = (attempt += 1);
  const verifier = randomToken(48);
  const state = randomToken(24);
  const redirect = redirectUri();
  const url = authorizeUrl({ redirectUri: redirect, challenge: await challengeFor(verifier), state });
  const returned = await ext.identity.launchWebAuthFlow({ interactive: true, url });
  if (mine !== attempt) throw new Error("Sign-in was cancelled.");
  const code = codeFromRedirect(returned, { redirectUri: redirect, state });
  const tokens = await tokenRequest({
    grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirect, client_id: CLIENT_ID, resource: OAUTH_RESOURCE,
  });
  if (mine !== attempt) throw new Error("Sign-in was cancelled.");
  await store(tokens);
}

/** Makes a sign-in that is still open in another window count for nothing. */
export function cancelConnect(): void {
  attempt += 1;
}

/** Disconnect: revoke the refresh token on the server, then forget everything. */
export async function signOut(): Promise<void> {
  cancelConnect();
  const refresh = await readRefresh();
  try {
    if (refresh) await revokeRequest({ token: refresh, token_type_hint: "refresh_token", client_id: CLIENT_ID });
  } catch {
    // Revocation is best effort; the tokens are forgotten either way.
  }
  await clearTokens();
}

// ---- refresh (single flight) ----

let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (locks) return locks.request(LOCK, task) as Promise<T>;
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

/**
 * One refresh at a time, and never a second request with the same refresh token: the server
 * revokes the whole grant when a refresh token is presented twice. Inside the lock storage is
 * read again, so a caller that waited uses the token the first caller obtained.
 */
async function refresh(failed: string | null): Promise<string | null> {
  return withLock(async () => {
    const access = await readAccess();
    if (access && access.token !== failed && access.expiresAt - now() > REFRESH_MARGIN_MS) return access.token;
    const refreshToken = await readRefresh();
    if (!refreshToken) return null;
    try {
      const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: CLIENT_ID, resource: OAUTH_RESOURCE });
      return await store(tokens);
    } catch (error) {
      // A refresh is never retried. Whatever went wrong, the stored refresh token may already be
      // consumed, so the connection is treated as ended and the user connects again.
      void (error instanceof ApiError);
      await clearTokens();
      await connectionEnded();
      return null;
    }
  });
}

export const tokenSource: TokenSource = {
  async current() {
    const access = await readAccess();
    if (access && access.expiresAt - now() > REFRESH_MARGIN_MS) return access.token;
    return refresh(null);
  },
  refreshAfter401: (failed) => refresh(failed),
};
