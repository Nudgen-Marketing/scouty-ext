import { describe, expect, it } from "vitest";
import { expandProfile, readProfile, topCard } from "../../src/reader/profile";
import { isContactLabel, isProfileSectionLabel } from "../../src/reader/selectors";
import { context, load, PATHS } from "../helpers/fixture";

const NEVER = /OWNER-ONLY|STRANGER|AD-TEXT|NO-HEADING|PROFILE-ACTIVITY-SNIPPET|THIS-MUST-NEVER-BE-READ|Contact info|Don't want to see this|Endorse|Connect|Message|More actions/;

describe("profile (SDUI)", () => {
  it("reads the top card and the profile's own sections only", () => {
    const page = load("sdui-profile");
    const ctx = context(page.doc);
    expandProfile(ctx, "profile");
    const out = readProfile(ctx, "profile")!;
    expect(out.read).toBe("ok");
    expect(out.content.name).toBe("Synthetic Person One");
    // The pronoun line after the name is passed over; the headline is the next line.
    expect(out.content.headline).toBe("Head of Placeholder Operations at Example Fabrication Co");
    expect(out.content.sections.map((s) => s.label)).toEqual(["About", "Experience", "Education", "Skills", "Licenses & certifications", "Languages"]);
    expect(out.content.sections[0]!.text).toBe("I build placeholder widgets for imaginary factories. In my spare time I write invented sentences for test fixtures, قيد الاختبار, and count emoji 🙂.");
    expect(out.content.sections[3]!.text).toBe("Placeholder planning\nImaginary logistics");
    expect(out.content.truncated).toEqual([]);
    // Only the About expand control was pressed; never Connect, Message, More, Endorse or the ad's control.
    expect(page.clicks.map((el) => el.getAttribute("data-testid"))).toEqual(["expandable-text-button"]);
  });

  it("skips owner-only, recommendation, ad and heading-less sections, the Activity teaser, and never reads contact info", () => {
    const out = readProfile(context(load("sdui-profile").doc), "profile")!;
    const json = JSON.stringify(out.content);
    expect(json).not.toMatch(NEVER);
    expect(out.content.sections.some((s) => /contact|analytics|suggested|people you may know|ad options|activity/i.test(s.label))).toBe(false);
  });

  it("the section allow-list", () => {
    for (const label of ["About", "Experience", "Education", "Skills", "Licenses & certifications", "Licenses and certifications", "Languages", "Recommendations", "Featured", "Volunteering", "Projects", "Honors & awards", "Courses", "Giới thiệu", "Kinh nghiệm", "Học vấn", "Kỹ năng"]) {
      expect(isProfileSectionLabel(label), label).toBe(true);
    }
    for (const label of ["Analytics", "Suggested for you", "Profile language", "Public profile & URL", "People you may know", "You might like", "Ad Options", "Don't want to see this", "Who your viewers also viewed", "Activity", "Contact info", "Thông tin liên hệ", ""]) {
      expect(isProfileSectionLabel(label), label).toBe(false);
    }
    expect(isContactLabel("Contact info")).toBe(true);
  });

  it("the top card is found by its id, on the element itself or inside the section", () => {
    const page = load("sdui-profile");
    expect(topCard(page.doc)!.getAttribute("componentkey")).toBe("synthetic-topcard");
    const marker = page.doc.querySelector("[id$='Topcard']")!;
    marker.id = "com.linkedin.sdui.profile.card.somethingElse";
    expect(topCard(page.doc)).toBeNull();
    const out = readProfile(context(page.doc), "profile")!;
    expect(out.content.name).toBeNull();
    // Without the top card the name heading is just another section: not on the allow-list, not read.
    expect(JSON.stringify(out.content)).not.toContain("Synthetic Person One");
  });

  it("records the labels still cut short when nothing may be expanded", () => {
    const page = load("sdui-profile");
    const ctx = context(page.doc, { clicksEnabled: false });
    expandProfile(ctx, "profile");
    const out = readProfile(ctx, "profile")!;
    expect(page.clicks).toHaveLength(0);
    expect(out.content.truncated).toEqual(["About"]);
    expect(out.content.sections[0]!.text).toBe("I build placeholder widgets for imaginary factories.");
  });

  it("reads the experience detail page as entries, with the description expanded", () => {
    const page = load("sdui-details-experience", PATHS.experience);
    const ctx = context(page.doc);
    expandProfile(ctx, "experience");
    const out = readProfile(ctx, "experience")!;
    expect(out.read).toBe("ok");
    expect(out.content.name).toBeNull();
    expect(out.content.sections).toHaveLength(1);
    expect(out.content.sections[0]!.label).toBe("Experience");
    const entries = out.content.sections[0]!.text.split("\n\n");
    expect(entries).toHaveLength(5);
    expect(entries[0]).toBe("Head of Placeholder Operations\nExample Fabrication Co · Full-time\nJan 2021 - Present\nRuns the imaginary assembly line. Leads a team of nine invented people across two fictional sites.");
    expect(entries[4]).toBe("Volunteer\nMade-up Society\n2013");
    expect(out.content.sections[0]!.text).not.toMatch(/AD-TEXT|Navigate back|Add a position|… more/);
    expect(page.clicks.map((el) => el.getAttribute("data-testid"))).toEqual(["expandable-text-button"]);
  });

  it("reads the skills detail page without the filter tabs", () => {
    const page = load("sdui-details-skills", PATHS.skills);
    const ctx = context(page.doc);
    expandProfile(ctx, "skills");
    const out = readProfile(ctx, "skills")!;
    expect(out.content.sections).toEqual([{ label: "Skills", text: "Placeholder planning\nEndorsed by 3 invented colleagues\n\nImaginary logistics\n\nFixture design\n\nSynthetic data" }]);
    expect(page.clicks).toHaveLength(0);
  });

  it("an empty profile and an empty detail page read as empty", () => {
    const empty = readProfile(context(load("sdui-profile-empty", "/in/synthetic-person-two/").doc), "profile")!;
    expect(empty.read).toBe("empty");
    expect(empty.content).toEqual({ name: "Synthetic Person Two", headline: null, sections: [], truncated: [] });
    const detail = readProfile(context(load("sdui-details-empty", "/in/synthetic-person-two/details/skills/").doc), "skills")!;
    expect(detail.read).toBe("empty");
    expect(detail.content.sections).toEqual([]);
  });

  it("cuts a section at 8,000 characters and names it in truncated", () => {
    const page = load("sdui-profile");
    page.doc.querySelector("[componentkey='synthetic-edu-1'] p")!.textContent = "x".repeat(9000);
    const out = readProfile(context(page.doc), "profile")!;
    const education = out.content.sections.find((s) => s.label === "Education")!;
    expect(education.text.length).toBe(8000);
    expect(out.content.truncated).toContain("Education");
    expect(out.cut).toBe(true);
  });

  it("with the detail root gone, degrades to one section for the whole page", () => {
    const page = load("sdui-details-skills", PATHS.skills);
    page.doc.querySelector("[data-testid^='profile_SkillDetails_']")!.setAttribute("data-testid", "renamed");
    const out = readProfile(context(page.doc), "skills")!;
    expect(out.read).toBe("degraded");
    expect(out.content.sections).toHaveLength(1);
    expect(out.content.sections[0]!.label).toBe("Skills");
    expect(out.content.truncated).toEqual(["Skills"]);
  });
});
