// THE ONLY FILE WITH LINKEDIN SELECTORS, CLASS NAMES AND PAGE PATHS.
//
// Everything here is a BEST GUESS written without access to a LinkedIn session. It is confirmed or
// corrected in the owner task E0 (fixtures/README.md). When LinkedIn's markup differs, change this
// file only and bump SELECTORS_VERSION. Each selector has alternatives that are tried in order.

import type { SectionName } from "../protocol";

export const SELECTORS_VERSION = 1;

/** The page of each section, below /in/<slug>/. */
export const sectionPaths: Record<SectionName, string> = {
  profile: "",
  experience: "details/experience/",
  skills: "details/skills/",
  posts: "recent-activity/all/",
  comments: "recent-activity/comments/",
  reactions: "recent-activity/reactions/",
};

export const selectors = {
  pageState: {
    /** The signed-in application shell. */
    signedInShell: ["#global-nav", "header.global-nav", ".global-nav__me"],
    /** The profile or activity main column of the signed-in application. */
    appMain: ["main.scaffold-layout__main", ".scaffold-layout main", "main[role='main']"],
    loggedOut: [".authwall-join-form", "form.login__form", "[data-test-id='authwall']", ".join-form"],
    checkpoint: ["#captcha-internal", "form[action*='/checkpoint/']", ".challenge-dialog", "[data-test-id='challenge']"],
    notFound: [".not-found__header", ".profile-unavailable", "[data-test-id='profile-unavailable']", ".error-container--404"],
    reducedProfile: [".public-profile", "main.core-rail", ".top-card-layout"],
  },
  mainColumn: ["main.scaffold-layout__main", "main", "[role='main']"],
  activity: {
    block: ["div.feed-shared-update-v2", "div[data-urn^='urn:li:activity:']", "li.profile-creator-shared-feed-update__container"],
    urnAttributes: ["data-urn", "data-id", "data-activity-urn"],
    time: ["time[datetime]"],
    emptyState: [".artdeco-empty-state", ".pv-recent-activity-empty"],
  },
  /** Where the readable text of a post or a profile section lives; expand controls must be inside one. */
  textContainer: [
    ".update-components-text", ".feed-shared-inline-show-more-text", ".inline-show-more-text",
    ".pv-shared-text-with-see-more", ".comments-comment-item__main-content",
  ],
  /** Rows of social or profile actions. Nothing inside one is ever clicked, and their text is not read. */
  actionBar: [
    ".feed-shared-social-action-bar", ".social-actions", ".social-details-social-counts", ".comments-comment-social-bar",
    ".feed-shared-control-menu", ".pvs-profile-actions", ".pv-top-card-v2-ctas", ".update-components-actor__follow-button",
  ],
  expandText: [
    "button.feed-shared-inline-show-more-text__see-more-less-toggle",
    "button.inline-show-more-text__button",
    "button.see-more",
  ],
  loadMore: ["button.scaffold-finite-scroll__load-button", "button.artdeco-pagination__load-more"],
  /** Attributes that mark a control as an action (reacting, following, messaging, …). */
  actionControlAttributes: ["data-reaction-details", "data-follow-state", "data-entity-action", "data-connect", "data-message-entry-point"],
  /** Text repeated for screen readers next to its visible twin. */
  hiddenDuplicate: [".visually-hidden", ".a11y-text", ".sr-only"],
  profile: {
    name: ["main h1", ".text-heading-xlarge"],
    headline: [".pv-text-details__left-panel .text-body-medium", "main .text-body-medium.break-words"],
    section: ["main section.artdeco-card", "main section[data-view-name='profile-card']", "main section"],
    sectionHeading: [".pvs-header__title", "h2"],
    detailHeading: ["main h1", "main h2"],
    detailList: ["main .pvs-list__container", "main .scaffold-finite-scroll__content", "main ul.pvs-list"],
    emptyState: [".artdeco-empty-state"],
  },
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
