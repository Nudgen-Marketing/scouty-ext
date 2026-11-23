import { describe, expect, it } from "vitest";
import { HOST_PATTERNS } from "../../src/config";
import { hasHostPermissions, REQUIRED_ORIGINS, requestHostPermissions } from "../../src/background/permissions";
import { fake } from "../helpers/fake-ext";

describe("permissions", () => {
  it("needs exactly the LinkedIn profile paths and the Scouty origin, without ports", () => {
    expect(REQUIRED_ORIGINS).toEqual(["https://www.linkedin.com/in/*", "https://scouty.to/*"]);
    expect(HOST_PATTERNS.api).not.toMatch(/:\d/);
  });

  it("is missing until both are granted (the Firefox default)", async () => {
    expect(await hasHostPermissions()).toBe(false);
    fake.granted.add("https://www.linkedin.com/in/*");
    expect(await hasHostPermissions()).toBe(false);
    fake.granted.add("https://scouty.to/*");
    expect(await hasHostPermissions()).toBe(true);
  });

  it("requests both origins in one prompt and reports the answer", async () => {
    expect(await requestHostPermissions()).toBe(true);
    expect(fake.permissionsRequest).toHaveBeenCalledWith({ origins: ["https://www.linkedin.com/in/*", "https://scouty.to/*"] });
    expect(await hasHostPermissions()).toBe(true);
    fake.permissionsRequest.mockImplementation(async () => false);
    expect(await requestHostPermissions()).toBe(false);
    fake.permissionsRequest.mockImplementation(async () => { throw new Error("not a user action"); });
    expect(await requestHostPermissions()).toBe(false);
  });
});
