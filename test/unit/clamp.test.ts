import { describe, expect, it } from "vitest";
import { CUT_MARKER, clampHead, clampHeadTail, codePointLength, fitByteBudget, utf8Length } from "../../src/reader/clamp";

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

  it("counts code points: 5,000 emoji clamp to at most 4,000, head kept, original tail kept, no lone surrogates", () => {
    expect(codePointLength(CUT_MARKER)).toBe(5);
    const emoji = "🙂".repeat(1200) + "🎉".repeat(3800 - 1) + "🏁"; // 5,000 code points, 10,000 UTF-16 units
    expect(codePointLength(emoji)).toBe(5000);
    const out = clampHeadTail(emoji);
    expect(out.clamped).toBe(true);
    expect(codePointLength(out.text)).toBeLessThanOrEqual(4000);
    expect(codePointLength(out.text)).toBe(4000);
    expect(out.text.startsWith("🙂".repeat(1200) + CUT_MARKER)).toBe(true);
    const tail = Array.from(emoji).slice(-(4000 - 1200 - 5)).join("");
    expect(out.text.endsWith(tail)).toBe(true);
    expect(out.text.endsWith("🏁")).toBe(true);
    expect(out.text.isWellFormed()).toBe(true);
    // 4,000 emoji are 8,000 UTF-16 units but within the limit: left alone.
    expect(clampHeadTail("🙂".repeat(4000))).toEqual({ text: "🙂".repeat(4000), clamped: false });
  });

  it("never splits a surrogate pair and keeps emoji and right-to-left text whole", () => {
    const text = "🙂".repeat(2500) + "שלום" + "🙂".repeat(2500);
    const out = clampHeadTail(text, 4000, 1201);
    expect(codePointLength(out.text)).toBeLessThanOrEqual(4000);
    expect(out.text.isWellFormed()).toBe(true);
    const rtl = "قيد الاختبار ".repeat(400);
    const clamped = clampHeadTail(rtl);
    expect(clamped.text.isWellFormed()).toBe(true);
    expect(clamped.text.endsWith(rtl.slice(-20))).toBe(true);
    expect(clampHead("🙂🙂🙂", 3)).toEqual({ text: "🙂🙂🙂", clamped: false });
    expect(clampHead("🙂🙂🙂🙂", 3)).toEqual({ text: "🙂🙂🙂", clamped: true });
    expect(clampHead("a🙂b", 2).text.isWellFormed()).toBe(true);
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
