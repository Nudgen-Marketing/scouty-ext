// THE ONLY FILE THAT MAY CLICK OR SCROLL.
//
// The reader touches a LinkedIn page in exactly three ways: scrollStep(), expandText(el) and
// loadMore(). Whether an element may be clicked is decided by structure, not by the page language
// (plan 6.4). The word list is a second line only.

import type { ClickLogEntry } from "../messages";
import { closestAny, matchesAny, queryAll, queryFirst, selectors } from "./selectors";

export type ClickKind = "expandText" | "loadMore";

const FORBIDDEN_ROLES = new Set(["menuitem", "menuitemcheckbox", "menuitemradio", "switch", "tab", "option", "link"]);
const FORBIDDEN_CONTAINERS =
  "[role='toolbar'],[role='menu'],[role='menubar'],[role='dialog'],[role='alertdialog'],dialog,menu,header,[role='banner'],nav,form,a,[href]";

// Second line of defence: action words in English and Vietnamese, matched against the accessible
// name and the text of the element.
const DENY_WORDS = [
  "follow", "connect", "message", "like", "react", "comment", "repost", "share", "send", "subscribe", "save",
  "report", "block", "contact info", "invite", "endorse",
  "theo dõi", "kết nối", "nhắn tin", "tin nhắn", "thích", "bày tỏ", "bình luận", "đăng lại", "chia sẻ", "gửi",
  "đăng ký", "lưu", "báo cáo", "chặn", "thông tin liên hệ",
];

function accessibleName(el: Element): string {
  return `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${el.textContent ?? ""}`.toLowerCase();
}

/** The structural allow-list. Every condition must hold. */
export function mayClick(el: Element, kind: ClickKind): boolean {
  // 1. A plain button: never a link, never a submit control, never inside a form.
  if (el.tagName.toUpperCase() !== "BUTTON") return false;
  if (el.hasAttribute("href") || el.getAttribute("type") === "submit" || el.hasAttribute("disabled")) return false;
  // 3. Not inside an action bar, toolbar, menu, dialog, header, navigation, form or link.
  if (closestAny(el, selectors.actionBar) || el.closest(FORBIDDEN_CONTAINERS)) return false;
  // 4. Not a toggle, not a menu or tab item, no popup, no action-style attribute.
  if (el.hasAttribute("aria-pressed") || el.hasAttribute("aria-haspopup") || el.hasAttribute("aria-checked")) return false;
  const role = (el.getAttribute("role") ?? "").toLowerCase();
  if (FORBIDDEN_ROLES.has(role)) return false;
  for (const attribute of selectors.actionControlAttributes) if (el.hasAttribute(attribute)) return false;
  // 5. It is one of the two known controls …
  // 2. … in the only place that control may be.
  if (kind === "expandText") {
    if (!matchesAny(el, selectors.expandText)) return false;
    if (!closestAny(el, selectors.textContainer)) return false;
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
  /** Clicks an inline "…see more" control if the allow-list permits. Each control is clicked at most once. */
  expandText(el: Element): boolean;
  /** Clicks the "Show more results" control after the last block, if there is one and it is allowed. */
  loadMore(): boolean;
  wasClicked(el: Element): boolean;
  readonly clickLog: ClickLogEntry[];
};

export function createInteractions(doc: Document, options: { clicksEnabled: boolean; recordClicks: boolean }): Interactions {
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
      press(control, "loadMore");
      return true;
    },
    wasClicked: (el) => clicked.has(el),
  };
}
