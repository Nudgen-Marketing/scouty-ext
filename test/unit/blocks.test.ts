import { describe, expect, it } from "vitest";
import { activityListEmpty, blockOrder, dateLabel, degradedBlock, expandWithin, findBlocks, isLoading, kindHint, readBlocks, textContainersOf } from "../../src/reader/blocks";
import { CUT_MARKER } from "../../src/reader/clamp";
import { permalinkFor } from "../../src/reader/urn";
import { context, load, PATHS, pressAll } from "../helpers/fixture";

function read(name: string, path: string, options: { expand?: boolean; clicksEnabled?: boolean } = {}) {
  const page = load(name, path);
  const ctx = context(page.doc, { clicksEnabled: options.clicksEnabled });
  if (options.expand !== false) pressAll(() => expandWithin(findBlocks(page.doc).flatMap((b) => textContainersOf(b)), ctx));
  return { page, ctx, blocks: readBlocks(ctx) };
}

describe("expandWithin: one press at a time, near the viewport only", () => {
  const item = (n: number, where: string): string =>
    `<div role="listitem" data-where="${where}"><div><span data-testid="expandable-text-box">Post ${n}<span data-rest hidden> TAIL-${n}</span><button type="button" aria-hidden="true" data-testid="expandable-text-button">… more</button></span></div></div>`;

  it("presses only the first visible control near the viewport, and counts those near or ahead as still to press", () => {
    const page = load("sdui-activity-posts", PATHS.posts);
    const list = page.doc.querySelector("[role='list']")!;
    list.innerHTML = [item(1, "behind"), item(2, "near"), item(3, "near"), item(4, "ahead"), item(5, "ahead")].join("");
    const ctx = { ...context(page.doc), reach: (el: Element) => el.closest("[data-where]")!.getAttribute("data-where") as "near" | "ahead" | "behind" };
    const boxes = (): Element[] => findBlocks(page.doc).flatMap((b) => textContainersOf(b));
    // One press per call: item 2, then item 3; the one scrolled past is never pressed; those ahead wait.
    expect(expandWithin(boxes(), ctx)).toEqual({ clicked: true, pending: 3 });
    expect(page.clicks).toHaveLength(1);
    expect(expandWithin(boxes(), ctx)).toEqual({ clicked: true, pending: 2 });
    expect(expandWithin(boxes(), ctx)).toEqual({ clicked: false, pending: 2 });
    expect(page.clicks).toHaveLength(2);
    // After a scroll step the ones ahead come near and are pressed in turn.
    for (const el of page.doc.querySelectorAll("[data-where='ahead']")) el.setAttribute("data-where", "near");
    expect(pressAll(() => expandWithin(boxes(), ctx))).toBe(2);
    const text = readBlocks(ctx).map((b) => b.text).join("\n");
    expect(text).toMatch(/TAIL-2[\s\S]*TAIL-3[\s\S]*TAIL-4[\s\S]*TAIL-5/);
    expect(text).not.toContain("TAIL-1");
  });

  it("an invisible control is neither pressed nor counted", () => {
    const page = load("sdui-activity-posts", PATHS.posts);
    page.doc.querySelector("[data-testid='expandable-text-button']")!.setAttribute("data-test-invisible", "");
    expect(expandWithin(findBlocks(page.doc).flatMap((b) => textContainersOf(b)), context(page.doc))).toEqual({ clicked: false, pending: 0 });
    expect(page.clicks).toHaveLength(0);
  });
});

describe("blocks (SDUI activity pages)", () => {
  it("a block is a listitem of the LazyColumn list inside main#workspace", () => {
    const page = load("sdui-activity-posts", PATHS.posts);
    expect(findBlocks(page.doc)).toHaveLength(3);
    // A listitem outside that list is not a block.
    page.doc.querySelector("main")!.insertAdjacentHTML("beforeend", `<div role="list"><div role="listitem"><span data-testid="expandable-text-box">stray</span></div></div>`);
    expect(findBlocks(page.doc)).toHaveLength(3);
  });

  it("reads text, kind hint, date label, URN, permalink, time and truncated from the posts page", () => {
    const { blocks, page } = read("sdui-activity-posts", PATHS.posts);
    expect(blocks).toHaveLength(3);
    // An own post: its URN comes from the /analytics/post-summary/ link.
    expect(blocks[0]).toEqual({
      text: "2w\nFirst invented post about placeholder widgets.",
      urn: "urn:li:activity:7130316800000000000", urnTime: "2023-11-14T22:13:20.000Z", truncated: false,
    });
    expect(permalinkFor(blocks[0]!.urn!)).toBe("https://www.linkedin.com/feed/update/urn:li:activity:7130316800000000000/");
    // The long post was expanded with the one allowed control, so it is whole; its URN is from /feed/update/.
    expect(blocks[1]!.text).toBe("1w\nSecond invented post, a long one. It continues with more invented detail and ends with THE-TAIL-OF-POST-TWO.");
    expect(blocks[1]!.urn).toBe("urn:li:activity:7131078450000000000");
    expect(blocks[1]!.truncated).toBe(false);
    expect(page.clicks.map((el) => el.getAttribute("data-testid"))).toEqual(["expandable-text-button"]);
    // A repost: the header line is the kind hint. Its link names a ugcPost: sent as its URN, with its
    // permalink and the time its id carries (selectors v3; it was dropped before).
    expect(blocks[2]!.text).toBe("Synthetic Person One reposted this\n3d\nA reposted invented post with a document and no activity id.");
    expect(blocks[2]!.urn).toBe("urn:li:ugcPost:7131078450000000001");
    expect(blocks[2]!.urnTime).toBe("2023-11-17T00:39:51.510Z");
    expect(permalinkFor(blocks[2]!.urn!)).toBe("https://www.linkedin.com/feed/update/urn:li:ugcPost:7131078450000000001/");
  });

  it("never reads action controls, their labels, the 'Feed post' heading or page furniture", () => {
    const { blocks } = read("sdui-activity-posts", PATHS.posts);
    for (const block of blocks) {
      expect(block.text).not.toMatch(/Like|Comment|Repost|Send|Follow|Open control menu|Open reactions menu|Reaction button state|Go to (next|previous) page|Page \d of \d|Feed post|… more/);
    }
  });

  it("flags a block truncated when its expand control was not pressed", () => {
    const { blocks, page } = read("sdui-activity-posts", PATHS.posts, { clicksEnabled: false });
    expect(page.clicks).toHaveLength(0);
    expect(blocks[1]!.truncated).toBe(true);
    expect(blocks[1]!.text).not.toContain("THE-TAIL-OF-POST-TWO");
  });

  it("a comments block keeps the post first and the lead's comment last, even when clamped", () => {
    const page = load("sdui-activity-comments", PATHS.comments);
    page.doc.querySelector("[data-parent-post] span")!.textContent = "PARENT-START " + "long parent text ".repeat(600);
    const blocks = readBlocks(context(page.doc));
    expect(blocks).toHaveLength(2);
    const block = blocks[0]!;
    expect(block.text.length).toBeLessThanOrEqual(4000);
    expect(block.truncated).toBe(true);
    expect(block.text).toContain(CUT_MARKER);
    expect(block.text.startsWith("Synthetic Person One commented on this\n1mo\nPARENT-START")).toBe(true);
    expect(block.text.endsWith("THE-LEAD-COMMENT: an invented reply that must survive clamping.")).toBe(true);
    // The URN on this page names the post that was answered (the comment link's query is ignored).
    expect(block.urn).toBe("urn:li:activity:7127722905600000000");
  });

  it("two different comments by the lead on one post are both kept, in that post's block; the same item read twice is kept once", () => {
    const page = load("sdui-activity-comments", PATHS.comments);
    const first = findBlocks(page.doc)[0]!;
    const second = first.cloneNode(true) as Element;
    const lead = [...second.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent?.includes("THE-LEAD-COMMENT"))!;
    lead.textContent = "ANOTHER-LEAD-COMMENT on the same post.";
    const repeat = first.cloneNode(true) as Element;
    first.after(second, repeat);
    expect(findBlocks(page.doc)).toHaveLength(4);
    const blocks = readBlocks(context(page.doc));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.urn).toBe("urn:li:activity:7127722905600000000");
    expect(blocks[0]!.text).toContain("THE-LEAD-COMMENT");
    expect(blocks[0]!.text).toContain("ANOTHER-LEAD-COMMENT on the same post.");
    expect(blocks[0]!.text.match(/THE-LEAD-COMMENT/g)).toHaveLength(1);
    // The cap counts distinct posts: the three items on one post are one place.
    expect(blockOrder(page.doc).map(({ place }) => place)).toEqual([0, 0, 0, 1]);
  });

  it("two comments of the lead on a 3,000-character post: both kept, the post once", () => {
    const page = load("sdui-activity-comments", PATHS.comments);
    page.doc.querySelector("[data-parent-post] span")!.textContent = "PARENT-START " + "x".repeat(2987);
    const first = findBlocks(page.doc)[0]!;
    const second = first.cloneNode(true) as Element;
    [...second.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent?.includes("THE-LEAD-COMMENT"))!.textContent = "ANOTHER-LEAD-COMMENT on the same post.";
    first.after(second);
    const block = readBlocks(context(page.doc))[0]!;
    expect(block.text.length).toBeLessThanOrEqual(4000);
    expect(block.text).toContain("THE-LEAD-COMMENT");
    expect(block.text.endsWith("ANOTHER-LEAD-COMMENT on the same post.")).toBe(true);
    expect(block.text.match(/PARENT-START/g)).toHaveLength(1);
    expect(block.truncated).toBe(false); // the post once and both comments fit in 4,000
  });

  it("one item keeps all its lines: a short comment or a date label that also occurs in the post stays", () => {
    const page = load("sdui-activity-comments", PATHS.comments);
    page.doc.querySelector("[data-parent-post] span")!.textContent = "Our 1mo pilot is done. Congratulations to the whole team!";
    [...findBlocks(page.doc)[0]!.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent?.includes("THE-LEAD-COMMENT"))!.textContent = "Congratulations";
    const block = readBlocks(context(page.doc))[0]!;
    expect(block.text).toBe("Synthetic Person One commented on this\n1mo\nOur 1mo pilot is done. Congratulations to the whole team!\nCongratulations");
  });

  it("a cut read and a full read of the same item keep the full one; an equal comment twice is kept once", () => {
    const page = load("sdui-activity-comments", PATHS.comments);
    const first = findBlocks(page.doc)[0]!;
    const cut = first.cloneNode(true) as Element;
    const post = cut.querySelector("[data-parent-post] span")!;
    post.textContent = `${post.textContent!.slice(0, 20)}…`;
    first.before(cut);
    const block = readBlocks(context(page.doc))[0]!;
    expect(block.text).toBe(readBlocks(context(load("sdui-activity-comments", PATHS.comments).doc))[0]!.text);
    expect(block.text.match(/THE-LEAD-COMMENT/g)).toHaveLength(1);
  });

  it("a later item with its post still collapsed keeps its own comment, even one the post starts with", () => {
    const page = load("sdui-activity-comments", PATHS.comments);
    page.doc.querySelector("[data-parent-post] span")!.textContent = "Congratulations to the whole team on the launch of our new placeholder product.";
    const leadOf = (el: Element) => [...el.querySelectorAll("*")].find((node) => node.children.length === 0 && node.textContent?.includes("THE-LEAD-COMMENT"))!;
    const first = findBlocks(page.doc)[0]!;
    const second = first.cloneNode(true) as Element;
    leadOf(first).textContent = "Well deserved";
    leadOf(second).textContent = "Congratulations";
    second.querySelector("[data-parent-post] span")!.textContent = "Congratulations to the whole team…";
    first.after(second);
    const block = readBlocks(context(page.doc))[0]!;
    expect(block.text.endsWith("Congratulations to the whole team on the launch of our new placeholder product.\nWell deserved\nCongratulations")).toBe(true);
    expect(block.text.match(/Congratulations to the whole team/g)).toHaveLength(1);
  });

  it("a later comment that an earlier one starts with is kept; a cut read never wins over a full one", () => {
    const page = load("sdui-activity-comments", PATHS.comments);
    const leadOf = (el: Element) => [...el.querySelectorAll("*")].find((node) => node.children.length === 0 && node.textContent?.includes("THE-LEAD-COMMENT"))!;
    const first = findBlocks(page.doc)[0]!;
    const fullPost = first.querySelector("[data-parent-post] span")!.textContent!;
    const second = first.cloneNode(true) as Element;
    leadOf(first).textContent = "Great post, see you there";
    leadOf(second).textContent = "Great post";
    first.querySelector("[data-parent-post] span")!.textContent = `${fullPost.slice(0, 20)}…`;
    first.after(second);
    const block = readBlocks(context(page.doc))[0]!;
    expect(block.text).toContain("Great post, see you there\nGreat post");
    expect(block.text).toContain(fullPost);
    expect(block.text).not.toContain(`${fullPost.slice(0, 20)}…`);
  });

  it("an empty post box in a later item does not move its comment into the post's place", () => {
    const page = load("sdui-activity-comments", PATHS.comments);
    const leadOf = (el: Element) => [...el.querySelectorAll("*")].find((node) => node.children.length === 0 && node.textContent?.includes("THE-LEAD-COMMENT"))!;
    const first = findBlocks(page.doc)[0]!;
    first.querySelector("[data-parent-post] span")!.textContent = "Congratulations to the whole…";
    const second = first.cloneNode(true) as Element;
    leadOf(first).textContent = "Well deserved";
    second.querySelector("[data-parent-post] span")!.textContent = "";
    leadOf(second).textContent = "Congratulations to the whole team, you earned it";
    first.after(second);
    const block = readBlocks(context(page.doc))[0]!;
    expect(block.text).toContain("Congratulations to the whole…\nWell deserved\nCongratulations to the whole team, you earned it");
    expect(block.truncated).toBe(true);
  });

  it("two identical items without a post link are one block and one place against the cap", () => {
    const page = load("sdui-activity-comments", PATHS.comments);
    const noLink = findBlocks(page.doc)[1]!;
    noLink.after(noLink.cloneNode(true));
    expect(readBlocks(context(page.doc))).toHaveLength(2);
    expect(new Set(blockOrder(page.doc).map(({ place }) => place)).size).toBe(2);
  });

  it("a comments item without a post link has no URN, and both its text boxes are read", () => {
    const { blocks } = read("sdui-activity-comments", PATHS.comments);
    expect(blocks[1]).toEqual({
      text: "Synthetic Person One commented on this\n2mo\nAnother invented post, this item carries no post link.\nA second invented comment by the lead.",
      urn: null, urnTime: null, truncated: false,
    });
  });

  it("reads the reactions page: kind hints, an activity URN, a share URN sent as it is, non-Latin text", () => {
    const { blocks } = read("sdui-activity-reactions", PATHS.reactions);
    expect(blocks.map((b) => b.urn)).toEqual(["urn:li:activity:7125206220800000000", "urn:li:share:7122689536000000000"]);
    expect(blocks[1]!.urnTime).toBe("2023-10-24T21:05:18.554Z");
    expect(blocks[0]!.text).toBe("Synthetic Person One likes this\n5h\nAn invented post the lead reacted to.");
    expect(blocks[1]!.text).toBe("Synthetic Person One liked a comment on this\n3d\nBài viết giả định bằng tiếng Việt để kiểm thử.");
  });

  it("drops a duplicate of the same post, by activity URN or by share URN", () => {
    const page = load("sdui-activity-reactions", PATHS.reactions);
    const list = page.doc.querySelector("[role='list']")!;
    for (const item of Array.from(list.children)) list.appendChild(item.cloneNode(true));
    expect(findBlocks(page.doc)).toHaveLength(4);
    expect(readBlocks(context(page.doc))).toHaveLength(2);
  });

  it("an item without a text box is read as its visible text, controls left out", () => {
    const page = load("sdui-activity-posts", PATHS.posts);
    const first = page.doc.querySelector("[role='listitem']")!;
    first.querySelector("[data-testid='expandable-text-box']")!.remove();
    const block = readBlocks(context(page.doc))[0]!;
    expect(block.text).toContain("Synthetic Person One");
    expect(block.text).toContain("12 impressions");
    expect(block.text).not.toMatch(/Feed post|Comment|Repost|Send|Open control menu/);
    expect(block.urn).toBe("urn:li:activity:7130316800000000000");
  });

  it("with the list gone, degrades to one block with no URN", () => {
    const page = load("sdui-activity-posts", PATHS.posts);
    page.doc.querySelector("[role='list']")!.removeAttribute("data-component-type");
    const ctx = context(page.doc);
    expect(readBlocks(ctx)).toEqual([]);
    const block = degradedBlock(ctx)!;
    expect(block.urn).toBeNull();
    expect(block.urnTime).toBeNull();
    expect(block.truncated).toBe(true);
    expect(block.text).toContain("First invented post about placeholder widgets.");
    expect(block.text).not.toMatch(/Feed post|Open reactions menu|Repost/);
  });

  it("knows the loader and the empty list", () => {
    const page = load("sdui-activity-empty", "/in/synthetic-person-two/recent-activity/all/");
    expect(activityListEmpty(page.doc)).toBe(true);
    page.doc.querySelector("main")!.insertAdjacentHTML("beforeend", `<div data-testid="loader"></div>`);
    expect(isLoading(page.doc)).toBe(true);
    expect(activityListEmpty(page.doc)).toBe(false);
    expect(activityListEmpty(load("sdui-activity-posts", PATHS.posts).doc)).toBe(false);
  });
});

describe("kind hints and date labels", () => {
  it.each([
    ["Synthetic Person One reposted this", true], ["Synthetic Person One likes this", true], ["Synthetic Person One liked a comment on this", true],
    ["Synthetic Person One commented on this", true], ["Synthetic Person One loves this", true], ["Synthetic Person One finds this insightful", true],
    ["Synthetic Person One", false], ["Head of Placeholder Operations", false], ["Visible to anyone", false],
    ["Supports founders in this region", false], ["Finds talent for this industry", false],
  ])("%s → hint %s", (line, isHint) => {
    expect(kindHint(["Feed post", line]) === line).toBe(isHint);
  });

  it.each([
    ["1w •", "1w"], ["2w •", "2w"], ["1mo •", "1mo"], ["3d •", "3d"], ["5h •", "5h"], ["1w • Edited •", "1w"], ["12m •", "12m"], ["1yr •", "1yr"],
    ["2 tuần •", "2tuần"], ["Synthetic Person One", null], ["1w", null], ["1 week ago", null], ["500+ connections", null],
  ])("%s → %s", (line, label) => {
    expect(dateLabel([line])).toBe(label);
  });

  it("takes the first date of the item", () => {
    expect(dateLabel(["Another Synthetic Author", "1mo •", "3w •"])).toBe("1mo");
  });
});
