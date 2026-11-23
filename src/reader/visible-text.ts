// A layout-free visible-text walker. It does not use innerText (jsdom has no layout): it walks
// text nodes, breaks lines at block-level elements and skips what a person cannot see.

export type IsVisible = (el: Element) => boolean;

export type VisibleTextOptions = {
  isVisible: IsVisible;
  /** Selectors whose subtrees are skipped (action rows, controls, …). */
  skip: readonly string[];
  /**
   * Selectors of text repeated for screen readers. Always skipped. An `aria-hidden="true"` element
   * with such a sibling is the visible twin of that text and is read; any other
   * `aria-hidden="true"` element is skipped.
   */
  duplicates?: readonly string[];
};

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CODE", "IFRAME", "OBJECT", "HEAD"]);
const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DETAILS", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE",
  "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION",
  "TABLE", "TR", "UL",
]);

/** Computed style and client rects. Used in the browser; tests inject a stub instead. */
export const domIsVisible: IsVisible = (el) => {
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  if (style.display === "contents") return true;
  return el.getClientRects().length > 0;
};

function skipped(el: Element, options: VisibleTextOptions): boolean {
  if (SKIP_TAGS.has(el.tagName.toUpperCase())) return true;
  if (el.hasAttribute("hidden")) return true;
  const duplicates = options.duplicates ?? [];
  for (const selector of duplicates) if (el.matches(selector)) return true;
  for (const selector of options.skip) if (el.matches(selector)) return true;
  if (el.getAttribute("aria-hidden") === "true") {
    const siblings = el.parentElement ? Array.from(el.parentElement.children) : [];
    const twin = siblings.some((other) => other !== el && duplicates.some((selector) => other.matches(selector)));
    if (!twin) return true;
  }
  return !options.isVisible(el);
}

export function visibleText(root: Element, options: VisibleTextOptions): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      parts.push((node.nodeValue ?? "").replace(/\s+/g, " "));
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (skipped(el, options)) return;
    const tag = el.tagName.toUpperCase();
    if (tag === "BR") {
      parts.push("\n");
      return;
    }
    const block = BLOCK_TAGS.has(tag);
    if (block) parts.push("\n");
    for (const child of Array.from(el.childNodes)) walk(child);
    if (block) parts.push("\n");
  };
  if (!skipped(root, options)) for (const child of Array.from(root.childNodes)) walk(child);
  return tidy(parts.join(""));
}

/** Collapses spaces, trims every line and drops empty lines. */
export function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}
