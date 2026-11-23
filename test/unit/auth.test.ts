import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiDeps } from "../../src/background/api";
import * as auth from "../../src/background/auth";
import { fake } from "../helpers/fake-ext";

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let respond: (call: Call) => Response | Promise<Response>;
let clock = 1_000_000;

const tokenJson = (n: number, expiresIn = 900): Response =>
  new Response(JSON.stringify({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: expiresIn, token_type: "Bearer" }), { status: 200 });
const body = (call: Call): URLSearchParams => new URLSearchParams(call.init.body as string);

beforeEach(() => {
  calls = [];
  clock = 1_000_000;
  auth.setAuthClock(() => clock);
  auth.onConnectionEnded(() => undefined);
  setApiDeps({ fetch: async (url, init) => { const call = { url, init }; calls.push(call); return respond(call); }, sleep: async () => undefined, now: () => clock });
});
afterEach(() => { setApiDeps(null); auth.setAuthClock(null); });

async function connectWith(redirect: (authorizeUrl: URL) => string | undefined): Promise<URL> {
  let seen: URL | null = null;
  fake.launchWebAuthFlow.mockImplementation(async (details) => { seen = new URL(details.url); return redirect(seen); });
  respond = () => tokenJson(1);
  await auth.connect();
  return seen!;
}
const approve = (u: URL): string => `${fake.redirectUrl}?code=the-code&state=${u.searchParams.get("state")}&iss=${encodeURIComponent("https://scouty.to")}`;

describe("auth", () => {
  it("the PKCE challenge is S256 of the verifier, base64url without padding", async () => {
    const verifier = auth.randomToken(48);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(await auth.challengeFor(verifier)).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("builds the authorize URL with exactly the parameters of the plan", async () => {
    const url = await connectWith(approve);
    expect(url.origin + url.pathname).toBe("https://scouty.to/oauth/authorize");
    expect([...url.searchParams.keys()].sort()).toEqual(["client_id", "code_challenge", "code_challenge_method", "redirect_uri", "resource", "response_type", "scope", "state"]);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code", client_id: "scouty-ext-chrome", redirect_uri: fake.redirectUrl, scope: "scouty:linkedin_capture",
      resource: "https://scouty.to/api/linkedin/ext", code_challenge_method: "S256",
    });
    expect(fake.launchWebAuthFlow).toHaveBeenCalledWith({ interactive: true, url: url.toString() });
  });

  it("exchanges the code with the verifier that matches the challenge", async () => {
    const url = await connectWith(approve);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://scouty.to/oauth/token");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
    const form = body(calls[0]!);
    expect([...form.keys()].sort()).toEqual(["client_id", "code", "code_verifier", "grant_type", "redirect_uri", "resource"]);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("the-code");
    expect(form.get("redirect_uri")).toBe(fake.redirectUrl);
    expect(form.get("client_id")).toBe("scouty-ext-chrome");
    expect(form.get("resource")).toBe("https://scouty.to/api/linkedin/ext");
    expect(createHash("sha256").update(form.get("code_verifier")!).digest("base64url")).toBe(url.searchParams.get("code_challenge"));
  });

  it("keeps the access token only in storage.session and the refresh token only in storage.local", async () => {
    await connectWith(approve);
    expect([...fake.session.data.keys()]).toEqual(["auth.access"]);
    expect(fake.session.data.get("auth.access")).toMatchObject({ token: "access-1", expiresAt: clock + 900_000 });
    expect([...fake.local.data.entries()]).toEqual([["auth.refresh", "refresh-1"]]);
    expect(JSON.stringify([...fake.local.data.values()])).not.toContain("access-1");
    expect(JSON.stringify([...fake.session.data.values()])).not.toContain("refresh-1");
    expect(fake.sync.writes).toEqual([]);
    expect(fake.sync.data.size).toBe(0);
    expect(await auth.isConnected()).toBe(true);
  });

  it("refuses a state mismatch, a wrong issuer, a denial and a foreign redirect, and stores nothing", async () => {
    const cases: ((u: URL) => string | undefined)[] = [
      () => `${fake.redirectUrl}?code=x&state=someone-elses&iss=https%3A%2F%2Fscouty.to`,
      (u) => `${fake.redirectUrl}?code=x&state=${u.searchParams.get("state")}&iss=https%3A%2F%2Fevil.example`,
      (u) => `${fake.redirectUrl}?code=x&state=${u.searchParams.get("state")}`,
      (u) => `${fake.redirectUrl}?error=access_denied&state=${u.searchParams.get("state")}&iss=https%3A%2F%2Fscouty.to`,
      (u) => `https://evil.example/?code=x&state=${u.searchParams.get("state")}&iss=https%3A%2F%2Fscouty.to`,
      () => undefined,
    ];
    for (const redirect of cases) {
      await expect(connectWith(redirect)).rejects.toThrow();
      expect(calls).toHaveLength(0);
      expect(fake.session.data.size + fake.local.data.size).toBe(0);
    }
  });

  it("a cancelled sign-in stores nothing even if the window later returns a code", async () => {
    let finish: (value: string) => void = () => undefined;
    let url: URL | null = null;
    fake.launchWebAuthFlow.mockImplementation((details) => { url = new URL(details.url); return new Promise<string>((resolve) => { finish = resolve; }); });
    respond = () => tokenJson(1);
    const pending = auth.connect();
    await vi.waitFor(() => expect(url).not.toBeNull());
    auth.cancelConnect();
    finish(approve(url!));
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(calls).toHaveLength(0);
    expect(await auth.isConnected()).toBe(false);
  });

  it("refreshes when under 60 seconds are left, with the refresh grant body", async () => {
    await connectWith(approve);
    calls = [];
    clock += 900_000 - 61_000;
    expect(await auth.tokenSource.current()).toBe("access-1");
    expect(calls).toHaveLength(0);
    clock += 2000;
    respond = () => tokenJson(2);
    expect(await auth.tokenSource.current()).toBe("access-2");
    expect(Object.fromEntries(body(calls[0]!))).toEqual({ grant_type: "refresh_token", refresh_token: "refresh-1", client_id: "scouty-ext-chrome", resource: "https://scouty.to/api/linkedin/ext" });
    expect(fake.local.data.get("auth.refresh")).toBe("refresh-2");
  });

  it("two concurrent calls with an expired token cause exactly one refresh", async () => {
    await connectWith(approve);
    calls = [];
    clock += 2_000_000;
    let release: () => void = () => undefined;
    respond = () => new Promise<Response>((resolve) => { release = () => resolve(tokenJson(2)); });
    const both = Promise.all([auth.tokenSource.current(), auth.tokenSource.current(), auth.tokenSource.refreshAfter401("access-1")]);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    release();
    expect(await both).toEqual(["access-2", "access-2", "access-2"]);
    expect(calls).toHaveLength(1);
  });

  it("a 401 with a token that is still the stored one forces a refresh", async () => {
    await connectWith(approve);
    calls = [];
    respond = () => tokenJson(2);
    expect(await auth.tokenSource.refreshAfter401("access-1")).toBe("access-2");
    expect(calls).toHaveLength(1);
  });

  it("invalid_grant clears both storage areas and reports the connection ended; the refresh is never retried", async () => {
    await connectWith(approve);
    calls = [];
    clock += 2_000_000;
    const ended = vi.fn();
    auth.onConnectionEnded(ended);
    respond = () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    expect(await auth.tokenSource.current()).toBeNull();
    expect(calls).toHaveLength(1);
    expect(fake.session.data.has("auth.access")).toBe(false);
    expect(fake.local.data.has("auth.refresh")).toBe(false);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(await auth.isConnected()).toBe(false);
  });

  it("a refresh whose answer is lost is not repeated: the user is signed out", async () => {
    await connectWith(approve);
    calls = [];
    clock += 2_000_000;
    respond = () => { throw new TypeError("network down"); };
    expect(await auth.tokenSource.current()).toBeNull();
    expect(calls).toHaveLength(1);
    expect(await auth.isConnected()).toBe(false);
  });

  it("sign-out revokes the refresh token, then forgets everything", async () => {
    await connectWith(approve);
    calls = [];
    respond = () => new Response(null, { status: 200 });
    await auth.signOut();
    expect(calls[0]!.url).toBe("https://scouty.to/oauth/revoke");
    expect(Object.fromEntries(body(calls[0]!))).toEqual({ token: "refresh-1", token_type_hint: "refresh_token", client_id: "scouty-ext-chrome" });
    expect(fake.session.data.size + fake.local.data.size).toBe(0);
  });

  it("asks for trusted-context storage where supported and survives where it is not (Firefox)", async () => {
    await auth.hardenStorage();
    expect(fake.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
    const original = fake.local.setAccessLevel;
    fake.local.setAccessLevel = undefined;
    fake.session.setAccessLevel = vi.fn(async () => { throw new Error("not implemented"); });
    await expect(auth.hardenStorage()).resolves.toBeUndefined();
    fake.local.setAccessLevel = original;
  });
});
