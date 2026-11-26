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
import { tidy, visibleText, type IsVisible, type Reach } from "./visible-text";

export type ReadContext = {
  doc: Document;
  isVisible: IsVisible;
  interactions: Interactions;
  now: number;
  /** Where a control is against the viewport; without it every control counts as near (tests without layout). */
  reach?: Reach;
};

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

/** One expand try: whether a control was pressed, and how many are still to press in reach or further down. */
export type ExpandStep = { clicked: boolean; pending: number };

/**
 * Presses at most ONE allowed "… more" control inside the given containers: the first one that is
 * visible and near the viewport. The scroll loop paces the presses (src/reader/pacing.ts); a control
 * further down is reached on a later scroll step. `pending` counts the allowed controls still to press
 * that are near or ahead (one scrolled far past is not come back to).
 */
export function expandWithin(containers: readonly Element[], ctx: ReadContext): ExpandStep {
  if (!ctx.interactions.clicksEnabled) return { clicked: false, pending: 0 };
  const where = ctx.reach ?? ((): "near" => "near");
  const open: { control: Element; at: "near" | "ahead" | "behind" }[] = [];
  for (const container of containers) {
    for (const control of expandControls(container)) {
      if (ctx.isVisible(control) && ctx.interactions.canExpand(control)) open.push({ control, at: where(control) });
    }
  }
  const next = open.find((entry) => entry.at === "near");
  const clicked = next ? ctx.interactions.expandText(next.control) : false;
  const pending = open.filter((entry) => entry !== next && entry.at !== "behind").length;
  return { clicked, pending };
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
  // Any post URN is sent (activity preferred when an item has several): many posts on activity pages
  // are named only by their share or ugcPost URN, and dropping those left them without a permalink or date.
  return { wire: found?.urn ?? null, key: found?.urn ?? null };
}

/** The item's lines outside its text boxes: where the header line and the date are. */
function frameLines(item: Element, ctx: ReadContext): string[] {
  const skip = [...textSkip(), ...selectors.textContainer];
  return visibleText(item, { isVisible: ctx.isVisible, skip, duplicates: selectors.hiddenDuplicate }).split("\n").filter((line) => !isNoise(line));
}

/** One line group of an item: its role (hint, date, the n-th text box, or the whole item) and whether that part is still cut. */
type Part = { role: string; text: string; cut: boolean };
/** `loose`: an unpressed "… more" outside every text box (the block is still cut, no part in particular). */
type ItemRead = { parts: Part[]; loose: boolean; urn: string | null; urnTime: string | null };

const ELLIPSIS = /(…|\.\.\.)$/;
const bare = (text: string): string => text.replace(ELLIPSIS, "").trim();

function readItem(item: Element, ctx: ReadContext): ItemRead | null {
  // Roles follow each box's place in the item before empty ones are left out: an empty post box never
  // shifts the lead's comment into the post's role.
  const boxes = textContainersOf(item).map((el, place) => ({ el, place, text: readText(el, ctx) })).filter((box) => box.text !== "");
  const frame = frameLines(item, ctx);
  const hint = kindHint(frame);
  const date = dateLabel(frame);
  // Each text box knows whether it is still cut (its own unpressed "… more", or its own ellipsis).
  const body: Part[] = boxes.length > 0
    ? boxes.map((box) => ({ role: `box${box.place}`, text: box.text, cut: stillTruncated(box.el, ctx) || ELLIPSIS.test(box.text) }))
    : [withoutNoise(readText(item, ctx))].filter((t) => t !== "").map((text) => ({ role: "body", text, cut: stillTruncated(item, ctx) || ELLIPSIS.test(text) }));
  if (body.length === 0) return null;
  const urn = itemUrn(item).wire;
  // The exact time comes only from an activity URN; the date label stays in the text.
  const time = urn ? urnTime(urn, ctx.now) : null;
  const frameParts: Part[] = [...(hint ? [{ role: "hint", text: hint, cut: false }] : []), ...(date ? [{ role: "date", text: date, cut: false }] : [])];
  const loose = expandControls(item).some((control) => ctx.isVisible(control) && !ctx.interactions.wasClicked(control) && !boxes.some((box) => box.el.contains(control)));
  return { parts: [...frameParts, ...body], loose, urn, urnTime: time };
}

/** The key an item is grouped (and counted against the cap) by: its post's URN, else its text. */
function itemKey(item: Element): string {
  return itemUrn(item).key ?? `t:${(item.textContent ?? "").replace(/\s+/g, " ").trim()}`;
}

/**
 * Adds a later item's parts to its post's (the first item's parts are kept as they are: an item's
 * own lines are never compared with each other, so a short comment or a date that also occurs in
 * the post stays). A part is compared only with kept parts of the same role (post box with post box,
 * comment with comment): equal text is kept once, in its uncut form; a cut part and its full read
 * (the full one starts with the cut one) keep the full one; anything else is appended.
 */
function mergeParts(into: Part[], parts: Part[]): void {
  const before = into.length;
  for (const part of parts) {
    const b = bare(part.text);
    let handled = false;
    for (let index = 0; index < before && !handled; index += 1) {
      const kept = into[index]!;
      if (kept.role !== part.role) continue;
      const a = bare(kept.text);
      if (a === b) { if (kept.cut && !part.cut) into[index] = part; handled = true; }
      // The full read of a cut part. (A different text that starts with exactly the visible words of
      // a cut one cannot be told apart from it on the page; the words read are kept either way.)
      else if (b.length > a.length && b.startsWith(a) && kept.cut) { into[index] = part; handled = true; }
      else if (a.length > b.length && a.startsWith(b) && part.cut) handled = true;
    }
    if (!handled) into.push(part);
  }
}

/**
 * All readable blocks on the page, one per post (same URN, or same text when there is none). On the
 * comments and reactions pages the URN is the post answered, so two different items on one post (two
 * comments, or a like of the post and of a comment on it) are kept together in that post's block,
 * merged part by part: the post once, then each item's own lines, so a long post never pushes a
 * comment of the lead into the cut middle. The same item read twice, or a cut and a full read of
 * it, keeps the fuller text.
 */
export function readBlocks(ctx: ReadContext): Block[] {
  const groups = new Map<string, ItemRead>();
  for (const el of findBlocks(ctx.doc)) {
    const item = readItem(el, ctx);
    if (!item) continue;
    const key = itemKey(el);
    const group = groups.get(key);
    if (!group) groups.set(key, { ...item, parts: [...item.parts] });
    else { mergeParts(group.parts, item.parts); group.loose ||= item.loose; }
  }
  return [...groups.values()].map((group) => {
    const { text, clamped } = clampHeadTail(tidy(group.parts.map((part) => part.text).join("\n")), HARD_LIMITS.blockChars, HARD_LIMITS.blockHead);
    return { text, urn: group.urn, urnTime: group.urnTime, truncated: clamped || group.loose || group.parts.some((part) => part.cut) };
  });
}

/** The page's items in order, each with the place of its post among the distinct ones (what the cap counts, as readBlocks groups). */
export function blockOrder(doc: Document): { el: Element; place: number }[] {
  const places = new Map<string, number>();
  return findBlocks(doc).map((el) => {
    const key = itemKey(el);
    if (!places.has(key)) places.set(key, places.size);
    return { el, place: places.get(key)! };
  });
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
