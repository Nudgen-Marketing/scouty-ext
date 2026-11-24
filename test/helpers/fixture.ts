import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { vi } from "vitest";
import { createInteractions, type Interactions } from "../../src/reader/interactions";
import type { ReadContext } from "../../src/reader/blocks";
import type { IsVisible } from "../../src/reader/visible-text";

export const SLUG = "synthetic-person-one";
export const FIXED_NOW = Date.UTC(2023, 10, 30, 12, 0, 0);

export function fixtureHtml(name: string): string {
  return readFileSync(path.join(process.cwd(), "fixtures/synthetic", `${name}.html`), "utf8");
}

export type Loaded = { dom: JSDOM; doc: Document; clicks: Element[]; scrolls: () => number };

/** Section paths below /in/<slug>/. */
export const PATHS = {
  profile: `/in/${SLUG}/`, experience: `/in/${SLUG}/details/experience/`, skills: `/in/${SLUG}/details/skills/`,
  posts: `/in/${SLUG}/recent-activity/all/`, comments: `/in/${SLUG}/recent-activity/comments/`, reactions: `/in/${SLUG}/recent-activity/reactions/`,
} as const;

/** Loads a synthetic fixture at a LinkedIn-shaped address and wires the page's own behaviour. */
export function load(name: string, pathname = `/in/${SLUG}/`, html?: string): Loaded {
  const dom = new JSDOM(html ?? fixtureHtml(name), { url: `https://www.linkedin.com${pathname}` });
  const doc = dom.window.document;
  const clicks: Element[] = [];
  const scrollBy = vi.fn();
  dom.window.scrollBy = scrollBy as unknown as typeof dom.window.scrollBy;
  // What the page itself does when "… more" is pressed: show the rest and drop the control.
  doc.addEventListener("click", (event) => {
    const target = event.target as Element;
    clicks.push(target);
    if (target.matches("button[data-testid='expandable-text-button']")) {
      target.closest("[data-testid='expandable-text-box']")?.querySelector("[data-rest]")?.removeAttribute("hidden");
      if (!target.hasAttribute("data-stays")) target.remove();
    }
  }, true);
  return { dom, doc, clicks, scrolls: () => scrollBy.mock.calls.length };
}

/** Visibility driven by fixture attributes: jsdom has no layout. */
export const testIsVisible: IsVisible = (el) => !el.hasAttribute("data-test-invisible");

export function context(doc: Document, options: { clicksEnabled?: boolean } = {}): ReadContext & { interactions: Interactions } {
  const interactions = createInteractions(doc, { clicksEnabled: options.clicksEnabled ?? true, recordClicks: true });
  return { doc, isVisible: testIsVisible, interactions, now: FIXED_NOW };
}
