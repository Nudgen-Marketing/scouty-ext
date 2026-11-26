import { describe, expect, it } from "vitest";
import { parsePostUrn, permalinkFor, plausibleIsoTime, postUrnFromHref, postUrnFromLinks, urnTime } from "../../src/reader/urn";

const NOW = Date.UTC(2026, 0, 1);

describe("urn", () => {
  it("accepts only whole post URNs: activity, share and ugcPost", () => {
    for (const urn of ["urn:li:activity:7130316800000000000", "urn:li:share:7130316800000000000", "urn:li:ugcPost:7130316800000000000"]) expect(parsePostUrn(urn)).toBe(urn);
    expect(parsePostUrn(" urn:li:activity:7130316800000000000 ")).toBe("urn:li:activity:7130316800000000000");
    for (const bad of [
      "urn:li:comment:7130316800000000000", "urn:li:comment:(activity:1,2)", "urn:li:Share:7130316800000000000",
      "urn:li:fs_updateV2:(urn:li:activity:7130316800000000000,FEED)", "urn:li:activity:12345", "urn:li:activity:abc",
      "urn:li:activity:7130316800000000000/../x", "urn:li:share:" + "1".repeat(26), "", null, undefined,
    ]) expect(parsePostUrn(bad)).toBeNull();
  });

  it("builds the permalink form for every post URN", () => {
    expect(permalinkFor("urn:li:activity:7130316800000000000")).toBe("https://www.linkedin.com/feed/update/urn:li:activity:7130316800000000000/");
    expect(permalinkFor("urn:li:share:7122689536000000000")).toBe("https://www.linkedin.com/feed/update/urn:li:share:7122689536000000000/");
    expect(permalinkFor("urn:li:ugcPost:1234567")).toBe("https://www.linkedin.com/feed/update/urn:li:ugcPost:1234567/");
    expect(permalinkFor("urn:li:comment:1234567")).toBeNull();
  });

  // Pairs computed from the rule under test (id = milliseconds << 22). The rule itself is
  // unverified against LinkedIn until the owner task E0.
  it.each([
    ["7130316800000000000", "2023-11-14T22:13:20.000Z"],
    ["7131078450000000000", "2023-11-17T00:39:51.510Z"],
    ["7127722905600000000", "2023-11-07T18:26:07.382Z"],
  ])("decodes the time of %s", (id, iso) => {
    expect(urnTime(`urn:li:activity:${id}`, NOW)).toBe(iso);
    // Share and ugcPost ids carry the time the same way (checked on live LinkedIn, 2026-11-26).
    expect(urnTime(`urn:li:share:${id}`, NOW)).toBe(iso);
    expect(urnTime(`urn:li:ugcPost:${id}`, NOW)).toBe(iso);
  });

  it("drops implausible times", () => {
    expect(urnTime("urn:li:activity:123456", NOW)).toBeNull(); // 1970
    expect(urnTime(`urn:li:activity:${(BigInt(NOW + 3_600_000) << 22n).toString()}`, NOW)).toBeNull(); // future
    expect(urnTime("urn:li:comment:7130316800000000000", NOW)).toBeNull();
    expect(plausibleIsoTime("2023-11-20T09:00:00.000Z", NOW)).toBe("2023-11-20T09:00:00.000Z");
    expect(plausibleIsoTime("1999-01-01T00:00:00Z", NOW)).toBeNull();
    expect(plausibleIsoTime("not a date", NOW)).toBeNull();
  });
  it.each([
    ["/feed/update/urn:li:activity:7130316800000000000/", "activity", "urn:li:activity:7130316800000000000"],
    ["https://www.linkedin.com/feed/update/urn:li:activity:7130316800000000000/", "activity", "urn:li:activity:7130316800000000000"],
    ["/feed/update/urn:li:activity:7130316800000000000/?commentUrn=urn%3Ali%3Acomment%3A%28activity%3A1%2C2%29", "activity", "urn:li:activity:7130316800000000000"],
    ["/feed/update/urn%3Ali%3Aactivity%3A7130316800000000000/", "activity", "urn:li:activity:7130316800000000000"],
    ["/analytics/post-summary/urn:li:activity:7130316800000000000/", "activity", "urn:li:activity:7130316800000000000"],
    ["/feed/update/urn:li:share:7122689536000000000/", "share", "urn:li:share:7122689536000000000"],
    ["/feed/update/urn:li:ugcPost:7131078450000000001", "ugcPost", "urn:li:ugcPost:7131078450000000001"],
    // One's own posts: the Boost link names the post in its `content` parameter, often its only link.
    ["/campaignmanager/boost/campaigns/new/details?origin=x&content=urn%3Ali%3Ashare%3A7122689536000000000&isNileReferrer=true", "share", "urn:li:share:7122689536000000000"],
    ["https://www.linkedin.com/campaignmanager/boost/campaigns/new/details?content=urn:li:ugcPost:7131078450000000001", "ugcPost", "urn:li:ugcPost:7131078450000000001"],
  ])("reads the post URN of %s", (href, kind, urn) => {
    expect(postUrnFromHref(href)).toEqual({ kind, urn });
  });

  it.each([
    null, "", "/in/synthetic-person-one/", "/feed/", "/feed/hashtag/placeholders/", "/feed/update/urn:li:comment:7130316800000000000/",
    "/feed/update/urn:li:activity:12345/", "/feed/update/urn:li:activity:7130316800000000000x/", "/x/feed/update/urn:li:activity:7130316800000000000/",
    "/feed/update/urn:li:activity:7130316800000000000/extra/", "/feed/update/%E0%A4%A/",
    "/campaignmanager/boost/campaigns/new/details", "/campaignmanager/boost/campaigns/new/details?content=urn:li:comment:7122689536000000000",
    "/campaignmanager/boost/campaigns/new/details?content=urn:li:share:7122689536000000000x", "/campaignmanager/overview?content=urn:li:share:7122689536000000000",
    "/search/results/content/?content=urn:li:share:7122689536000000000",
  ])("ignores %s", (href) => {
    expect(postUrnFromHref(href)).toBeNull();
  });

  it("prefers an activity URN among an item's links, and uses a share URN from the Boost link when it is the only one", () => {
    expect(postUrnFromLinks(["/in/x/", "/company/y/", "/campaignmanager/boost/campaigns/new/details?content=urn%3Ali%3Ashare%3A7122689536000000000"]))
      .toEqual({ kind: "share", urn: "urn:li:share:7122689536000000000" });
    expect(postUrnFromLinks(["/in/x/", "/feed/update/urn:li:share:7122689536000000000/", "/analytics/post-summary/urn:li:activity:7130316800000000000/"]))
      .toEqual({ kind: "activity", urn: "urn:li:activity:7130316800000000000" });
    expect(postUrnFromLinks(["/feed/update/urn:li:ugcPost:7131078450000000001/", "/feed/update/urn:li:share:7122689536000000000/"]))
      .toEqual({ kind: "ugcPost", urn: "urn:li:ugcPost:7131078450000000001" });
    expect(postUrnFromLinks(["/in/x/", null])).toBeNull();
  });
});
