import { describe, expect, it } from "vitest";
import { CUT_MARKER, clampHead, clampHeadTail, fitByteBudget, utf8Length } from "../../src/reader/clamp";

describe("clamp", () => {
  it("leaves short text alone", () => {
    expect(clampHeadTail("short")).toEqual({ text: "short", clamped: false });
    expect(clampHeadTail("x".repeat(4000)).clamped).toBe(false);
  });

  it("keeps the head and the tail of a long block, within the limit", () => {
    const text = "HEAD" + "a".repeat(6000) + "THE-END";
    const out = clampHeadTail(text);
    expect(out.clamped).toBe(true);
    expect(out.text.length).toBe(4000);
    expect(out.text.startsWith("HEAD")).toBe(true);
    expect(out.text.endsWith("THE-END")).toBe(true);
    expect(out.text.indexOf(CUT_MARKER)).toBe(1200);
  });

  it("never splits a surrogate pair and keeps emoji and right-to-left text whole", () => {
    const text = "🙂".repeat(1500) + "שלום" + "🙂".repeat(1500);
    const out = clampHeadTail(text, 4000, 1201);
    expect(out.text.length).toBeLessThanOrEqual(4000);
    expect(out.text.isWellFormed()).toBe(true);
    const rtl = "قيد الاختبار ".repeat(400);
    const clamped = clampHeadTail(rtl);
    expect(clamped.text.isWellFormed()).toBe(true);
    expect(clamped.text.endsWith(rtl.slice(-20))).toBe(true);
    expect(clampHead("🙂🙂🙂", 3).text).toBe("🙂");
  });

  it("measures the byte budget in UTF-8 bytes", () => {
    expect(utf8Length("aé🙂")).toBe(1 + 2 + 4);
    const items = [{ text: "🙂".repeat(10) }, { text: "🙂".repeat(10) }, { text: "🙂".repeat(10) }];
    const one = utf8Length(JSON.stringify(items[0])) + 1; // {"text":"…"} is 11 bytes of JSON, 40 of emoji, plus the separator
    expect(one).toBe(52);
    expect(fitByteBudget(items, 0, one * 2)).toEqual({ kept: items.slice(0, 2), cut: true });
    expect(fitByteBudget(items, 0, one * 3)).toEqual({ kept: items, cut: false });
    expect(fitByteBudget(items, one * 3, one * 3).kept).toEqual([]);
  });
});
