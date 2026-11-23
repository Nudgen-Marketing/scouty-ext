import { describe, expect, it } from "vitest";
import { parseActivityUrn, permalinkFor, plausibleIsoTime, urnTime } from "../../src/reader/urn";

const NOW = Date.UTC(2026, 0, 1);

describe("urn", () => {
  it("accepts only whole activity URNs", () => {
    expect(parseActivityUrn("urn:li:activity:7130316800000000000")).toBe("urn:li:activity:7130316800000000000");
    expect(parseActivityUrn(" urn:li:activity:7130316800000000000 ")).toBe("urn:li:activity:7130316800000000000");
    for (const bad of [
      "urn:li:ugcPost:7130316800000000000", "urn:li:share:7130316800000000000", "urn:li:comment:(activity:1,2)",
      "urn:li:fs_updateV2:(urn:li:activity:7130316800000000000,FEED)", "urn:li:activity:12345", "urn:li:activity:abc",
      "urn:li:activity:7130316800000000000/../x", "urn:li:activity:" + "1".repeat(26), "", null, undefined,
    ]) expect(parseActivityUrn(bad)).toBeNull();
  });

  it("builds the permalink form", () => {
    expect(permalinkFor("urn:li:activity:7130316800000000000")).toBe("https://www.linkedin.com/feed/update/urn:li:activity:7130316800000000000/");
    expect(permalinkFor("urn:li:ugcPost:1234567")).toBeNull();
  });

  // Pairs computed from the rule under test (id = milliseconds << 22). The rule itself is
  // unverified against LinkedIn until the owner task E0.
  it.each([
    ["7130316800000000000", "2023-11-14T22:13:20.000Z"],
    ["7131078450000000000", "2023-11-17T00:39:51.510Z"],
    ["7127722905600000000", "2023-11-07T18:26:07.382Z"],
  ])("decodes the time of %s", (id, iso) => {
    expect(urnTime(`urn:li:activity:${id}`, NOW)).toBe(iso);
  });

  it("drops implausible times", () => {
    expect(urnTime("urn:li:activity:123456", NOW)).toBeNull(); // 1970
    expect(urnTime(`urn:li:activity:${(BigInt(NOW + 3_600_000) << 22n).toString()}`, NOW)).toBeNull(); // future
    expect(urnTime("urn:li:share:7130316800000000000", NOW)).toBeNull();
    expect(plausibleIsoTime("2023-11-20T09:00:00.000Z", NOW)).toBe("2023-11-20T09:00:00.000Z");
    expect(plausibleIsoTime("1999-01-01T00:00:00Z", NOW)).toBeNull();
    expect(plausibleIsoTime("not a date", NOW)).toBeNull();
  });
});
