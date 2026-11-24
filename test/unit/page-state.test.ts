import { describe, expect, it } from "vitest";
import { SECTION_NAMES, type SectionName } from "../../src/protocol";
import { detectPageState, pageStateFromPath, stopReasonFor } from "../../src/reader/page-state";
import { sduiScreens } from "../../src/reader/selectors";
import { fixtureHtml, load, PATHS } from "../helpers/fixture";

const FIXTURE_OF: Record<SectionName, string> = {
  profile: "sdui-profile", experience: "sdui-details-experience", skills: "sdui-details-skills",
  posts: "sdui-activity-posts", comments: "sdui-activity-comments", reactions: "sdui-activity-reactions",
};

/** A minimal SDUI page naming the given screen. */
const screenPage = (screen: string, main = `<main id="workspace"><p>x</p></main>`): string =>
  `<html lang="en"><body><div data-sdui-screen="${screen}">${main}</div></body></html>`;

describe("page-state", () => {
  it.each(SECTION_NAMES.map((section) => [section, FIXTURE_OF[section]] as const))("%s: its SDUI page is ok", (section, name) => {
    expect(detectPageState(load(name, PATHS[section]).doc, section)).toBe("ok");
  });

  it.each(SECTION_NAMES.map((section) => [section] as const))("%s: ok only on its own screen; every other screen is unknown", (section) => {
    expect(detectPageState(load("x", PATHS[section], screenPage(sduiScreens[section])).doc, section)).toBe("ok");
    for (const other of SECTION_NAMES.filter((s) => s !== section)) {
      expect(detectPageState(load("x", PATHS[section], screenPage(sduiScreens[other])).doc, section), other).toBe("unknown");
    }
    expect(detectPageState(load("x", PATHS[section], screenPage("com.linkedin.sdui.flagshipnav.feed.MainFeed")).doc, section)).toBe("unknown");
    expect(detectPageState(load("x", PATHS[section], screenPage(`${sduiScreens[section]}Extra`)).doc, section)).toBe("unknown");
  });

  it("the right screen without main#workspace, or a workspace without a screen, is unknown", () => {
    expect(detectPageState(load("x", PATHS.profile, screenPage(sduiScreens.profile, `<main><p>x</p></main>`)).doc, "profile")).toBe("unknown");
    expect(detectPageState(load("x", PATHS.profile, `<html><body><main id="workspace"><p>x</p></main></body></html>`).doc, "profile")).toBe("unknown");
  });

  it("the empty SDUI pages are ok", () => {
    expect(detectPageState(load("sdui-profile-empty", "/in/synthetic-person-two/").doc, "profile")).toBe("ok");
    expect(detectPageState(load("sdui-details-empty", "/in/synthetic-person-two/details/skills/").doc, "skills")).toBe("ok");
    expect(detectPageState(load("sdui-activity-empty", "/in/synthetic-person-two/recent-activity/all/").doc, "posts")).toBe("ok");
  });

  it.each([
    ["/uas/login", "logged_out"], ["/uas/login?session_redirect=%2Fin%2Fx%2F", "logged_out"], ["/authwall", "logged_out"],
    ["/authwall?trk=x", "logged_out"], ["/login", "logged_out"], ["/checkpoint/challenge/abc", "checkpoint"], ["/checkpoint/lg/login", "checkpoint"],
  ])("the address %s is %s, whatever the page shows", (path, state) => {
    expect(detectPageState(load("sdui-profile", path).doc, "profile")).toBe(state);
    expect(pageStateFromPath(new URL(path, "https://www.linkedin.com").pathname)).toBe(state);
  });

  it("profile addresses are not sign-in addresses", () => {
    for (const path of Object.values(PATHS)) expect(pageStateFromPath(path)).toBeNull();
    expect(pageStateFromPath("/in/login-person/")).toBeNull();
  });

  it.each([
    ["reduced-profile", "reduced_profile"], ["authwall", "logged_out"], ["checkpoint", "checkpoint"],
    ["not-found", "not_found"], ["unrelated", "unknown"],
  ])("legacy page %s → %s", (name, state) => {
    expect(detectPageState(load(name).doc, "profile")).toBe(state);
  });

  it("the legacy signed-in markup is no longer ok", () => {
    const legacy = `<html lang="en"><body><header id="global-nav"></header><main class="scaffold-layout__main" role="main"><section class="artdeco-card"><h2>About</h2></section></main></body></html>`;
    expect(detectPageState(load("x", PATHS.profile, legacy).doc, "profile")).toBe("unknown");
  });

  it("every synthetic fixture is labelled", () => {
    for (const name of ["sdui-profile", "sdui-activity-posts", "sdui-interaction-traps", "checkpoint", "unrelated"]) {
      expect(fixtureHtml(name).startsWith("<!-- SYNTHETIC: not captured from LinkedIn; structure is a best guess")).toBe(true);
    }
  });

  it("an unrecognised page is unknown, and an empty document too", () => {
    expect(detectPageState(load("x", "/in/x/", "<html><body><p>hello</p></body></html>").doc, "profile")).toBe("unknown");
    expect(detectPageState(load("x", "/in/x/", "").doc, "profile")).toBe("unknown");
  });

  it("a checkpoint marker wins over a good SDUI page", () => {
    const page = load("sdui-activity-posts", PATHS.posts);
    page.doc.body.insertAdjacentHTML("beforeend", `<div id="captcha-internal"></div>`);
    expect(detectPageState(page.doc, "posts")).toBe("checkpoint");
  });

  it("maps states to stop reasons", () => {
    expect(stopReasonFor("unknown")).toBe("unknown_page");
    expect(stopReasonFor("checkpoint")).toBe("checkpoint");
    expect(stopReasonFor("logged_out")).toBe("logged_out");
  });
});
