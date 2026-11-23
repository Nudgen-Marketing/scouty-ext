import { describe, expect, it } from "vitest";
import { detectPageState, stopReasonFor } from "../../src/reader/page-state";
import { fixtureHtml, load } from "../helpers/fixture";

describe("page-state", () => {
  it.each([
    ["profile", "ok"], ["profile-empty", "ok"], ["details-experience", "ok"], ["details-skills", "ok"], ["details-empty", "ok"],
    ["activity-posts", "ok"], ["activity-comments", "ok"], ["activity-reactions", "ok"], ["activity-empty", "ok"],
    ["reduced-profile", "reduced_profile"], ["authwall", "logged_out"], ["checkpoint", "checkpoint"],
    ["not-found", "not_found"], ["unrelated", "unknown"],
  ])("%s → %s", (name, state) => {
    expect(detectPageState(load(name).doc)).toBe(state);
  });

  it("every synthetic fixture is labelled", () => {
    for (const name of ["profile", "activity-posts", "checkpoint", "unrelated", "interaction-traps"]) {
      expect(fixtureHtml(name).startsWith("<!-- SYNTHETIC: not captured from LinkedIn; structure is a best guess")).toBe(true);
    }
  });

  it("an unrecognised page is unknown, and an empty document too", () => {
    expect(detectPageState(load("x", "/in/x/", "<html><body><p>hello</p></body></html>").doc)).toBe("unknown");
    expect(detectPageState(load("x", "/in/x/", "").doc)).toBe("unknown");
  });

  it("a checkpoint wins over a signed-in shell, and a signed-in shell without a main column is unknown", () => {
    expect(detectPageState(load("checkpoint").doc)).toBe("checkpoint");
    expect(detectPageState(load("x", "/in/x/", `<header id="global-nav"></header><div>loading</div>`).doc)).toBe("unknown");
  });

  it("maps states to stop reasons", () => {
    expect(stopReasonFor("unknown")).toBe("unknown_page");
    expect(stopReasonFor("checkpoint")).toBe("checkpoint");
    expect(stopReasonFor("logged_out")).toBe("logged_out");
  });
});
