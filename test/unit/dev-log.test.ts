import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_LOG_CAPTURES, devInfo, devRequest, recordCapture } from "../../src/background/dev-log";
import { summarize, summaryLine } from "../../src/dev-summary";
import type { ClickLogEntry } from "../../src/messages";
import { fake } from "../helpers/fake-ext";

const expand = (i: number): ClickLogEntry => ({ tag: "button", selector: "expandText: button[data-testid='expandable-text-button']", name: `… more ${i}`, container: "listitem" });
const loadMore: ClickLogEntry = { tag: "button", selector: "loadMore: button[data-load-more]", name: "Show more results", container: "main" };
const stray: ClickLogEntry = { tag: "button", selector: "expandText: ", name: "Follow", container: "section" };

afterEach(() => vi.restoreAllMocks());

describe("development click log (validation R4), outside the UI", () => {
  it("summarizes one capture in one line, naming every click that is not an allowed control", () => {
    const at = "2026-11-24T10:00:00.000Z";
    expect(summaryLine(summarize("p", Array.from({ length: 54 }, (_, i) => expand(i)), at))).toBe("Scouty dev: 54 clicks, all expand controls");
    expect(summaryLine(summarize("p", [], at))).toBe("Scouty dev: 0 clicks, nothing pressed");
    expect(summaryLine(summarize("p", [expand(1), loadMore], at))).toBe("Scouty dev: 2 clicks, 1 expand, 1 show more results");
    const bad = summarize("p", [expand(1), stray], at);
    expect(bad.other).toEqual([stray]);
    expect(summaryLine(bad)).toBe("Scouty dev: 2 clicks, 1 expand; NOT ALLOWED (1): Follow (expandText: , button in section)");
  });

  it("records each finished capture once, bounded, in memory-only storage, and prints the summary", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await recordCapture("capture-1", "synthetic-person-one", [expand(1), expand(2)]);
    await recordCapture("capture-1", "synthetic-person-one", [expand(1), expand(2)]);
    expect(info.mock.calls).toEqual([["Scouty dev: 2 clicks, all expand controls"]]);
    expect(fake.session.data.get("dev.clickLog")).toHaveLength(1);
    expect(fake.local.data.has("dev.clickLog")).toBe(false);
    for (let i = 2; i <= DEV_LOG_CAPTURES + 3; i += 1) await recordCapture(`capture-${i}`, "synthetic-person-one", [expand(i)]);
    const { captures, redirectUrl } = await devInfo();
    expect(captures).toHaveLength(DEV_LOG_CAPTURES);
    expect(captures.at(-1)!.entries).toEqual([expand(DEV_LOG_CAPTURES + 3)]);
    expect(redirectUrl).toBe(fake.redirectUrl);
  });

  it("answers only the popup's dev:info request", async () => {
    expect(devRequest({ type: "ui:getState" })).toBeNull();
    expect(await devRequest({ type: "dev:info" })).toEqual({ redirectUrl: fake.redirectUrl, captures: [] });
  });
});
