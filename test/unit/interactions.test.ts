import { describe, expect, it } from "vitest";
import { expandWithin, findBlocks, textContainersOf } from "../../src/reader/blocks";
import { createInteractions, mayClick } from "../../src/reader/interactions";
import { selectors } from "../../src/reader/selectors";
import { context, load } from "../helpers/fixture";

const everyCandidate = (doc: Document): Element[] =>
  Array.from(doc.querySelectorAll("button, a, [role='button']"));

describe("interactions", () => {
  it("clicks only the expand and load-more controls, never a trap", () => {
    const page = load("interaction-traps", "/in/synthetic-person-one/recent-activity/all/");
    const interactions = createInteractions(page.doc, { clicksEnabled: true, recordClicks: true });
    // Offer every control on the page to both interactions, as a hostile page would.
    for (const el of everyCandidate(page.doc)) interactions.expandText(el);
    for (let i = 0; i < 3; i += 1) interactions.loadMore();
    const clicked = page.clicks.map((el) => el.getAttribute("data-ok") ?? `TRAP:${el.getAttribute("data-trap") ?? el.outerHTML}`);
    expect(clicked).toEqual(["expand", "loadmore", "loadmore", "loadmore"]);
    expect(page.doc.querySelectorAll("[data-trap]").length).toBeGreaterThan(25);
  });

  it.each(["follow-in-text", "connect-in-text", "message-in-text", "like-in-text", "comment-in-text", "repost-in-text", "send-in-text", "contact-in-text"])(
    "refuses %s even though it has the expand class and sits in a text container", (trap) => {
      const page = load("interaction-traps");
      const el = page.doc.querySelector(`[data-trap="${trap}"]`)!;
      expect(el.matches(selectors.expandText.join(","))).toBe(true);
      expect(mayClick(el, "expandText")).toBe(false);
    });

  it.each(["toggle-foreign", "attr-foreign", "menuitem", "popup", "submit", "anchor", "button-in-anchor", "in-form", "in-menu", "in-dialog", "in-toolbar", "outside-text-container", "like-bar", "connect-bar", "contact-link"])(
    "refuses %s by structure alone (no word list needed)", (trap) => {
      const page = load("interaction-traps");
      const el = page.doc.querySelector(`[data-trap="${trap}"]`)!;
      expect(mayClick(el, "expandText")).toBe(false);
      expect(mayClick(el, "loadMore")).toBe(false);
    });

  it("refuses load-more controls inside a block or an action bar, or with an action word", () => {
    const page = load("interaction-traps");
    for (const trap of ["loadmore-in-bar", "loadmore-in-block", "loadmore-follow"]) {
      expect(mayClick(page.doc.querySelector(`[data-trap="${trap}"]`)!, "loadMore")).toBe(false);
    }
    expect(mayClick(page.doc.querySelector(`[data-ok="loadmore"]`)!, "loadMore")).toBe(true);
    // A load-more control that comes before the last block is not the end-of-list control.
    const early = page.doc.querySelector(`[data-ok="loadmore"]`)!;
    page.doc.querySelector(".scaffold-layout__main")!.prepend(early);
    const interactions = createInteractions(page.doc, { clicksEnabled: true, recordClicks: false });
    expect(interactions.loadMore()).toBe(false);
  });

  it("clicks an expand control at most once", () => {
    const page = load("interaction-traps");
    const interactions = createInteractions(page.doc, { clicksEnabled: true, recordClicks: true });
    const el = page.doc.querySelector(`[data-ok="expand"]`)!;
    el.removeAttribute("aria-expanded"); // stays in the page after the click
    expect(interactions.expandText(el)).toBe(true);
    expect(interactions.expandText(el)).toBe(false);
    expect(page.clicks).toHaveLength(1);
    expect(interactions.clickLog).toEqual([{ tag: "button", selector: "expandText: button.inline-show-more-text__button", name: "…see more", container: "div" }]);
  });

  it('with <html lang="de"> nothing at all is clicked', () => {
    const page = load("interaction-traps", "/in/synthetic-person-one/recent-activity/all/");
    page.doc.documentElement.setAttribute("lang", "de");
    const ctx = context(page.doc, { clicksEnabled: false });
    expandWithin(findBlocks(page.doc).flatMap((b) => textContainersOf(b)), ctx);
    for (const el of everyCandidate(page.doc)) ctx.interactions.expandText(el);
    expect(ctx.interactions.loadMore()).toBe(false);
    expect(page.clicks).toHaveLength(0);
  });

  it("scrolls the window only, by 0.8 of the viewport", () => {
    const page = load("activity-posts");
    const calls: unknown[][] = [];
    page.dom.window.scrollBy = ((...args: unknown[]) => { calls.push(args); }) as typeof page.dom.window.scrollBy;
    createInteractions(page.doc, { clicksEnabled: true, recordClicks: false }).scrollStep();
    expect(calls).toEqual([[0, Math.round(page.dom.window.innerHeight * 0.8)]]);
  });
});
