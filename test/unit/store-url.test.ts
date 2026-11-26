import { describe, expect, it } from "vitest";
import { noticeFor } from "../../src/background/session";
import { ApiError } from "../../src/background/api";
import { storeUrlFrom } from "../../src/background/store-url";

describe("store link from the server (426)", () => {
  it.each([
    "https://chromewebstore.google.com/detail/scouty/abcdefghijklmnopabcdefghijklmnop",
    "https://chrome.google.com/webstore/detail/abcdefghijklmnopabcdefghijklmnop",
    "https://microsoftedge.microsoft.com/addons/detail/abcdefghijklmnopabcdefghijklmnop",
    "https://addons.mozilla.org/firefox/addon/scouty-b2b-prospector/",
    "https://scouty.to/extension",
  ])("accepts %s", (url) => {
    expect(storeUrlFrom(url)).toBe(url);
  });

  it.each([
    "https://evil.example/extension",
    "https://chromewebstore.google.com.evil.example/detail/x",
    "https://addons.mozilla.org.evil.example/",
    "http://addons.mozilla.org/firefox/addon/x/",
    "https://addons.mozilla.org:8443/firefox/addon/x/",
    "https://user:pass@chromewebstore.google.com/detail/x",
    "https://scouty.to.evil.example/",
    "javascript:alert(1)",
    "data:text/html,hi",
    "not a url",
    "",
  ])("refuses %s", (url) => {
    expect(storeUrlFrom(url)).toBeNull();
  });

  it("refuses anything that is not a string", () => {
    for (const value of [null, undefined, 42, { href: "https://addons.mozilla.org/" }]) expect(storeUrlFrom(value)).toBeNull();
  });

  it("the outdated notice keeps only an allowed link", () => {
    const outdated = (storeUrl: unknown) => noticeFor(new ApiError(426, null, { error: "x", storeUrl } as never, null));
    expect(outdated("https://evil.example/")).toEqual({ kind: "outdated", storeUrl: null });
    expect(outdated("https://addons.mozilla.org/firefox/addon/x/")).toEqual({ kind: "outdated", storeUrl: "https://addons.mozilla.org/firefox/addon/x/" });
  });
});

describe("store link via the session info (popup)", () => {
  it("keeps only an allowed link", async () => {
    const { sessionInfo } = await import("../../src/background/ui-state");
    const api = { session: async () => { throw new ApiError(426, null, { error: "x", storeUrl: "https://phish.example/update" } as never, null); } };
    const info = await sessionInfo({ api, controller: null, connecting: () => false, now: () => 0 } as never, true);
    expect(info).toEqual({ kind: "outdated", storeUrl: null });
  });
});
