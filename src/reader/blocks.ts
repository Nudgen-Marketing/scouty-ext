// Activity pages → blocks: visible text, the activity URN and its time when the block carries
// one, and a truncated flag. A field is null unless its selector matched; nothing is guessed.
import { HARD_LIMITS } from "../config";
import type { Block } from "../protocol";
import { clampHeadTail } from "./clamp";
import type { Interactions } from "./interactions";
import { closestAny, queryAll, queryFirst, selectors } from "./selectors";
import { parseActivityUrn, plausibleIsoTime, urnTime } from "./urn";
import { visibleText, type IsVisible } from "./visible-text";

export type ReadContext = { doc: Document; isVisible: IsVisible; interactions: Interactions; now: number };

const textSkip = (): string[] => [...selectors.actionBar, "button"];

/** Outermost block containers, in document order. */
export function findBlocks(doc: Document): Element[] {
  const all = queryAll(doc, selectors.activity.block);
  return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
}

function expandControls(root: Element): Element[] {
  const found: Element[] = [];
  for (const selector of selectors.expandText) for (const el of Array.from(root.querySelectorAll(selector))) if (!found.includes(el)) found.push(el);
  return found;
}

/** Clicks the allowed "…see more" controls inside the given containers. */
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

function blockUrn(block: Element): string | null {
  const carriers: Element[] = [block];
  for (const attribute of selectors.activity.urnAttributes) {
    const up = block.closest(`[${attribute}]`);
    if (up && !carriers.includes(up)) carriers.push(up);
  }
  for (const attribute of selectors.activity.urnAttributes) {
    const down = block.querySelector(`[${attribute}]`);
    if (down && !carriers.includes(down)) carriers.push(down);
  }
  for (const el of carriers) {
    for (const attribute of selectors.activity.urnAttributes) {
      const urn = parseActivityUrn(el.getAttribute(attribute));
      if (urn) return urn;
    }
  }
  return null;
}

function readBlock(block: Element, ctx: ReadContext): Block | null {
  const raw = visibleText(block, { isVisible: ctx.isVisible, skip: textSkip(), duplicates: selectors.hiddenDuplicate });
  if (!raw) return null;
  const { text, clamped } = clampHeadTail(raw, HARD_LIMITS.blockChars, HARD_LIMITS.blockHead);
  const urn = blockUrn(block);
  const timeEl = queryFirst(block, selectors.activity.time);
  const time = (urn ? urnTime(urn, ctx.now) : null) ?? (urn ? plausibleIsoTime(timeEl?.getAttribute("datetime"), ctx.now) : null);
  const truncated = clamped || stillTruncated(block, ctx) || /(…|\.\.\.)$/.test(raw);
  return { text, urn, urnTime: time, truncated };
}

/** All readable blocks on the page, without duplicates (same URN, or same text when there is none). */
export function readBlocks(ctx: ReadContext): Block[] {
  const seen = new Set<string>();
  const blocks: Block[] = [];
  for (const el of findBlocks(ctx.doc)) {
    const block = readBlock(el, ctx);
    if (!block) continue;
    const key = block.urn ?? `t:${block.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    blocks.push(block);
  }
  return blocks;
}

export function hasEmptyState(doc: Document, alternatives: readonly string[]): boolean {
  const main = queryFirst(doc, selectors.mainColumn) ?? doc.body;
  return main !== null && queryFirst(main, alternatives) !== null;
}

/** The text of the main column, for the degraded mode. */
export function mainText(ctx: ReadContext): string {
  const main = queryFirst(ctx.doc, selectors.mainColumn);
  if (!main) return "";
  return visibleText(main, { isVisible: ctx.isVisible, skip: textSkip(), duplicates: selectors.hiddenDuplicate });
}

/** Degraded mode: one block for the whole page, no permalink or time, treated as truncated. */
export function degradedBlock(ctx: ReadContext): Block | null {
  const raw = mainText(ctx);
  if (!raw) return null;
  return { text: clampHeadTail(raw, HARD_LIMITS.blockChars, HARD_LIMITS.blockHead).text, urn: null, urnTime: null, truncated: true };
}

export function textContainersOf(root: Element): Element[] {
  const found: Element[] = [];
  for (const selector of selectors.textContainer) for (const el of Array.from(root.querySelectorAll(selector))) if (!found.includes(el)) found.push(el);
  return found;
}

export { closestAny };
