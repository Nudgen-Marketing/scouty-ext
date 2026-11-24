// Activity pages → blocks: visible text, the activity URN and its time when the block carries
// one, and a truncated flag. A field is null unless its selector matched; nothing is guessed.
//
// A block is one item of the activity list. Its text is, in this order: the header line that tells
// what the lead did ("… reposted this", "… likes this", "… commented on this"), the relative date
// label ("1w", "2mo", …), then every text box of the item in page order (on the comments page the
// post first and the lead's comment last, which the head-and-tail clamp keeps). An item without a
// text box is read as its visible text. Action controls and their labels are never read.
import { HARD_LIMITS } from "../config";
import type { Block } from "../protocol";
import { clampHeadTail } from "./clamp";
import type { Interactions } from "./interactions";
import { closestAny, queryAll, queryFirst, selectors } from "./selectors";
import { postUrnFromLinks, urnTime } from "./urn";
import { tidy, visibleText, type IsVisible } from "./visible-text";

export type ReadContext = { doc: Document; isVisible: IsVisible; interactions: Interactions; now: number };

export const textSkip = (): string[] => [...selectors.actionBar, ...selectors.actionControlSkip];

export const readText = (el: Element, ctx: ReadContext): string =>
  visibleText(el, { isVisible: ctx.isVisible, skip: textSkip(), duplicates: selectors.hiddenDuplicate });

const isNoise = (line: string): boolean => selectors.noiseLines.some((pattern) => pattern.test(line));
const withoutNoise = (text: string): string => text.split("\n").filter((line) => !isNoise(line)).join("\n");

/** Outermost items of the activity list, in document order. */
export function findBlocks(doc: Document): Element[] {
  const all = queryAll(doc, selectors.activity.block);
  return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
}

/** True while LinkedIn shows its loading indicator for more items. */
export function isLoading(doc: Document): boolean {
  return queryFirst(doc, selectors.activity.loader) !== null;
}

function expandControls(root: Element): Element[] {
  const found: Element[] = [];
  for (const selector of selectors.expandText) for (const el of Array.from(root.querySelectorAll(selector))) if (!found.includes(el)) found.push(el);
  return found;
}

/** Clicks the allowed "… more" controls inside the given containers. */
export function expandWithin(containers: readonly Element[], ctx: ReadContext): void {
  if (!ctx.interactions.clicksEnabled) return;
  for (const container of containers) {
    for (const control of expandControls(container)) {
      if (ctx.isVisible(control)) ctx.interactions.expandText(control);
    }
  }
}

/** An expand control that was never pressed means the text is still cut short. */
export function stillTruncated(container: Element, ctx: ReadContext): boolean {
  return expandControls(container).some((control) => ctx.isVisible(control) && !ctx.interactions.wasClicked(control));
}

/** Outermost text boxes inside a root, in document order. */
export function textContainersOf(root: Element): Element[] {
  const found: Element[] = [];
  for (const selector of selectors.textContainer) for (const el of Array.from(root.querySelectorAll(selector))) if (!found.includes(el)) found.push(el);
  return found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
}

/** The header line naming what the lead did, if the item has one. */
export function kindHint(lines: readonly string[]): string | null {
  return lines.find((line) => selectors.kindHint.some((pattern) => pattern.test(line))) ?? null;
}

/** The relative date label of the item ("1w", "2mo", "3d", "5h"), from a line such as "1w • Edited •". */
export function dateLabel(lines: readonly string[]): string | null {
  for (const line of lines) {
    const match = selectors.dateLabel.exec(line);
    if (match) return match[1]!.replace(/\s+/g, "");
  }
  return null;
}

function itemUrn(item: Element): { wire: string | null; key: string | null } {
  const hrefs = queryAll(item, selectors.activity.urnLink).map((a) => a.getAttribute("href"));
  const found = postUrnFromLinks(hrefs);
  // Protocol v1 carries activity URNs only; a share or ugcPost URN is kept for de-duplication.
  return { wire: found?.kind === "activity" ? found.urn : null, key: found?.urn ?? null };
}

/** The item's lines outside its text boxes: where the header line and the date are. */
function frameLines(item: Element, ctx: ReadContext): string[] {
  const skip = [...textSkip(), ...selectors.textContainer];
  return visibleText(item, { isVisible: ctx.isVisible, skip, duplicates: selectors.hiddenDuplicate }).split("\n").filter((line) => !isNoise(line));
}

function readBlock(item: Element, ctx: ReadContext): (Block & { key: string | null }) | null {
  const boxes = textContainersOf(item).map((box) => readText(box, ctx)).filter((t) => t !== "");
  const frame = frameLines(item, ctx);
  const hint = kindHint(frame);
  const date = dateLabel(frame);
  const body = boxes.length > 0 ? boxes.join("\n") : withoutNoise(readText(item, ctx));
  if (!body) return null;
  const raw = tidy([hint, date, body].filter((part): part is string => part !== null && part !== "").join("\n"));
  const { text, clamped } = clampHeadTail(raw, HARD_LIMITS.blockChars, HARD_LIMITS.blockHead);
  const urn = itemUrn(item);
  // The exact time comes only from an activity URN; the date label stays in the text.
  const time = urn.wire ? urnTime(urn.wire, ctx.now) : null;
  const truncated = clamped || stillTruncated(item, ctx) || /(…|\.\.\.)$/.test(body);
  return { text, urn: urn.wire, urnTime: time, truncated, key: urn.key };
}

/** All readable blocks on the page, without duplicates (same URN, or same text when there is none). */
export function readBlocks(ctx: ReadContext): Block[] {
  const seen = new Set<string>();
  const blocks: Block[] = [];
  for (const el of findBlocks(ctx.doc)) {
    const block = readBlock(el, ctx);
    if (!block) continue;
    const key = block.key ?? `t:${block.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    blocks.push({ text: block.text, urn: block.urn, urnTime: block.urnTime, truncated: block.truncated });
  }
  return blocks;
}

/** LinkedIn's own "nothing here": a legacy empty-state marker, or the activity list present with no item and nothing loading. */
export function hasEmptyState(doc: Document, alternatives: readonly string[]): boolean {
  const main = queryFirst(doc, selectors.mainColumn);
  if (!main) return false;
  return queryFirst(main, alternatives) !== null;
}

export function activityListEmpty(doc: Document): boolean {
  const list = queryFirst(doc, selectors.activity.list);
  return list !== null && findBlocks(doc).length === 0 && !isLoading(doc);
}

/** The text of the main column, for the degraded mode. */
export function mainText(ctx: ReadContext): string {
  const main = queryFirst(ctx.doc, selectors.mainColumn);
  if (!main) return "";
  return withoutNoise(readText(main, ctx));
}

/** Degraded mode: one block for the whole page, no permalink or time, treated as truncated. */
export function degradedBlock(ctx: ReadContext): Block | null {
  const raw = mainText(ctx);
  if (!raw) return null;
  return { text: clampHeadTail(raw, HARD_LIMITS.blockChars, HARD_LIMITS.blockHead).text, urn: null, urnTime: null, truncated: true };
}

export { closestAny };
