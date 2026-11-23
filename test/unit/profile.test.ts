import { describe, expect, it } from "vitest";
import { expandProfile, readProfile } from "../../src/reader/profile";
import { context, load } from "../helpers/fixture";

describe("profile", () => {
  it("reads the main page as labelled sections, with name and headline", () => {
    const page = load("profile");
    const ctx = context(page.doc);
    expandProfile(ctx, "profile");
    const out = readProfile(ctx, "profile")!;
    expect(out.read).toBe("ok");
    expect(out.content.name).toBe("Synthetic Person One");
    expect(out.content.headline).toBe("Head of Placeholder Operations at Example Fabrication Co");
    expect(out.content.sections.map((s) => s.label)).toEqual(["About", "Experience", "Education", "Skills"]);
    const about = out.content.sections[0]!.text;
    expect(about).toBe("I build placeholder widgets for imaginary factories. In my spare time I write invented sentences for test fixtures, قيد الاختبار, and count emoji 🙂.");
    expect(out.content.truncated).toEqual([]);
    // Only the inline expand control was pressed; never Connect, Message, Follow, More or Endorse.
    expect(page.clicks.map((el) => el.textContent)).toEqual(["…see more"]);
  });

  it("skips the contact section and never reads the contact link", () => {
    const page = load("profile");
    const out = readProfile(context(page.doc), "profile")!;
    expect(JSON.stringify(out.content)).not.toContain("THIS-MUST-NEVER-BE-READ");
    expect(out.content.sections.some((s) => /contact/i.test(s.label))).toBe(false);
  });

  it("records the labels still cut short when nothing may be expanded", () => {
    const page = load("profile");
    const ctx = context(page.doc, { clicksEnabled: false });
    expandProfile(ctx, "profile");
    const out = readProfile(ctx, "profile")!;
    expect(page.clicks).toHaveLength(0);
    expect(out.content.truncated).toEqual(["About"]);
    expect(out.content.sections[0]!.text).toBe("I build placeholder widgets for imaginary factories.");
  });

  it("reads the experience and skills detail pages as one section each", () => {
    const exp = load("details-experience", "/in/synthetic-person-one/details/experience/");
    const ctx = context(exp.doc);
    expandProfile(ctx, "experience");
    const experience = readProfile(ctx, "experience")!;
    expect(experience.content.name).toBeNull();
    expect(experience.content.sections).toHaveLength(1);
    expect(experience.content.sections[0]!.label).toBe("Experience");
    expect(experience.content.sections[0]!.text).toContain("Leads a team of nine invented people");
    expect(experience.content.sections[0]!.text).toContain("Made-up Society");

    const skills = readProfile(context(load("details-skills", "/in/synthetic-person-one/details/skills/").doc), "skills")!;
    expect(skills.content.sections).toEqual([{ label: "Skills", text: "Placeholder planning\nImaginary logistics\nFixture design\nSynthetic data" }]);
  });

  it("an empty profile and an empty detail page read as empty", () => {
    const empty = readProfile(context(load("profile-empty", "/in/synthetic-person-two/").doc), "profile")!;
    expect(empty.read).toBe("empty");
    expect(empty.content).toEqual({ name: "Synthetic Person Two", headline: null, sections: [], truncated: [] });
    const detail = readProfile(context(load("details-empty", "/in/synthetic-person-two/details/skills/").doc), "skills")!;
    expect(detail.read).toBe("empty");
    expect(detail.content.sections).toEqual([]);
  });

  it("cuts a section at 8,000 characters and names it in truncated", () => {
    const page = load("profile");
    page.doc.querySelector("#education")!.parentElement!.querySelector("li div")!.textContent = "x".repeat(9000);
    const out = readProfile(context(page.doc), "profile")!;
    const education = out.content.sections.find((s) => s.label === "Education")!;
    expect(education.text.length).toBe(8000);
    expect(out.content.truncated).toContain("Education");
    expect(out.cut).toBe(true);
  });

  it("with the section selectors gone, degrades to one section for the whole page", () => {
    const page = load("details-skills", "/in/synthetic-person-one/details/skills/");
    page.doc.querySelector(".pvs-list__container")!.className = "renamed";
    page.doc.querySelector(".pvs-list")!.className = "renamed";
    const out = readProfile(context(page.doc), "skills")!;
    expect(out.read).toBe("degraded");
    expect(out.content.sections).toHaveLength(1);
    expect(out.content.sections[0]!.label).toBe("Skills");
    expect(out.content.truncated).toEqual(["Skills"]);
  });
});
