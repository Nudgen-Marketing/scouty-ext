// Opens the built gallery in Chromium and checks every state, in both themes, with real layout:
// axe (including colour contrast), a measured text contrast of WCAG AA, and the 360 × 560 limit.
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.join(import.meta.dirname, "..");
type Finding = { frame: string; text: string; ratio: number; needed: number };

async function open(page: Page): Promise<void> {
  await page.goto(pathToFileURL(path.join(root, "gallery", "index.html")).toString());
  await page.waitForSelector("body[data-ready='true']");
  await page.addScriptTag({ path: path.join(root, "node_modules", "axe-core", "axe.min.js") });
}

test("shows all 26 states in both themes, plus the overlay", async ({ page }) => {
  await open(page);
  await expect(page.locator("[data-frame='popup']")).toHaveCount(52);
  await expect(page.locator("[data-frame='popup'][data-theme='dark']")).toHaveCount(26);
  const kinds = await page.locator("[data-frame='popup'][data-theme='light']").evaluateAll((els) => els.map((el) => el.getAttribute("data-state")));
  expect(new Set(kinds).size).toBe(26);
  expect(await page.locator("[data-frame='overlay']").count()).toBeGreaterThanOrEqual(10);
  await expect(page.locator("[data-frame='popup'][data-state='ready'][data-theme='light'] h1")).toHaveText("Capture this profile");
  // The two themes really differ: the dark frame has a dark background.
  const backgrounds = await page.evaluate(() => ["light", "dark"].map((theme) => getComputedStyle(document.querySelector(`[data-frame='popup'][data-theme='${theme}']`)!).backgroundColor));
  expect(backgrounds[0]).not.toBe(backgrounds[1]);
});

test("axe reports no violation in any state, colour contrast included", async ({ page }) => {
  await open(page);
  const violations = await page.evaluate(async () => {
    const out: string[] = [];
    const frames = Array.from(document.querySelectorAll("[data-frame]"));
    for (const frame of frames) {
      const axe = (window as unknown as { axe: { run: (node: Element, options: unknown) => Promise<{ violations: { id: string; nodes: { html: string }[] }[] }> } }).axe;
      // Each frame is a fragment of a page: page-level rules (landmarks, one h1 per page) do not apply to it.
      const result = await axe.run(frame, { rules: { region: { enabled: false }, "page-has-heading-one": { enabled: false }, "landmark-one-main": { enabled: false }, "landmark-no-duplicate-main": { enabled: false }, "landmark-unique": { enabled: false }, "landmark-main-is-top-level": { enabled: false }, "landmark-banner-is-top-level": { enabled: false }, "landmark-no-duplicate-banner": { enabled: false } } });
      for (const v of result.violations) out.push(`${frame.getAttribute("data-state")} (${frame.getAttribute("data-theme") ?? frame.getAttribute("data-overlay-theme")}): ${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(" | ")}`);
    }
    return out;
  });
  expect(violations).toEqual([]);
});

test("every piece of text meets WCAG AA contrast in both themes", async ({ page }) => {
  await open(page);
  const findings = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const channels = (color: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      const a = d[3]! / 255;
      return a === 0 ? [0, 0, 0, 0] : [d[0]!, d[1]!, d[2]!, a];
    };
    const over = (top: [number, number, number, number], bottom: [number, number, number]): [number, number, number] =>
      [0, 1, 2].map((i) => top[i]! * top[3] + bottom[i]! * (1 - top[3])) as [number, number, number];
    const luminance = (c: [number, number, number]): number => {
      const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const parentOf = (node: Node): Element | null => node.parentElement ?? ((node.parentNode as ShadowRoot | null)?.host ?? null);
    const background = (el: Element): [number, number, number] => {
      const chain: Element[] = [];
      for (let at: Element | null = el; at; at = parentOf(at)) chain.unshift(at);
      let colour: [number, number, number] = [255, 255, 255];
      for (const item of chain) colour = over(channels(getComputedStyle(item).backgroundColor), colour);
      return colour;
    };
    const out: { frame: string; text: string; ratio: number; needed: number }[] = [];
    const visit = (root: Node, frame: string): void => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeType === 1) {
          const shadow = (node as Element).shadowRoot;
          if (shadow) visit(shadow, frame);
          continue;
        }
        const text = (node.nodeValue ?? "").trim();
        const el = node.parentElement;
        if (!text || !el || el.closest("[aria-hidden='true'], style, script")) continue;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const bg = background(el);
        const fg = over(channels(style.color), bg);
        const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
        const ratio = (hi + 0.05) / (lo + 0.05);
        const size = parseFloat(style.fontSize);
        const bold = Number(style.fontWeight) >= 700;
        const needed = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
        if (ratio < needed) out.push({ frame, text: text.slice(0, 40), ratio: Math.round(ratio * 100) / 100, needed });
      }
    };
    for (const frame of Array.from(document.querySelectorAll("[data-frame]"))) {
      visit(frame, `${frame.getAttribute("data-state")} (${frame.getAttribute("data-theme") ?? frame.getAttribute("data-overlay-theme")})`);
    }
    return out;
  }) as Finding[];
  expect(findings).toEqual([]);
});

test("no state is larger than the 360 × 560 popup, and no overlay is wider than 320", async ({ page }) => {
  await open(page);
  const sizes = await page.locator("[data-frame='popup']").evaluateAll((frames) => frames.map((frame) => {
    const view = frame.querySelector("[data-view]") as HTMLElement;
    return { state: `${frame.getAttribute("data-state")} (${frame.getAttribute("data-theme")})`, width: view.getBoundingClientRect().width, content: view.scrollHeight, scrollWidth: view.scrollWidth };
  }));
  expect(sizes).toHaveLength(52);
  for (const size of sizes) {
    expect(size.width, size.state).toBe(360);
    expect(size.scrollWidth, size.state).toBeLessThanOrEqual(360);
    expect(size.content, size.state).toBeLessThanOrEqual(560);
  }
  const cards = await page.locator("[data-frame='overlay']").evaluateAll((frames) => frames.map((frame) => {
    const card = frame.querySelector("scouty-capture-overlay")!.shadowRoot!.querySelector(".card")!.getBoundingClientRect();
    const box = frame.getBoundingClientRect();
    return { width: card.width, left: card.left - box.left, bottom: box.bottom - card.bottom, height: card.height };
  }));
  for (const card of cards) {
    expect(card.width).toBe(320);
    expect(Math.round(card.left)).toBe(17); // 16 px margin inside the 1 px frame border
    expect(Math.round(card.bottom)).toBe(17);
    expect(card.height).toBeLessThanOrEqual(400);
  }
});
