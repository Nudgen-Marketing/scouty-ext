// viewFor(state): the view model of every screen (plan 12.4). Pure and framework-free: the popup
// (React) and the in-page overlay (plain DOM) are thin renderers of what this returns.
// Every string comes from messages.json through t(); a test fails on a sentence written here.
// Copy rule (owner feedback 2026-11-24): one short title, at most one short sentence, one clear
// primary action, no technical words.
import type { UiAction } from "../messages";
import type { Counts, SectionName } from "../protocol";
import { t } from "./i18n";
import type { IconName } from "./icons";
import { UI_KINDS, type SectionLine, type UiKind, type UiState } from "./state";

export type ButtonVariant = "primary" | "outline" | "ghost" | "link";
export type ViewAction = { id: UiAction; label: string; variant: ButtonVariant; icon: IconName | null; disabled?: boolean };

export type View = {
  /** 1 to 27: the row of plan 12.4 (1 to 24), 25 for "takenOver", 26 for "notAnswering", 27 for "expired". */
  n: number;
  kind: UiKind;
  /** "alert" for errors (role="alert"), "status" otherwise (a polite live region). */
  tone: "status" | "alert";
  icon: IconName | null;
  title: string;
  /** At most one short sentence. */
  body: string[];
  bullets: string[];
  /** text: the count beside the bar ("23 of 50"), empty when there is none; valueText: the fuller screen-reader value. */
  progress: { value: number; max: number; text: string; valueText: string; indeterminate: boolean } | null;
  estimate: string | null;
  details: { label: string; value: string }[];
  /** True while something is happening without a number to show (spinner, or a "Working…" label under reduced motion). */
  working: boolean;
  primary: ViewAction | null;
  secondary: ViewAction | null;
  links: ViewAction[];
  /** Why the disabled action cannot be used yet and what to do; shown next to the actions. */
  hint: string | null;
  footer: string | null;
  workspace: string | null;
  showSettings: boolean;
};

const READING: Record<SectionName, string> = {
  profile: "readingProfile", experience: "readingExperience", skills: "readingSkills",
  posts: "readingPosts", comments: "readingComments", reactions: "readingReactions",
};
const PROGRESS_VALUE: Partial<Record<SectionName, string>> = {
  posts: "progressValuePosts", comments: "progressValueComments", reactions: "progressValueReactions",
};
const DAY_MS = 86_400_000;

const action = (id: UiAction, key: string, variant: ButtonVariant = "primary", icon: IconName | null = null): ViewAction =>
  ({ id, label: t(key), variant, icon });

const plural = (count: number, one: string, many: string): string => (count === 1 ? t(one) : t(many, count));

/** "Profile · 19 posts · 20 comments · 20 reactions". */
function countsLine(counts: Counts): string {
  const parts: string[] = [];
  if (counts.profileSections > 0) parts.push(t("countProfile"));
  parts.push(plural(counts.posts, "countPostsOne", "countPosts"));
  parts.push(plural(counts.comments, "countCommentsOne", "countComments"));
  parts.push(plural(counts.reactions, "countReactionsOne", "countReactions"));
  return parts.join(" · ");
}

/** The counts of what a partial capture did read; sections not read are left out. */
function partialCountsLine(sections: SectionLine[]): string {
  const read = (line: SectionLine): boolean => line.state === "complete" || line.state === "partial";
  const parts: string[] = [];
  if (sections.some((line) => line.section === "profile" && read(line))) parts.push(t("countProfile"));
  const KEYS = { posts: ["countPostsOne", "countPosts"], comments: ["countCommentsOne", "countComments"], reactions: ["countReactionsOne", "countReactions"] } as const;
  for (const [section, [one, many]] of Object.entries(KEYS)) {
    const line = sections.find((l) => l.section === section);
    if (line && read(line)) parts.push(plural(line.count ?? 0, one, many));
  }
  return parts.join(" · ");
}

/** The one short line that says why a capture is partial. */
function partialReason(sections: SectionLine[], notExpanded: boolean): string {
  const gaps = sections.filter((line) => line.state === "skipped" || line.state === "partial");
  if (gaps.some((line) => line.reason === "user_stopped")) return t("partialStopped");
  if (gaps.some((line) => line.reason === "signed_out_of_scouty")) return t("partialSignedOut");
  if (gaps.length === 0 && notExpanded) return t("partialShortened");
  return t("partialMissing");
}

function recentTitle(finalizedAt: string, now: string): string {
  const days = Math.max(0, Math.floor((Date.parse(now) - Date.parse(finalizedAt)) / DAY_MS));
  if (days === 0) return t("recentTitleToday");
  if (days === 1) return t("recentTitleYesterday");
  return t("recentTitleDays", days);
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

type Draft = Partial<View> & { title: string };

function draft(state: UiState): Draft {
  switch (state.kind) {
    case "permission":
      return { title: t("permissionTitle"), body: [t("permissionBody")], primary: action("allow", "actionAllow"), secondary: action("whatItReads", "actionWhatScoutyReads", "link", "external") };
    case "signedOut":
      return {
        title: t("signedOutTitle"), body: [t("signedOutBody")], primary: action("connect", "actionConnect"),
      };
    case "connecting":
      return { title: t("connectingTitle"), body: [t("connectingBody")], working: true, secondary: action("cancelConnect", "actionCancel", "outline") };
    case "notOnProfile":
      return { title: t("notOnProfileTitle"), body: [t("notOnProfileBody")], primary: action("openScouty", "actionOpenScouty", "primary", "external") };
    case "consent":
      return {
        title: t("consentTitle"), bullets: [t("consentPoint1"), t("consentPoint2"), t("consentPoint3")],
        primary: action("acceptConsent", "actionAcceptConsent"), secondary: action("cancel", "actionCancel", "outline"),
      };
    case "ready":
      return {
        title: t("readyTitle"), primary: action("capture", "actionCapture"),
        footer: state.capturesLeft === null ? null : plural(state.capturesLeft, "capturesLeftOne", "capturesLeft"),
      };
    case "recent":
      return {
        title: recentTitle(state.finalizedAt, state.now), body: [t("recentBody")],
        primary: action("openAnalysis", "actionOpenInScouty", "primary", "external"), secondary: action("captureAgain", "actionCaptureAgain", "outline"),
      };
    case "capturing": {
      const counted = state.cap > 0;
      const valueKey = PROGRESS_VALUE[state.section];
      const text = state.loading ? t("progressLoading") : counted ? t("progressCount", state.count, state.cap) : "";
      const title = t(READING[state.section]);
      return {
        // The one place the trust message is shown: while Scouty is on the page.
        title, body: [t("readingTrust")],
        progress: {
          value: counted ? Math.min(state.count, state.cap) : 0, max: counted ? state.cap : 1, text,
          valueText: counted && valueKey && !state.loading ? t(valueKey, state.count, state.cap) : text || title,
          indeterminate: state.loading || !counted,
        },
        estimate: state.minutesLeft <= 1 ? t("estimateOne") : t("estimateMany", state.minutesLeft),
        primary: action("stop", "actionStop", "primary", "x"),
      };
    }
    case "sending":
      return { title: t("sendingTitle"), body: [state.slow ? t("sendingSlow") : t("sendingBody")], working: true };
    case "doneComplete":
      return {
        title: t("doneTitle"), icon: "check", body: [countsLine(state.counts)],
        primary: action("openAnalysis", "actionOpenInScouty", "primary", "external"), secondary: action("dismiss", "actionClose", "outline"),
      };
    case "donePartial": {
      const counts = partialCountsLine(state.sections);
      return {
        // The counts line, then one short line on what is missing.
        title: t("partialTitle"), body: counts ? [counts, partialReason(state.sections, state.notExpanded)] : [partialReason(state.sections, state.notExpanded)],
        primary: action("openAnalysis", "actionOpenInScouty", "primary", "external"), secondary: action("captureAgain", "actionCaptureAgain", "outline"),
      };
    }
    case "linkedinSignIn":
      return { tone: "alert", icon: "alert", title: t("linkedinSignInTitle"), body: [t("linkedinSignInBody")], primary: action("captureAgain", "actionTryAgain") };
    case "verification":
      return { tone: "alert", icon: "alert", title: t("verificationTitle"), body: [t("verificationBody")], primary: action("dismiss", "actionOk") };
    case "unavailable":
      return { tone: "alert", icon: "alert", title: t("unavailableTitle"), body: [t("unavailableBody")], primary: action("dismiss", "actionOk") };
    case "addressChanged":
      return { tone: "alert", icon: "alert", title: t("addressChangedTitle"), body: [t("addressChangedBody")], primary: action("capture", "actionCaptureThisPage") };
    case "offline":
      return { tone: "alert", icon: "alert", title: t("offlineTitle"), body: [t("offlineBody")], primary: action("retryNow", "actionTryNow") };
    case "notAnswering":
      if (!state.sending) {
        // The capture could not be started: nothing is kept, so Try now starts it again.
        return {
          tone: "alert", icon: "alert", title: t("notAnsweringTitle"),
          body: [state.retryAt ? t("notAnsweringStartRetryAt", clockTime(state.retryAt)) : t("notAnsweringStartBody")],
          primary: action("capture", "actionTryNow"),
        };
      }
      return {
        tone: "alert", icon: "alert", title: t("notAnsweringTitle"),
        body: [state.retryAt ? t("notAnsweringRetryAt", clockTime(state.retryAt)) : t("notAnsweringBody")],
        primary: action("retryNow", "actionTryNow"),
      };
    case "connectionEnded":
      return { tone: "alert", icon: "alert", title: t("connectionEndedTitle"), body: [t("connectionEndedBody")], primary: action("connect", "actionConnect") };
    case "limit":
      return {
        tone: "alert", icon: "alert", title: t("limitTitle"), body: [state.resetAt ? t("limitBody", clockTime(state.resetAt)) : t("limitBodyLater")],
        primary: action("openScouty", "actionOpenScouty", "primary", "external"),
      };
    case "outdated":
      return { tone: "alert", icon: "alert", title: t("outdatedTitle"), body: [t("outdatedBody")], primary: action("openStore", "actionOpenStore", "primary", "external") };
    case "notAvailable":
      return { tone: "alert", icon: "alert", title: t("notAvailableTitle"), body: [t("notAvailableBody")], primary: action("openScouty", "actionOpenScouty", "primary", "external") };
    case "suppressed":
      return { tone: "alert", icon: "alert", title: t("suppressedTitle"), body: [t("suppressedBody")], primary: action("dismiss", "actionOk") };
    case "failed":
      return { tone: "alert", icon: "alert", title: t("failedTitle"), body: [t("failedBody")], primary: action("captureAgain", "actionTryAgain") };
    case "busy":
      return { tone: "alert", icon: "alert", title: t("busyTitle"), body: [t("busyBody")], primary: action("showCapture", "actionShowIt") };
    case "settings":
      return {
        title: t("settingsTitle"),
        details: [
          { label: t("settingsAccount"), value: [state.name, state.email].filter(Boolean).join(" · ") },
          { label: t("settingsWorkspace"), value: state.workspace },
          { label: t("settingsVersion"), value: state.version },
        ],
        links: [action("switchWorkspace", "actionSwitchWorkspace", "link"), action("whatItReads", "actionWhatScoutyReads", "link", "external")],
        secondary: action("disconnect", "actionDisconnect", "outline"),
      };
    case "takenOver":
      return {
        tone: "alert", icon: "alert", title: t("takenOverTitle"), body: [t("takenOverBody")],
        primary: action("dismiss", "actionOk"), secondary: action("captureAgain", "actionCaptureHere", "outline"),
      };
    case "expired":
      // Capture starts a new capture of the profile in the tab the popup is on, as Capture here does on 25.
      return {
        tone: "alert", icon: "alert", title: t("expiredTitle"), body: [t("expiredBody")],
        primary: action("captureAgain", "actionCapture"), secondary: action("dismiss", "actionOk", "outline"),
      };
  }
}

/** The actions that start a capture in the tab the popup (or the overlay) is on. */
const CAPTURE_ACTIONS: readonly UiAction[] = ["capture", "captureAgain"];

/** Off a profile, a capture action could not start: it is shown disabled, with what to do instead. */
function blockCapture(d: Draft): Draft {
  const blocked = (a: ViewAction | null | undefined): ViewAction | null | undefined => (a && CAPTURE_ACTIONS.includes(a.id) ? { ...a, disabled: true } : a);
  const primary = blocked(d.primary);
  const secondary = blocked(d.secondary);
  if (primary === d.primary && secondary === d.secondary) return d;
  return { ...d, primary, secondary, hint: t("captureNeedsProfile") };
}

export function viewFor(state: UiState): View {
  const d = state.onProfile === false ? blockCapture(draft(state)) : draft(state);
  const workspace = "workspace" in state && state.workspace ? state.workspace : null;
  return {
    n: UI_KINDS.indexOf(state.kind) + 1,
    kind: state.kind,
    tone: d.tone ?? "status",
    icon: d.icon ?? null,
    title: d.title,
    body: d.body ?? [],
    bullets: d.bullets ?? [],
    progress: d.progress ?? null,
    estimate: d.estimate ?? null,
    details: d.details ?? [],
    working: d.working ?? false,
    primary: d.primary ?? null,
    secondary: d.secondary ?? null,
    links: d.links ?? [],
    hint: d.hint ?? null,
    footer: d.footer ?? null,
    workspace,
    showSettings: workspace !== null && state.kind !== "settings",
  };
}
