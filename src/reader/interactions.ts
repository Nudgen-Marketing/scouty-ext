// THE ONLY FILE THAT MAY CLICK OR SCROLL.
//
// The reader touches a LinkedIn page in exactly three ways: scrollStep(), expandText(el) and
// loadMore(). Whether an element may be clicked is decided by structure, not by the page language
// (plan 6.4). The word list is a second line only.

import type { ClickLogEntry } from "../messages";
import { closestAny, isActionControl, isProfileSectionLabel, matchesAny, queryAll, queryFirst, selectors } from "./selectors";
import type { Reach } from "./visible-text";

export type ClickKind = "expandText" | "loadMore";

const FORBIDDEN_ROLES = new Set(["menuitem", "menuitemcheckbox", "menuitemradio", "switch", "tab", "option", "link"]);
const FORBIDDEN_CONTAINERS =
  "[role='toolbar'],[role='menu'],[role='menubar'],[role='dialog'],[role='alertdialog'],[role='tablist'],dialog,menu,header,[role='banner'],nav,form,a,[href]";

// Second line of defence: action words in English and Vietnamese, matched against the accessible
// name and the text of the element.
const DENY_WORDS = [
  "follow", "connect", "message", "like", "react", "comment", "repost", "share", "send", "subscribe", "save",
  "report", "block", "contact info", "invite", "endorse", "menu", "page", "navigate", "add a ", "ad options",
  "theo dõi", "kết nối", "nhắn tin", "tin nhắn", "thích", "bày tỏ", "bình luận", "đăng lại", "chia sẻ", "gửi",
  "đăng ký", "lưu", "báo cáo", "chặn", "thông tin liên hệ",
];

function accessibleName(el: Element): string {
  return `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${el.textContent ?? ""}`.toLowerCase();
}

/**
 * aria-hidden: nothing hidden from assistive technology is clicked, with ONE exception. LinkedIn
 * marks its expand control (button[data-testid=expandable-text-button]) aria-hidden="true"; that
 * control is allowed when it is itself the only aria-hidden element on its path (no hidden ancestor).
 */
function hiddenAllowed(el: Element, kind: ClickKind): boolean {
  if (el.parentElement?.closest("[aria-hidden='true']")) return false;
  if (el.getAttribute("aria-hidden") === "true") return kind === "expandText" && matchesAny(el, selectors.expandText);
  return true;
}

/** Inside a profile section whose heading is one of the profile's own sections (never an ad or owner-only section). */
function inProfileSection(box: Element): boolean {
  const section = box.closest(selectors.expandSection);
  const heading = section ? queryFirst(section, selectors.profile.sectionHeading) : null;
  return heading !== null && isProfileSectionLabel(heading.textContent ?? "");
}

/** The text box an expand control belongs to, if it may be expanded at all. */
function expandableBox(el: Element): Element | null {
  const box = closestAny(el, selectors.textContainer);
  if (!box) return null;
  // Inside an activity item, a profile section or a detail page, within the main column.
  if (!closestAny(box, selectors.mainColumn)) return null;
  if (!closestAny(box, selectors.expandScope) && !inProfileSection(box)) return null;
  // Never in or next to an action control: the box holds no control but expand controls.
  for (const other of Array.from(box.querySelectorAll("button, [role='button'], [role='menuitem'], [role='tab'], input, select, textarea"))) {
    if (!matchesAny(other, selectors.expandText) || isActionControl(other)) return null;
  }
  return box;
}

/** The structural allow-list. Every condition must hold. */
export function mayClick(el: Element, kind: ClickKind): boolean {
  // 1. A plain button: never a link, never a submit control, never inside a form.
  if (el.tagName.toUpperCase() !== "BUTTON") return false;
  if (el.hasAttribute("href") || el.getAttribute("type") === "submit" || el.hasAttribute("disabled")) return false;
  // 3. Not inside an action bar, toolbar, menu, tab list, dialog, header, navigation, form or link.
  if (closestAny(el, selectors.actionBar) || el.closest(FORBIDDEN_CONTAINERS)) return false;
  // 4. Not a toggle, not a menu or tab item, no popup, no action-style attribute or name, not hidden
  //    (but for the one expand control LinkedIn hides from assistive technology).
  if (el.hasAttribute("aria-pressed") || el.hasAttribute("aria-haspopup") || el.hasAttribute("aria-checked")) return false;
  const role = (el.getAttribute("role") ?? "").toLowerCase();
  if (FORBIDDEN_ROLES.has(role)) return false;
  for (const attribute of selectors.actionControlAttributes) if (el.hasAttribute(attribute)) return false;
  if (isActionControl(el)) return false;
  if (el.closest("[inert]") || !hiddenAllowed(el, kind)) return false;
  // 5. It is one of the two known controls …
  // 2. … in the only place that control may be.
  if (kind === "expandText") {
    if (!matchesAny(el, selectors.expandText)) return false;
    if (!expandableBox(el)) return false;
  } else {
    if (!matchesAny(el, selectors.loadMore)) return false;
    if (closestAny(el, selectors.activity.block) || closestAny(el, selectors.textContainer)) return false;
  }
  // Second line: an action word anywhere in its name or text.
  const name = accessibleName(el);
  for (const word of DENY_WORDS) if (name.includes(word)) return false;
  return true;
}

export type Interactions = {
  readonly clicksEnabled: boolean;
  /** Scrolls the window by 0.8 of the viewport. */
  scrollStep(): void;
  /** Clicks an inline "… more" control if the allow-list permits. Each control is clicked at most once. */
  expandText(el: Element): boolean;
  /** True when expandText(el) would press it now: clicks on, not pressed before, and allowed. */
  canExpand(el: Element): boolean;
  /**
   * Clicks the "Show more results" control after the last block, if there is one, it is allowed and it
   * is near the viewport (the same `reach` rule as the "… more" presses, deviation 28).
   */
  loadMore(): boolean;
  wasClicked(el: Element): boolean;
  readonly clickLog: ClickLogEntry[];
};

/**
 * `reach` says where a control is against the viewport (domReach in the browser); without it every
 * control is near (tests without layout).
 */
export function createInteractions(doc: Document, options: { clicksEnabled: boolean; recordClicks: boolean; reach?: Reach }): Interactions {
  const reach: Reach = options.reach ?? ((): "near" => "near");
  const clicked = new WeakSet<Element>();
  const clickLog: ClickLogEntry[] = [];

  const press = (el: Element, kind: ClickKind): void => {
    if (options.recordClicks) {
      const matched = [...selectors.expandText, ...selectors.loadMore].find((s) => el.matches(s)) ?? "";
      const container = el.closest("[role]")?.getAttribute("role") ?? el.parentElement?.tagName.toLowerCase() ?? "";
      clickLog.push({ tag: el.tagName.toLowerCase(), selector: `${kind}: ${matched}`, name: accessibleName(el).trim().slice(0, 80), container });
    }
    clicked.add(el);
    (el as HTMLElement).click();
  };

  return {
    clicksEnabled: options.clicksEnabled,
    clickLog,
    scrollStep() {
      const view = doc.defaultView;
      if (view) view.scrollBy(0, Math.round(view.innerHeight * 0.8));
    },
    expandText(el) {
      if (!options.clicksEnabled || clicked.has(el) || !mayClick(el, "expandText")) return false;
      press(el, "expandText");
      return true;
    },
    canExpand: (el) => options.clicksEnabled && !clicked.has(el) && mayClick(el, "expandText"),
    loadMore() {
      if (!options.clicksEnabled) return false;
      const main = queryFirst(doc, selectors.mainColumn) ?? doc.body;
      if (!main) return false;
      const candidates = queryAll(main, selectors.loadMore).filter((el) => mayClick(el, "loadMore"));
      const control = candidates[candidates.length - 1];
      if (!control) return false;
      const blocks = queryAll(main, selectors.activity.block);
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock && !(lastBlock.compareDocumentPosition(control) & 4)) return false; // 4 = FOLLOWING
      // Only near the viewport, like the "… more" presses: never one far below or scrolled past.
      if (reach(control) !== "near") return false;
      press(control, "loadMore");
      return true;
    },
    wasClicked: (el) => clicked.has(el),
  };
}
