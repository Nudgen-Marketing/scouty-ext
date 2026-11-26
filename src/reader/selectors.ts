// THE ONLY FILE WITH LINKEDIN SELECTORS, CLASS NAMES, SCREEN NAMES, PAGE PATHS AND PAGE WORDING.
//
// Version 2 follows LinkedIn's server-driven UI ("SDUI"), surveyed on live pages on 2026-11-24
// (docs/DEVIATIONS.md, "LinkedIn SDUI markup"). Its class names are generated atomic classes with
// no meaning, so nothing here uses a class: only `main#workspace`, the `data-sdui-screen` name of
// the page, roles, `data-testid`, `data-component-type`, `componentkey`, element ids, link targets
// and a few interface labels. The legacy selectors kept below only ever STOP a read (checkpoint,
// sign-in form, unavailable profile, LinkedIn's own empty state, the signed-out public profile);
// none of them can make a page "ok". When LinkedIn's markup changes, change this file only and
// bump SELECTORS_VERSION.

import type { SectionName } from "../protocol";

export const SELECTORS_VERSION = 3;

/** The page of each section, below /in/<slug>/. */
export const sectionPaths: Record<SectionName, string> = {
  profile: "",
  experience: "details/experience/",
  skills: "details/skills/",
  posts: "recent-activity/all/",
  comments: "recent-activity/comments/",
  reactions: "recent-activity/reactions/",
};

/** The `data-sdui-screen` value LinkedIn gives the page of each section. Any other screen is "unknown". */
export const sduiScreens: Record<SectionName, string> = {
  profile: "com.linkedin.sdui.flagshipnav.profile.Profile",
  experience: "com.linkedin.sdui.flagshipnav.profile.ProfileExperienceDetails",
  skills: "com.linkedin.sdui.flagshipnav.profile.ProfileSkillDetails",
  posts: "com.linkedin.sdui.flagshipnav.profile.ProfileRecentActivityAll",
  comments: "com.linkedin.sdui.flagshipnav.profile.ProfileRecentActivityComments",
  reactions: "com.linkedin.sdui.flagshipnav.profile.ProfileRecentActivityReactions",
};

/** Address paths LinkedIn sends a signed-out visitor or a security check to. Matched as path prefixes. */
export const statePaths = {
  loggedOut: ["/uas/login", "/authwall", "/login"],
  checkpoint: ["/checkpoint/"],
} as const;

const TEXT_BOX = "[data-testid='expandable-text-box']";
const ACTIVITY_LIST = "main#workspace [role='list'][data-component-type='LazyColumn']";

export const selectors = {
  pageState: {
    /** The signed-in application's only main column. */
    workspace: ["main#workspace"],
    /** The element naming the page; its value must be the screen of the section being read. */
    screen: "data-sdui-screen",
    // Legacy, stop-only.
    loggedOut: [".authwall-join-form", "form.login__form", "[data-test-id='authwall']", ".join-form"],
    checkpoint: ["#captcha-internal", "form[action*='/checkpoint/']", ".challenge-dialog", "[data-test-id='challenge']"],
    notFound: [".not-found__header", ".profile-unavailable", "[data-test-id='profile-unavailable']", ".error-container--404"],
    reducedProfile: [".public-profile", "main.core-rail", ".top-card-layout"],
  },
  mainColumn: ["main#workspace"],
  activity: {
    /** One activity item. Only items of the activity list are blocks. */
    block: [`${ACTIVITY_LIST} [role='listitem']`],
    list: [ACTIVITY_LIST],
    /** Shown while LinkedIn loads more items as the page scrolls. */
    loader: ["main#workspace [data-testid='loader']"],
    /** Links that carry the URN of a post: `/feed/update/<urn>/` and, on one's own posts, `/analytics/post-summary/<urn>/`. */
    urnLink: ["a[href]"],
    // Legacy, never seen on the SDUI pages.
    emptyState: [".artdeco-empty-state", ".pv-recent-activity-empty"],
  },
  /** Where the readable text of a post or a profile entry lives; the expand control must be inside one. */
  textContainer: [TEXT_BOX],
  /** The ONLY expand control: LinkedIn marks it aria-hidden="true"; interactions.ts allows exactly this one despite that. */
  expandText: ["button[data-testid='expandable-text-button']"],
  /**
   * Places an expand control may be in (besides being inside a text box): an activity item, a detail
   * page, or (expandSection) a profile section whose h2 is one of profileSectionLabels.
   */
  expandScope: [
    `${ACTIVITY_LIST} [role='listitem']`,
    "main#workspace [data-testid^='profile_ExperienceDetailsSection_']",
    "main#workspace [data-testid^='profile_SkillDetails_']",
  ],
  expandSection: "main#workspace section",
  // Legacy "Show more results"; the SDUI pages scroll endlessly instead. Never inside an item.
  loadMore: ["button.scaffold-finite-scroll__load-button", "button.artdeco-pagination__load-more"],
  /** Containers whose content is never read and inside which nothing is ever clicked. Legacy classes only. */
  actionBar: [
    ".feed-shared-social-action-bar", ".social-actions", ".social-details-social-counts", ".comments-comment-social-bar",
    ".feed-shared-control-menu", ".pvs-profile-actions", ".pv-top-card-v2-ctas", ".update-components-actor__follow-button",
  ],
  /** Attributes that mark a control as an action (reacting, following, messaging, …). */
  actionControlAttributes: ["data-reaction-details", "data-follow-state", "data-entity-action", "data-connect", "data-message-entry-point"],
  /**
   * Action controls by their accessible name or text (there are no action-bar classes to scope by).
   * Never clicked, never read. Matched against the trimmed aria-label and the trimmed text, ignoring case.
   */
  actionControlNames: [
    /^open reactions menu/, /^reaction button state/, /^react\b/, /^like\b/, /^comment\b/, /^repost\b/, /^send\b/,
    /^open control menu/, /^follow\b/, /^connect\b/, /^message\b/, /^more actions\b/,
    /^go to (next|previous) page/, /^page \d+ of \d+$/,
    /^navigate back to profile main screen/, /^add a position or career break/, /^ad options\b/, /^don['’]t want to see this/,
  ],
  /** The same controls as CSS, for skipping their subtrees when reading text. Buttons are skipped anyway. */
  actionControlSkip: [
    "button", "[role='button']", "[role='tablist']", "[role='tab']", "[role='menu']", "[role='toolbar']",
    "[aria-label^='Open reactions menu']", "[aria-label^='Reaction button state']", "[aria-label^='Open control menu']",
    "[aria-label^='Follow']", "[aria-label='Comment']", "[aria-label='Repost']", "[aria-label='Send']",
    "[aria-label^='Go to next page']", "[aria-label^='Go to previous page']",
  ],
  /** Lines that are page furniture, not content. */
  noiseLines: [/^feed post$/i, /^page \d+ of \d+$/i, /^…\s*more$/i, /^\.\.\.\s*more$/i],
  /**
   * The item header line that tells what the lead did ("<name> reposted this", "<name> likes this",
   * "<name> liked a comment on this", "<name> commented on this"). English only: the Vietnamese wording
   * is unverified. The line is kept in the block text as the classification hint.
   */
  kindHint: [
    /\b(reposted|commented on|replied to|is curious about) this$/i,
    /\b(likes|liked|loves|loved|celebrates|celebrated|supports|supported|finds|found) (this|a comment on this|a reply on this)\b/i,
  ],
  /** A relative date at the start of a line: "1w •", "2w •", "1mo •", "3d •", "5h •", "1w • Edited •". */
  dateLabel: /^(\d{1,3}\s?(?:s|m|h|d|w|mo|yr|y|giây|phút|giờ|ngày|tuần|tháng|năm))(?=\s|•|$)\s*•/,
  /** Text repeated for screen readers next to its visible twin. */
  hiddenDuplicate: [".visually-hidden", ".a11y-text", ".sr-only"],
  profile: {
    /** The top card: an element whose id starts with this prefix and ends with "Topcard". */
    topCardIdPrefix: "com.linkedin.sdui.profile.card.",
    topCardIdSuffix: "Topcard",
    nameHeading: ["h1", "h2"],
    section: ["main#workspace section"],
    sectionHeading: ["h2"],
    /** Roots of the two detail pages. */
    detailRoot: {
      experience: ["main#workspace [data-testid^='profile_ExperienceDetailsSection_']"],
      skills: ["main#workspace [data-testid^='profile_SkillDetails_']"],
    } as Partial<Record<SectionName, readonly string[]>>,
    /** An entry: the outermost list item or componentkey element holding text. */
    detailItem: ["[role='listitem'], li, [componentkey]"],
    /** What an entry's text is made of on a detail page. */
    detailText: ["p", TEXT_BOX],
    emptyState: [".artdeco-empty-state"],
  },
  /**
   * The profile's own sections, by their lower-cased h2 text. Every other section (owner-only
   * Analytics, Suggested for you, Profile language, Public profile & URL, People you may know,
   * You might like, Who your viewers also viewed, ads, Activity, …) is skipped, and so is a section
   * without an h2. Vietnamese labels only where the wording is known.
   */
  profileSectionLabels: [
    "about", "experience", "education", "skills", "licenses & certifications", "languages", "recommendations",
    "featured", "volunteering", "volunteer experience", "projects", "honors & awards", "courses",
    "giới thiệu", "kinh nghiệm", "học vấn", "kỹ năng", "giấy phép & chứng chỉ", "ngôn ngữ", "dự án", "khóa học",
  ],
  /** The contact section is never read. Compared with the lower-cased section label. */
  contactSectionLabels: ["contact info", "contact information", "contact", "thông tin liên hệ"],
} as const;

/** First non-empty match list among the alternatives, in document order. */
export function queryAll(root: ParentNode, alternatives: readonly string[]): Element[] {
  for (const selector of alternatives) {
    const found = Array.from(root.querySelectorAll(selector));
    if (found.length) return found;
  }
  return [];
}

export function queryFirst(root: ParentNode, alternatives: readonly string[]): Element | null {
  for (const selector of alternatives) {
    const found = root.querySelector(selector);
    if (found) return found;
  }
  return null;
}

export function matchesAny(el: Element, alternatives: readonly string[]): boolean {
  return alternatives.some((selector) => el.matches(selector));
}

export function closestAny(el: Element, alternatives: readonly string[]): Element | null {
  for (const selector of alternatives) {
    const found = el.closest(selector);
    if (found) return found;
  }
  return null;
}

const normalLabel = (label: string): string => label.toLowerCase().replace(/\s+/g, " ").replace(/\band\b/g, "&").trim();

export function isContactLabel(label: string): boolean {
  return (selectors.contactSectionLabels as readonly string[]).includes(normalLabel(label));
}

/** Only the profile's own sections are read (and expanded). */
export function isProfileSectionLabel(label: string): boolean {
  if (isContactLabel(label)) return false;
  return (selectors.profileSectionLabels as readonly string[]).includes(normalLabel(label));
}

/** True when the element's aria-label or its text names an action control. */
export function isActionControl(el: Element): boolean {
  const names = [el.getAttribute("aria-label") ?? "", el.textContent ?? ""].map((s) => s.replace(/\s+/g, " ").trim().toLowerCase());
  return names.some((name) => name !== "" && selectors.actionControlNames.some((pattern) => pattern.test(name)));
}
