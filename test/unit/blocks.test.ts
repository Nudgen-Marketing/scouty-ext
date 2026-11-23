import { describe, expect, it } from "vitest";
import { degradedBlock, expandWithin, findBlocks, readBlocks, textContainersOf } from "../../src/reader/blocks";
import { CUT_MARKER } from "../../src/reader/clamp";
import { permalinkFor } from "../../src/reader/urn";
import { context, load } from "../helpers/fixture";

function read(name: string, path: string, options: { expand?: boolean; clicksEnabled?: boolean } = {}) {
  const page = load(name, path);
  const ctx = context(page.doc, { clicksEnabled: options.clicksEnabled });
  if (options.expand !== false) expandWithin(findBlocks(page.doc).flatMap((b) => textContainersOf(b)), ctx);
  return { page, ctx, blocks: readBlocks(ctx) };
}

describe("blocks", () => {
  it("reads count, text, URN, permalink, time and truncated from the posts page", () => {
    const { blocks, page } = read("activity-posts", "/in/synthetic-person-one/recent-activity/all/");
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({
      text: "Synthetic Person One\nFirst invented post about placeholder widgets. 2w",
      urn: "urn:li:activity:7130316800000000000", urnTime: "2023-11-14T22:13:20.000Z", truncated: false,
    });
    expect(permalinkFor(blocks[0]!.urn!)).toBe("https://www.linkedin.com/feed/update/urn:li:activity:7130316800000000000/");
    // The long post was expanded with the one allowed control, so it is whole.
    expect(blocks[1]!.text).toContain("THE-TAIL-OF-POST-TWO");
    expect(blocks[1]!.truncated).toBe(false);
    expect(page.clicks.map((el) => el.textContent)).toEqual(["…see more"]);
    // A block whose id is not an activity URN carries no URN, and so no time either.
    expect(blocks[2]!.urn).toBeNull();
    expect(blocks[2]!.urnTime).toBeNull();
  });

  it("never includes action labels or screen-reader duplicates in the text", () => {
    const { blocks } = read("activity-posts", "/in/synthetic-person-one/recent-activity/all/");
    for (const block of blocks) {
      expect(block.text).not.toMatch(/Like|Comment|Repost|Send|Follow|see more/);
      expect(block.text.match(/Synthetic Person One/g)?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });

  it("flags a block truncated when its expand control was not pressed", () => {
    const { blocks, page } = read("activity-posts", "/in/synthetic-person-one/recent-activity/all/", { clicksEnabled: false });
    expect(page.clicks).toHaveLength(0);
    expect(blocks[1]!.truncated).toBe(true);
    expect(blocks[1]!.text).not.toContain("THE-TAIL-OF-POST-TWO");
  });

  it("a comments block with a long parent post still ends with the lead's comment", () => {
    const page = load("activity-comments", "/in/synthetic-person-one/recent-activity/comments/");
    page.doc.querySelector("[data-parent-post] span")!.textContent = "PARENT-START " + "long parent text ".repeat(600);
    const blocks = readBlocks(context(page.doc));
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.text.length).toBeLessThanOrEqual(4000);
    expect(block.truncated).toBe(true);
    expect(block.text).toContain(CUT_MARKER);
    expect(block.text).toContain("PARENT-START");
    expect(block.text.endsWith("THE-LEAD-COMMENT: an invented reply that must survive clamping.")).toBe(true);
    // The URN on this page names the post that was answered.
    expect(block.urn).toBe("urn:li:activity:7127722905600000000");
  });

  it("reads the reactions page, non-Latin text included", () => {
    const { blocks } = read("activity-reactions", "/in/synthetic-person-one/recent-activity/reactions/");
    expect(blocks.map((b) => b.urn)).toEqual(["urn:li:activity:7125206220800000000", "urn:li:activity:7122689536000000000"]);
    expect(blocks[1]!.text).toContain("Bài viết giả định bằng tiếng Việt để kiểm thử.");
  });

  it("drops a duplicate of the same URN", () => {
    const page = load("activity-reactions", "/in/synthetic-person-one/recent-activity/reactions/");
    const first = page.doc.querySelector(".feed-shared-update-v2")!;
    first.parentElement!.appendChild(first.cloneNode(true));
    expect(readBlocks(context(page.doc))).toHaveLength(2);
  });

  it("with the block selectors gone, degrades to one block with no URN", () => {
    const page = load("activity-posts", "/in/synthetic-person-one/recent-activity/all/");
    for (const el of Array.from(page.doc.querySelectorAll(".feed-shared-update-v2"))) {
      el.className = "renamed-by-linkedin";
      el.removeAttribute("data-urn");
    }
    const ctx = context(page.doc);
    expect(readBlocks(ctx)).toEqual([]);
    const block = degradedBlock(ctx)!;
    expect(block.urn).toBeNull();
    expect(block.urnTime).toBeNull();
    expect(block.truncated).toBe(true);
    expect(block.text).toContain("First invented post about placeholder widgets.");
  });
});
