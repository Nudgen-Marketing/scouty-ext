// Sign-in to Scouty: OAuth authorization code with PKCE through identity.launchWebAuthFlow.
// All token handling lives here. Access token: storage.session (memory). Refresh token:
// storage.local. Nothing goes to storage.sync, cookies, logs or any injected script.
import { API_ORIGIN, CLIENT_ID, OAUTH_RESOURCE, OAUTH_SCOPE, REFRESH_MARGIN_MS } from "../config";
import { ext } from "../ext";
import { ApiError, NetworkError, revokeRequest, tokenRequest, type TokenResponse, type TokenSource } from "./api";

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

export function authorizeUrl(input: { redirectUri: string; challenge: string; state: string; create?: boolean }): string {
  const url = new URL("/oauth/authorize", API_ORIGIN);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", OAUTH_SCOPE);
  url.searchParams.set("resource", OAUTH_RESOURCE);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  // OpenID Connect "prompt=create": the app shows sign-up first to someone who is signed out.
  if (input.create) url.searchParams.set("prompt", "create");
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

/**
 * Asks for each storage area to be limited to trusted contexts (extension pages and the background)
 * where the browser accepts the call. What it protects (browser-compat-data, docs/BROWSER-FACTS.md):
 * storage.session (the access token) is limited by default in Chromium, so the call only confirms it;
 * storage.local (the refresh token) accepts the call from Chrome 140 only. On Chrome 116-139 the call
 * on storage.local is refused, and Firefox implements neither, so there the refresh token can be read
 * by the extension's own content scripts. Accepted (deviation 28): those scripts are our own code and
 * contain no storage call, and no script of the page can reach extension storage.
 */
export async function hardenStorage(): Promise<void> {
  for (const area of [ext.storage.session, ext.storage.local]) {
    try {
      await area.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
    } catch {
      // Refused (storage.local before Chrome 140): the area keeps the browser's default.
    }
  }
}

export async function isConnected(): Promise<boolean> {
  return (await readRefresh()) !== null;
}

// ---- connect / disconnect ----

let attempt = 0;

/**
 * Opens the browser's web-auth window on the app's consent page and stores the tokens it yields.
 * `create`: the person has no Scouty account yet, so the app starts them on sign-up.
 */
export async function connect(options: { create?: boolean } = {}): Promise<void> {
  const mine = (attempt += 1);
  const verifier = randomToken(48);
  const state = randomToken(24);
  const redirect = redirectUri();
  const url = authorizeUrl({ redirectUri: redirect, challenge: await challengeFor(verifier), state, create: options.create });
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
  // Inside the refresh lock: a refresh in flight finishes (and stores) first, then this revokes and
  // clears what it stored, so a sign-out is never undone by a refresh that ends after it.
  await withLock(async () => {
    const refresh = await readRefresh();
    try {
      if (refresh) await revokeRequest({ token: refresh, token_type_hint: "refresh_token", client_id: CLIENT_ID });
    } catch {
      // Revocation is best effort; the tokens are forgotten either way.
    }
    await clearTokens();
  });
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

/** The browser says it has no network: a request now would only fail. */
const offline = (): boolean => (globalThis.navigator as Navigator | undefined)?.onLine === false;

/**
 * True when the token endpoint itself refused the refresh token (invalid_grant and the like answer
 * 400; a refused client 401): the grant is gone and the user has to connect again.
 */
export function refreshRefused(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 400 || error.status === 401);
}

/**
 * One refresh at a time, and never a second request with the same refresh token: the server
 * revokes the whole grant when a refresh token is presented twice. Inside the lock storage is
 * read again, so a caller that waited uses the token the first caller obtained.
 *
 * Only the token endpoint's own refusal (400/401) ends the connection. A refresh that got no answer
 * (offline, connection dropped, timed out) keeps the tokens and throws a NetworkError, which the
 * capture shows as "You're offline"; any other answer (a 5xx) keeps them too and is thrown as is.
 * If the lost request did reach the server, the stored refresh token was already used and the next
 * refresh is answered invalid_grant, which ends the connection then.
 */
async function refresh(failed: string | null): Promise<string | null> {
  return withLock(async () => {
    const access = await readAccess();
    if (access && access.token !== failed && access.expiresAt - now() > REFRESH_MARGIN_MS) return access.token;
    const refreshToken = await readRefresh();
    if (!refreshToken) return null;
    // Not sent at all while the browser knows it is offline: the refresh token stays unused.
    if (offline()) throw new NetworkError("offline");
    try {
      const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: CLIENT_ID, resource: OAUTH_RESOURCE });
      return await store(tokens);
    } catch (error) {
      // A refresh is never retried here.
      if (refreshRefused(error)) {
        await clearTokens();
        await connectionEnded();
        return null;
      }
      if (error instanceof ApiError) throw error;
      throw error instanceof NetworkError ? error : new NetworkError(error instanceof Error ? error.message : "network error");
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
