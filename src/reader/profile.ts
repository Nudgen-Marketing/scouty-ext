// The profile page and its two detail pages → labelled sections and the labels still cut short.
import { HARD_LIMITS } from "../config";
import type { ProfileContent, ReadMode, SectionName } from "../protocol";
import { expandWithin, hasEmptyState, mainText, stillTruncated, type ReadContext } from "./blocks";
import { clampHead, codePointLength } from "./clamp";
import { queryAll, queryFirst, selectors } from "./selectors";
import { visibleText } from "./visible-text";

const FALLBACK_LABEL: Record<string, string> = { profile: "Profile", experience: "Experience", skills: "Skills" };

const textSkip = (): string[] => [...selectors.actionBar, "button"];
const text = (el: Element, ctx: ReadContext): string => visibleText(el, { isVisible: ctx.isVisible, skip: textSkip(), duplicates: selectors.hiddenDuplicate });

function isContactLabel(label: string): boolean {
  return (selectors.contactSectionLabels as readonly string[]).includes(label.toLowerCase().trim());
}

type RawSection = { label: string; text: string; el: Element };

function mainPageSections(ctx: ReadContext): RawSection[] {
  const out: RawSection[] = [];
  for (const el of queryAll(ctx.doc, selectors.profile.section)) {
    const heading = queryFirst(el, selectors.profile.sectionHeading);
    const label = heading ? text(heading, ctx).replace(/\n+/g, " ").trim() : "";
    if (!label || isContactLabel(label)) continue;
    const lines = text(el, ctx).split("\n");
    if (lines[0] === label) lines.shift();
    out.push({ label, text: lines.join("\n").trim(), el });
  }
  return out;
}

function detailPageSections(ctx: ReadContext, section: SectionName): RawSection[] {
  const list = queryFirst(ctx.doc, selectors.profile.detailList);
  if (!list) return [];
  const body = text(list, ctx);
  if (!body) return [];
  const heading = queryFirst(ctx.doc, selectors.profile.detailHeading);
  const label = (heading ? text(heading, ctx).replace(/\n+/g, " ").trim() : "") || FALLBACK_LABEL[section]!;
  if (isContactLabel(label)) return [];
  return [{ label, text: body, el: list }];
}

function rawSections(ctx: ReadContext, section: SectionName): RawSection[] {
  return section === "profile" ? mainPageSections(ctx) : detailPageSections(ctx, section);
}

/** How much has been found so far; the scroll loop stops when this stops growing. */
export function profileProgress(ctx: ReadContext, section: SectionName): number {
  return rawSections(ctx, section).reduce((sum, s) => sum + 1 + s.text.length, 0);
}

export function expandProfile(ctx: ReadContext, section: SectionName): void {
  expandWithin(rawSections(ctx, section).map((s) => s.el), ctx);
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

  let name: string | null = null;
  let headline: string | null = null;
  if (section === "profile") {
    const nameEl = queryFirst(ctx.doc, selectors.profile.name);
    const headlineEl = queryFirst(ctx.doc, selectors.profile.headline);
    name = nameEl ? clampHead(text(nameEl, ctx).replace(/\n+/g, " "), HARD_LIMITS.nameChars).text || null : null;
    headline = headlineEl ? clampHead(text(headlineEl, ctx).replace(/\n+/g, " "), HARD_LIMITS.headlineChars).text || null : null;
  }

  if (sections.length > 0) return { content: { name, headline, sections, truncated }, read: "ok", cut };
  // A profile with a name and nothing else, or a detail page LinkedIn itself shows as empty.
  if (name !== null || hasEmptyState(ctx.doc, selectors.profile.emptyState)) {
    return { content: { name, headline, sections: [], truncated: [] }, read: "empty", cut: false };
  }
  // Degraded: no containers matched but the main column has text. One section for the whole page.
  const whole = mainText(ctx);
  if (!whole) return null;
  const label = FALLBACK_LABEL[section]!;
  const clamped = clampHead(whole, HARD_LIMITS.profileSectionChars);
  return { content: { name: null, headline: null, sections: [{ label, text: clamped.text }], truncated: [label] }, read: "degraded", cut: clamped.clamped };
}
