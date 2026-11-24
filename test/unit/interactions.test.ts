import { describe, expect, it } from "vitest";
import { expandWithin, findBlocks, textContainersOf } from "../../src/reader/blocks";
import { createInteractions, mayClick } from "../../src/reader/interactions";
import { expandProfile } from "../../src/reader/profile";
import { selectors } from "../../src/reader/selectors";
import { context, load, PATHS } from "../helpers/fixture";

const everyCandidate = (doc: Document): Element[] =>
  Array.from(doc.querySelectorAll("button, a, [role='button']"));
const EXPAND = selectors.expandText.join(",");

describe("interactions: the allow-list", () => {
  it("clicks only the expand and load-more controls, never a trap", () => {
    const page = load("sdui-interaction-traps", PATHS.posts);
    const interactions = createInteractions(page.doc, { clicksEnabled: true, recordClicks: true });
    // Offer every control on the page to both interactions, as a hostile page would.
    for (const el of everyCandidate(page.doc)) interactions.expandText(el);
    for (let i = 0; i < 3; i += 1) interactions.loadMore();
    const clicked = page.clicks.map((el) => el.getAttribute("data-ok") ?? `TRAP:${el.getAttribute("data-trap") ?? el.outerHTML}`);
    expect(clicked).toEqual(["expand", "loadmore", "loadmore", "loadmore"]);
    expect(page.doc.querySelectorAll("[data-trap]").length).toBeGreaterThan(35);
  });

  it("the one allowed control: an aria-hidden expandable-text-button inside an expandable-text-box inside an activity item", () => {
    const page = load("sdui-interaction-traps", PATHS.posts);
    const ok = page.doc.querySelector(`[data-ok="expand"]`)!;
    expect(ok.getAttribute("aria-hidden")).toBe("true");
    expect(mayClick(ok, "expandText")).toBe(true);
    // It is never a load-more control.
    expect(mayClick(ok, "loadMore")).toBe(false);
  });

  it.each(["reactions-menu", "reaction-state", "comment", "repost", "send", "control-menu", "follow", "next-page", "previous-page", "page-of", "contact"])(
    "refuses the %s action control even with the expand control's data-testid, aria-hidden and a text box around it", (trap) => {
      const page = load("sdui-interaction-traps");
      const el = page.doc.querySelector(`[data-trap="${trap}"]`)!;
      expect(el.matches(EXPAND)).toBe(true);
      expect(el.closest("[data-testid='expandable-text-box']")).not.toBeNull();
      expect(mayClick(el, "expandText")).toBe(false);
      expect(mayClick(el, "loadMore")).toBe(false);
    });

  it.each([
    "toggle-foreign", "attr-foreign", "menuitem", "popup", "submit", "anchor", "button-in-anchor", "in-form", "in-menu", "in-dialog",
    "in-toolbar", "in-nav", "hidden-ancestor", "next-to-action", "action-in-box", "hidden-other-button", "outside-text-box",
    "owner-only-section", "section-without-heading", "outside-item", "outside-main",
  ])("refuses %s by structure alone (no word list needed)", (trap) => {
    const page = load("sdui-interaction-traps");
    const el = page.doc.querySelector(`[data-trap="${trap}"]`)!;
    expect(mayClick(el, "expandText")).toBe(false);
    expect(mayClick(el, "loadMore")).toBe(false);
  });

  it("the action controls of every item on the real-shaped pages are never clickable", () => {
    for (const [name, path] of [["sdui-activity-posts", PATHS.posts], ["sdui-activity-comments", PATHS.comments], ["sdui-activity-reactions", PATHS.reactions], ["sdui-profile", PATHS.profile], ["sdui-details-experience", PATHS.experience], ["sdui-details-skills", PATHS.skills]] as const) {
      const page = load(name, path);
      const clickable = everyCandidate(page.doc).filter((el) => mayClick(el, "expandText") || mayClick(el, "loadMore"));
      for (const el of clickable) expect(el.matches(EXPAND), `${name}: ${el.outerHTML}`).toBe(true);
    }
  });

  it("aria-hidden is allowed for the expand control only, never for anything else", () => {
    const page = load("sdui-interaction-traps", PATHS.posts);
    const ok = page.doc.querySelector(`[data-ok="expand"]`)!;
    // The same control without its data-testid is just an aria-hidden button: refused.
    ok.removeAttribute("data-testid");
    expect(mayClick(ok, "expandText")).toBe(false);
    // A hidden load-more control is refused.
    const more = page.doc.querySelector(`[data-ok="loadmore"]`)!;
    expect(mayClick(more, "loadMore")).toBe(true);
    more.setAttribute("aria-hidden", "true");
    expect(mayClick(more, "loadMore")).toBe(false);
    // An inert expand control is refused.
    const fresh = load("sdui-interaction-traps", PATHS.posts);
    fresh.doc.querySelector("[role='listitem']")!.setAttribute("inert", "");
    expect(mayClick(fresh.doc.querySelector(`[data-ok="expand"]`)!, "expandText")).toBe(false);
  });

  it("an expand control in a profile section is allowed only in the profile's own sections", () => {
    const page = load("sdui-profile");
    const about = page.doc.querySelector("[componentkey='synthetic-about'] [data-testid='expandable-text-button']")!;
    const ad = page.doc.querySelector(`[data-trap="ad-expand"]`)!;
    expect(mayClick(about, "expandText")).toBe(true);
    expect(mayClick(ad, "expandText")).toBe(false);
    // Reading the profile presses the About control only.
    expandProfile(context(page.doc), "profile");
    expect(page.clicks).toEqual([about]);
  });

  it("on the detail pages, only the description's expand control; never back, add, the filter tabs or the ad controls", () => {
    const exp = load("sdui-details-experience", PATHS.experience);
    const allowed = everyCandidate(exp.doc).filter((el) => mayClick(el, "expandText"));
    expect(allowed).toHaveLength(1);
    expect(allowed[0]!.closest("[componentkey]")!.getAttribute("componentkey")).toBe("synthetic-exp-1");
    const skills = load("sdui-details-skills", PATHS.skills);
    expect(everyCandidate(skills.doc).filter((el) => mayClick(el, "expandText") || mayClick(el, "loadMore"))).toEqual([]);
  });

  it("refuses load-more controls inside an item, or with an action word, and before the last item", () => {
    const page = load("sdui-interaction-traps");
    for (const trap of ["loadmore-in-block", "loadmore-follow"]) {
      expect(mayClick(page.doc.querySelector(`[data-trap="${trap}"]`)!, "loadMore")).toBe(false);
    }
    expect(mayClick(page.doc.querySelector(`[data-ok="loadmore"]`)!, "loadMore")).toBe(true);
    const early = page.doc.querySelector(`[data-ok="loadmore"]`)!;
    page.doc.querySelector("main")!.prepend(early);
    const interactions = createInteractions(page.doc, { clicksEnabled: true, recordClicks: false });
    expect(interactions.loadMore()).toBe(false);
  });

  it("clicks an expand control at most once, and logs it", () => {
    const page = load("sdui-interaction-traps");
    const interactions = createInteractions(page.doc, { clicksEnabled: true, recordClicks: true });
    const el = page.doc.querySelector(`[data-ok="expand"]`)!;
    el.setAttribute("data-stays", ""); // stays in the page after the click
    expect(interactions.expandText(el)).toBe(true);
    expect(interactions.expandText(el)).toBe(false);
    expect(page.clicks).toHaveLength(1);
    expect(interactions.clickLog).toEqual([{ tag: "button", selector: "expandText: button[data-testid='expandable-text-button']", name: "… more", container: "listitem" }]);
  });

  it('with <html lang="de"> nothing at all is clicked', () => {
    const page = load("sdui-interaction-traps", PATHS.posts);
    page.doc.documentElement.setAttribute("lang", "de");
    const ctx = context(page.doc, { clicksEnabled: false });
    expandWithin(findBlocks(page.doc).flatMap((b) => textContainersOf(b)), ctx);
    for (const el of everyCandidate(page.doc)) ctx.interactions.expandText(el);
    expect(ctx.interactions.loadMore()).toBe(false);
    expect(page.clicks).toHaveLength(0);
  });

  it("scrolls the window only, by 0.8 of the viewport", () => {
    const page = load("sdui-activity-posts", PATHS.posts);
    const calls: unknown[][] = [];
    page.dom.window.scrollBy = ((...args: unknown[]) => { calls.push(args); }) as typeof page.dom.window.scrollBy;
    createInteractions(page.doc, { clicksEnabled: true, recordClicks: false }).scrollStep();
    expect(calls).toEqual([[0, Math.round(page.dom.window.innerHeight * 0.8)]]);
  });
});
