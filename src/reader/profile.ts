// The profile page and its two detail pages → labelled sections and the labels still cut short.
//
// Main page: the top card gives the name (its heading) and the headline (the first line after the
// name); then only the profile's own sections are read, chosen by their h2 label from an allow-list
// (selectors.profileSectionLabels). Owner-only, recommendation and ad sections, a section without
// an h2, and the contact section are never read. Detail pages: the entries under the page's root,
// each entry's lines (its paragraphs and text boxes) in page order, as one labelled section.
import { HARD_LIMITS } from "../config";
import type { ProfileContent, ReadMode, SectionName } from "../protocol";
import { expandWithin, hasEmptyState, mainText, readText, stillTruncated, textSkip, type ExpandStep, type ReadContext } from "./blocks";
import { clampHead, codePointLength } from "./clamp";
import { isProfileSectionLabel, queryAll, queryFirst, selectors } from "./selectors";
import { visibleText } from "./visible-text";

const FALLBACK_LABEL: Record<string, string> = { profile: "Profile", experience: "Experience", skills: "Skills" };

const oneLine = (el: Element, ctx: ReadContext): string => readText(el, ctx).replace(/\n+/g, " ").trim();

type RawSection = { label: string; text: string; el: Element };

/**
 * The top card: the element whose id is "com.linkedin.sdui.profile.card.…Topcard" when it holds the
 * name heading (live LinkedIn: the card wraps its own section, and one outer section wraps every
 * card, so that outer section is never the top card); else the section around it, unless that
 * section also holds other profile cards; else the section inside it.
 */
export function topCard(doc: Document): Element | null {
  const { topCardIdPrefix, topCardIdSuffix } = selectors.profile;
  const main = queryFirst(doc, selectors.mainColumn);
  const cards = main ? Array.from(main.querySelectorAll(`[id^='${topCardIdPrefix}']`)) : [];
  const marker = cards.find((el) => el.id.endsWith(topCardIdSuffix));
  if (!marker) return null;
  if (queryFirst(marker, selectors.profile.nameHeading)) return marker;
  const around = marker.closest("section");
  if (around && !cards.some((card) => card !== marker && around.contains(card))) return around;
  return marker.querySelector("section") ?? marker;
}

function sectionLabel(el: Element, ctx: ReadContext): string {
  const heading = queryFirst(el, selectors.profile.sectionHeading);
  return heading ? oneLine(heading, ctx) : "";
}

function mainPageSections(ctx: ReadContext): RawSection[] {
  const card = topCard(ctx.doc);
  const picked: { el: Element; label: string }[] = [];
  for (const el of queryAll(ctx.doc, selectors.profile.section)) {
    if (card && (el === card || card.contains(el) || el.contains(card))) continue;
    const label = sectionLabel(el, ctx);
    if (!label || !isProfileSectionLabel(label)) continue;
    picked.push({ el, label });
  }
  // Innermost: on live LinkedIn one outer section wraps every card, and its first h2 is a card's label.
  const innermost = picked.filter((p) => !picked.some((other) => other !== p && p.el.contains(other.el)));
  return innermost.map(({ el, label }) => {
    const lines = readText(el, ctx).split("\n");
    if (lines[0] === label) lines.shift();
    return { label, text: lines.join("\n").trim(), el };
  });
}

function detailItems(root: Element): Element[] {
  const text = selectors.profile.detailText.join(",");
  const skip = textSkip().join(",");
  const found = queryAll(root, selectors.profile.detailItem).filter((el) => el.querySelector(text) && !el.closest(skip));
  return found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
}

function itemText(item: Element, ctx: ReadContext): string {
  const parts = Array.from(item.querySelectorAll(selectors.profile.detailText.join(",")));
  const outer = parts.filter((el) => !parts.some((other) => other !== el && other.contains(el)));
  const skip = textSkip();
  const lines: string[] = [];
  for (const part of outer) {
    if (skip.some((s) => part.closest(s) && item.contains(part.closest(s)))) continue;
    const t = readText(part, ctx);
    if (t && lines[lines.length - 1] !== t) lines.push(t);
  }
  return lines.join("\n");
}

function detailRoot(ctx: ReadContext, section: SectionName): Element | null {
  const roots = selectors.profile.detailRoot[section];
  return roots ? queryFirst(ctx.doc, roots) : null;
}

/** A detail page whose root is there and shows nothing at all: LinkedIn's own empty page. */
function detailRootEmpty(ctx: ReadContext, section: SectionName): boolean {
  const root = section === "profile" ? null : detailRoot(ctx, section);
  return root !== null && readText(root, ctx) === "";
}

function detailPageSections(ctx: ReadContext, section: SectionName): RawSection[] {
  const root = detailRoot(ctx, section);
  if (!root) return [];
  const entries = detailItems(root).map((item) => itemText(item, ctx)).filter((t) => t !== "");
  if (entries.length === 0) return [];
  const label = FALLBACK_LABEL[section]!;
  return [{ label, text: entries.join("\n\n"), el: root }];
}

function rawSections(ctx: ReadContext, section: SectionName): RawSection[] {
  return section === "profile" ? mainPageSections(ctx) : detailPageSections(ctx, section);
}

/** The containers whose "… more" may be expanded: the sections that are read, and nothing else. */
function expandable(ctx: ReadContext, section: SectionName): Element[] {
  return rawSections(ctx, section).map((s) => s.el);
}

/** How much has been found so far; the scroll loop stops when this stops growing. */
export function profileProgress(ctx: ReadContext, section: SectionName): number {
  return rawSections(ctx, section).reduce((sum, s) => sum + 1 + s.text.length, 0);
}

/** Presses at most one allowed expand control of the section (paced by the scroll loop). */
export function expandProfile(ctx: ReadContext, section: SectionName): ExpandStep {
  return expandWithin(expandable(ctx, section), ctx);
}

/** Name and headline from the top card. Links (such as the contact one) and controls are never read. */
function nameAndHeadline(ctx: ReadContext): { name: string | null; headline: string | null } {
  const card = topCard(ctx.doc);
  if (!card) return { name: null, headline: null };
  const heading = queryFirst(card, selectors.profile.nameHeading);
  const name = heading ? oneLine(heading, ctx) : "";
  const lines = visibleText(card, { isVisible: ctx.isVisible, skip: [...textSkip(), "a"], duplicates: selectors.hiddenDuplicate }).split("\n");
  // Links are not read, and on live LinkedIn the name heading sits inside the profile link: then the
  // headline is looked for from the first line (the degree line "· 3rd" is passed over below).
  const at = name ? lines.indexOf(name) : -1;
  const start = at >= 0 ? at + 1 : name ? 0 : -1;
  const headline = start >= 0 ? (lines.slice(start).find((line) => line !== name && !/^\(?[\p{L}]+\/[\p{L}]+\)?$/u.test(line) && !/^[·•]/.test(line)) ?? "") : "";
  return {
    name: name ? clampHead(name, HARD_LIMITS.nameChars).text || null : null,
    headline: headline ? clampHead(headline, HARD_LIMITS.headlineChars).text || null : null,
  };
}

export type ProfileRead = { content: ProfileContent; read: ReadMode; cut: boolean } | null;

export function readProfile(ctx: ReadContext, section: SectionName): ProfileRead {
  const raw = rawSections(ctx, section);
  const sections: { label: string; text: string }[] = [];
  const truncated: string[] = [];
  const mark = (label: string): void => {
    if (!truncated.includes(label) && truncated.length < HARD_LIMITS.profileSections) truncated.push(label);
  };
  let total = 0;
  let cut = false;
  for (const item of raw) {
    const label = clampHead(item.label, HARD_LIMITS.labelChars).text;
    const room = HARD_LIMITS.profileChars - total;
    if (sections.length >= HARD_LIMITS.profileSections || room <= 0) {
      cut = true;
      mark(label);
      continue;
    }
    const clamped = clampHead(item.text, Math.min(HARD_LIMITS.profileSectionChars, room));
    if (clamped.clamped) cut = true;
    if (clamped.clamped || stillTruncated(item.el, ctx)) mark(label);
    total += codePointLength(clamped.text);
    sections.push({ label, text: clamped.text });
  }

  const { name, headline } = section === "profile" ? nameAndHeadline(ctx) : { name: null, headline: null };

  if (sections.length > 0) return { content: { name, headline, sections, truncated }, read: "ok", cut };
  // A profile with a name and nothing else, or a detail page LinkedIn itself shows as empty.
  if (name !== null || hasEmptyState(ctx.doc, selectors.profile.emptyState) || detailRootEmpty(ctx, section)) {
    return { content: { name, headline, sections: [], truncated: [] }, read: "empty", cut: false };
  }
  // Degraded: no containers matched but the main column has text. One section for the whole page.
  const whole = mainText(ctx);
  if (!whole) return null;
  const label = FALLBACK_LABEL[section]!;
  const clamped = clampHead(whole, HARD_LIMITS.profileSectionChars);
  return { content: { name: null, headline: null, sections: [{ label, text: clamped.text }], truncated: [label] }, read: "degraded", cut: clamped.clamped };
}
