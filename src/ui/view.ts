// viewFor(state): the view model of every screen (plan 12.4). Pure and framework-free: the popup
// (React) and the in-page overlay (plain DOM) are thin renderers of what this returns.
// Every string comes from messages.json through t(); a test fails on a sentence written here.
import type { UiAction } from "../messages";
import type { Counts, SectionName } from "../protocol";
import { t } from "./i18n";
import type { IconName } from "./icons";
import { UI_KINDS, type SectionLine, type StepStatus, type UiKind, type UiState } from "./state";

export type ButtonVariant = "primary" | "outline" | "ghost" | "link";
export type PillTone = "good" | "active" | "waiting" | "problem" | "neutral";
export type ViewAction = { id: UiAction; label: string; variant: ButtonVariant; icon: IconName | null };

export type View = {
  /** 1 to 26: the row of plan 12.4 (1 to 24), 25 for "takenOver", 26 for "notAnswering". */
  n: number;
  kind: UiKind;
  /** "alert" for errors (role="alert"), "status" otherwise (a polite live region). */
  tone: "status" | "alert";
  icon: IconName | null;
  title: string;
  body: string[];
  bullets: string[];
  pill: { tone: PillTone; label: string } | null;
  progress: { value: number; max: number; text: string; valueText: string; indeterminate: boolean } | null;
  steps: { label: string; status: StepStatus; description: string }[];
  estimate: string | null;
  details: { label: string; value: string }[];
  /** True while something is happening without a number to show (spinner, or a "Working…" label under reduced motion). */
  working: boolean;
  primary: ViewAction | null;
  secondary: ViewAction | null;
  links: ViewAction[];
  footer: string | null;
  workspace: string | null;
  showSettings: boolean;
  notes: string[];
};

const SECTION_LABEL: Record<SectionName, string> = {
  profile: "sectionProfile", experience: "sectionExperience", skills: "sectionSkills",
  posts: "sectionPosts", comments: "sectionComments", reactions: "sectionReactions",
};
const READING: Record<SectionName, string> = {
  profile: "readingProfile", experience: "readingExperience", skills: "readingSkills",
  posts: "readingPosts", comments: "readingComments", reactions: "readingReactions",
};
const PROGRESS_VALUE: Partial<Record<SectionName, string>> = {
  posts: "progressValuePosts", comments: "progressValueComments", reactions: "progressValueReactions",
};
const STEP_DESCRIPTION: Record<StepStatus, string> = { done: "stepDone", current: "stepCurrent", waiting: "stepWaiting" };
const DAY_MS = 86_400_000;

const action = (id: UiAction, key: string, variant: ButtonVariant = "primary", icon: IconName | null = null): ViewAction =>
  ({ id, label: t(key), variant, icon });

const plural = (count: number, one: string, many: string): string => (count === 1 ? t(one) : t(many, count));

function capturedSentence(counts: Counts): string {
  const parts: string[] = [];
  if (counts.profileSections > 0) parts.push(t("countProfile"));
  parts.push(plural(counts.posts, "countPostsOne", "countPosts"));
  parts.push(plural(counts.comments, "countCommentsOne", "countComments"));
  parts.push(plural(counts.reactions, "countReactionsOne", "countReactions"));
  return `${parts.join(", ")}.`;
}

function sectionLine(line: SectionLine): string {
  const label = t(SECTION_LABEL[line.section]);
  const counted = line.section === "posts" || line.section === "comments" || line.section === "reactions";
  if (line.state === "skipped") return t("lineNotRead", label);
  if (line.state === "unavailable") return t("lineNothing", label);
  if (line.state === "partial") return counted ? t("lineReadStopped", label, line.count ?? 0) : t("lineReadPlainStopped", label);
  return counted ? t("lineRead", label, line.count ?? 0) : t("lineReadPlain", label);
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
      return { title: t("permissionTitle"), body: [t("permissionBody")], primary: action("allow", "actionAllow"), secondary: action("whatItReads", "actionWhatItReads", "link", "external") };
    case "signedOut":
      return {
        title: t("signedOutTitle"), body: [t("signedOutBody")], primary: action("connect", "actionConnect"),
        notes: state.devRedirectUrl ? [t("devRedirectUrl", state.devRedirectUrl)] : [],
      };
    case "connecting":
      return { title: t("connectingTitle"), body: [t("connectingBody")], working: true, secondary: action("cancelConnect", "actionCancel", "outline") };
    case "notOnProfile":
      return { title: t("notOnProfileTitle"), body: [t("notOnProfileBody")], primary: action("openScouty", "actionOpenScouty", "primary", "external"), footer: t("connectedTo", state.workspace) };
    case "consent":
      return {
        title: t("consentTitle"), bullets: [t("consentPoint1"), t("consentPoint2"), t("consentPoint3")],
        primary: action("acceptConsent", "actionAcceptConsent"), secondary: action("cancel", "actionCancel", "outline"),
      };
    case "ready":
      return {
        title: t("readyTitle"), body: [t("readyBody", state.slug, state.workspace)], primary: action("capture", "actionCapture"),
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
      const text = state.loading ? t("progressLoading") : counted ? t("progressCount", state.count, state.cap) : t("progressReading");
      return {
        title: t(READING[state.section]),
        progress: {
          value: counted ? Math.min(state.count, state.cap) : 0, max: counted ? state.cap : 1, text,
          valueText: counted && valueKey && !state.loading ? t(valueKey, state.count, state.cap) : text,
          indeterminate: state.loading || !counted,
        },
        steps: state.steps.map((step) => ({ label: t(SECTION_LABEL[step.section]), status: step.status, description: t(STEP_DESCRIPTION[step.status], t(SECTION_LABEL[step.section])) })),
        estimate: state.minutesLeft <= 1 ? t("estimateOne") : t("estimateMany", state.minutesLeft),
        primary: action("stop", "actionStop", "primary", "x"),
      };
    }
    case "sending":
      return { title: t("sendingTitle"), body: state.slow ? [t("sendingBody"), t("sendingSlow")] : [t("sendingBody")], working: true };
    case "doneComplete":
      return {
        title: t("doneTitle"), icon: "check", pill: { tone: "good", label: t("pillComplete") }, body: [capturedSentence(state.counts)],
        primary: action("openAnalysis", "actionOpenAnalysis", "primary", "external"), secondary: action("dismiss", "actionDone", "outline"),
        notes: clickLogNotes(state.clickLog),
      };
    case "donePartial":
      return {
        title: t("partialTitle"), pill: { tone: "neutral", label: t("pillPartial") },
        bullets: state.sections.map(sectionLine), body: state.notExpanded ? [t("partialBody"), t("notExpandedBody")] : [t("partialBody")],
        primary: action("openAnalysis", "actionOpenAnalysis", "primary", "external"), secondary: action("captureAgain", "actionCaptureAgain", "outline"),
        notes: clickLogNotes(state.clickLog),
      };
    case "linkedinSignIn":
      return { tone: "alert", icon: "alert", title: t("linkedinSignInTitle"), body: [t("linkedinSignInBody")], primary: action("captureAgain", "actionCaptureAgain") };
    case "verification":
      return { tone: "alert", icon: "alert", title: t("verificationTitle"), body: [t("verificationBody")], primary: action("dismiss", "actionOk") };
    case "unavailable":
      return { tone: "alert", icon: "alert", title: t("unavailableTitle"), body: [t("unavailableBody")], primary: action("dismiss", "actionOk") };
    case "addressChanged":
      return { tone: "alert", icon: "alert", title: t("addressChangedTitle"), body: [t("addressChangedBody", state.address)], primary: action("capture", "actionCaptureThisPage") };
    case "offline":
      return { tone: "alert", icon: "alert", title: t("offlineTitle"), body: [t("offlineBody")], primary: action("retryNow", "actionTryNow") };
    case "notAnswering":
      if (!state.sending) {
        // The capture could not be started: nothing is kept, so Try now starts it again.
        return {
          tone: "alert", icon: "alert", title: t("notAnsweringTitle"),
          body: [t("notAnsweringStartBody"), state.retryAt ? t("notAnsweringStartRetryAt", clockTime(state.retryAt)) : t("notAnsweringStartLater")],
          primary: action("capture", "actionTryNow"),
        };
      }
      return {
        tone: "alert", icon: "alert", title: t("notAnsweringTitle"),
        body: state.retryAt ? [t("notAnsweringBody"), t("notAnsweringRetryAt", clockTime(state.retryAt))] : [t("notAnsweringBody")],
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
      return { tone: "alert", icon: "alert", title: t("failedTitle"), body: [t("failedBody")], primary: action("captureAgain", "actionCaptureAgain") };
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
        notes: state.devRedirectUrl ? [t("devRedirectUrl", state.devRedirectUrl)] : [],
      };
    case "takenOver":
      return {
        tone: "alert", icon: "alert", title: t("takenOverTitle"), body: [t("takenOverBody"), t("takenOverNext")],
        primary: action("dismiss", "actionOk"), secondary: action("captureAgain", "actionCaptureHere", "outline"),
      };
  }
}

function clickLogNotes(log: { name: string; selector: string }[] | null | undefined): string[] {
  if (log === null || log === undefined) return [];
  if (log.length === 0) return [t("clickLogNone")];
  return [t("clickLogTitle", log.length), ...log.map((entry) => `${entry.name} (${entry.selector})`)];
}

export function viewFor(state: UiState): View {
  const d = draft(state);
  const workspace = "workspace" in state && state.workspace ? state.workspace : null;
  return {
    n: UI_KINDS.indexOf(state.kind) + 1,
    kind: state.kind,
    tone: d.tone ?? "status",
    icon: d.icon ?? null,
    title: d.title,
    body: d.body ?? [],
    bullets: d.bullets ?? [],
    pill: d.pill ?? null,
    progress: d.progress ?? null,
    steps: d.steps ?? [],
    estimate: d.estimate ?? null,
    details: d.details ?? [],
    working: d.working ?? false,
    primary: d.primary ?? null,
    secondary: d.secondary ?? null,
    links: d.links ?? [],
    footer: d.footer ?? null,
    workspace,
    showSettings: workspace !== null && state.kind !== "settings",
    notes: d.notes ?? [],
  };
}
