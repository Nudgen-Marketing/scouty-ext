// Builds the UiState the popup and the overlay draw, from permissions, the connection, the tab
// in front of the user and the capture state.
import { EXTENSION_VERSION, LINKEDIN_ORIGIN } from "../config";
import { ext } from "../ext";
import { profileFromUrl } from "../profile-key";
import { ACTIVITY_SECTIONS, type Caps, type SectionName, type SessionResponse } from "../protocol";
import type { UiState } from "../ui/state";
import { ApiError, SignedOutError, type Api } from "./api";
import * as auth from "./auth";
import { hasHostPermissions } from "./permissions";
import type { CaptureController, CaptureState, Notice } from "./session";

const INFO_KEY = "session.info";
const CONSENT_KEY = "consent.v1";
const INFO_TTL_MS = 60_000;

type Info = { at: number; data: SessionResponse };
export type Blocker = { kind: "outdated"; storeUrl: string | null } | { kind: "notAvailable" };

export type UiContext = {
  api: Api;
  controller: CaptureController;
  connecting: () => boolean;
  now: () => number;
};

export async function forgetSessionInfo(): Promise<void> {
  await ext.storage.session.remove(INFO_KEY);
}

export async function consentGiven(): Promise<boolean> {
  return (await ext.storage.local.get(CONSENT_KEY))[CONSENT_KEY] === true;
}
export async function giveConsent(): Promise<void> {
  await ext.storage.local.set({ [CONSENT_KEY]: true });
}

/** Who is connected and to which workspace. Cached for a minute in memory-only storage. */
export async function sessionInfo(ctx: UiContext, fresh = false): Promise<SessionResponse | Blocker | null> {
  const cached = (await ext.storage.session.get(INFO_KEY))[INFO_KEY] as Info | undefined;
  if (!fresh && cached && ctx.now() - cached.at < INFO_TTL_MS) return cached.data;
  try {
    const data = await ctx.api.session();
    await ext.storage.session.set({ [INFO_KEY]: { at: ctx.now(), data } satisfies Info });
    return data;
  } catch (error) {
    if (error instanceof SignedOutError) return null;
    if (error instanceof ApiError && error.status === 426) {
      const store = error.body?.storeUrl;
      return { kind: "outdated", storeUrl: typeof store === "string" && store.startsWith("https://") ? store : null };
    }
    if (error instanceof ApiError && (error.code === "LINKEDIN_NOT_AVAILABLE" || error.code === "LINKEDIN_DISABLED")) return { kind: "notAvailable" };
    // Offline or a server fault: show what is known rather than blocking the popup.
    return cached?.data ?? { protocol: 1, user: { name: "", email: "" }, workspace: { id: "", name: "" }, caps: { posts: 50, comments: 50, reactions: 50 }, limits: { capturesLeftToday: -1 }, serverTime: new Date(ctx.now()).toISOString() };
  }
}

function secondsFor(section: SectionName, caps: Caps): number {
  if (!ACTIVITY_SECTIONS.includes(section)) return 10;
  return Math.min(90, 10 + caps[section as keyof Caps] * 0.8);
}

/** "About N minutes left": from the sections left and the caps. It never counts up. */
export function minutesLeft(state: Extract<CaptureState, { phase: "running" }>, previous: number | null): number {
  const left = state.expected.filter((section) => !state.finished.includes(section));
  const seconds = left.reduce((sum, section) => sum + secondsFor(section, state.caps), 0);
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return previous === null ? minutes : Math.min(previous, minutes);
}

function noticeState(notice: Notice, workspace: string, now: number): UiState {
  switch (notice.kind) {
    case "recent": return { kind: "recent", finalizedAt: notice.finalizedAt, now: new Date(now).toISOString(), workspace };
    case "outdated": return { kind: "outdated" };
    case "notAvailable": return { kind: "notAvailable" };
    case "limit": return { kind: "limit", resetAt: notice.resetAt, workspace };
    case "suppressed": return { kind: "suppressed", workspace };
    case "failed": return { kind: "failed", workspace };
    case "takenOver": return { kind: "takenOver", workspace };
    case "expired": return { kind: "expired", workspace };
    case "notAnswering": return { kind: "notAnswering", retryAt: notice.retryAt, sending: false, workspace };
  }
}

/** The screen for a capture that is running, sending or finished; null when there is none. */
export function captureUi(state: CaptureState, extras: { minutesLeft: number | null }, workspace: string, now: number): UiState | null {
  switch (state.phase) {
    case "idle":
      return state.notice ? noticeState(state.notice, workspace, now) : null;
    case "starting":
      return { kind: "sending", slow: false, workspace };
    case "running": {
      const cap = ACTIVITY_SECTIONS.includes(state.section) ? state.caps[state.section as keyof Caps] : 0;
      return {
        kind: "capturing", section: state.section, count: state.count, cap, loading: state.loading, workspace,
        steps: state.expected.map((section) => ({ section, status: state.finished.includes(section) ? "done" : section === state.section ? "current" : "waiting" })),
        minutesLeft: minutesLeft(state, extras.minutesLeft),
      };
    }
    case "stopped":
      return { kind: "sending", slow: false, workspace };
    case "finalizing":
      if (state.blocked === "auth") return { kind: "connectionEnded" };
      if (state.blocked === "offline") return { kind: "offline", workspace };
      if (state.blocked === "server") {
        const retryAt = state.rateLimited && typeof state.retryAt === "number" ? new Date(state.retryAt).toISOString() : null;
        return { kind: "notAnswering", retryAt, sending: true, workspace };
      }
      return { kind: "sending", slow: state.slow, workspace };
    case "done": {
      const r = state.result;
      if (r.stop === "logged_out" || r.stop === "left_linkedin") return { kind: "linkedinSignIn", workspace };
      if (r.stop === "checkpoint") return { kind: "verification", workspace };
      if (r.stop === "reduced_profile" || r.stop === "not_found" || r.stop === "unknown_page") return { kind: "unavailable", workspace };
      if (r.stop === "wrong_profile") return { kind: "addressChanged", address: r.address ?? "", workspace };
      if (r.completeness === "insufficient") return { kind: "failed", workspace };
      if (r.completeness === "complete") return { kind: "doneComplete", counts: r.captured, workspace };
      return { kind: "donePartial", sections: r.sections, notExpanded: r.notExpanded, workspace };
    }
  }
}

/**
 * The tab a Capture or Capture again starts in: the one the popup (or the overlay) is on, else the
 * capture's own tab, else the tab of a "recent" notice.
 */
export function captureTarget(state: CaptureState, tabId: number | null): number | null {
  return tabId ?? ("tabId" in state ? state.tabId : state.phase === "idle" && state.notice?.kind === "recent" ? state.notice.tabId : null);
}

/** Whether a capture action on this screen could start: the target tab is a LinkedIn profile. */
export async function targetIsProfile(state: CaptureState, tabId: number | null, knownUrl: string | null): Promise<boolean> {
  const target = captureTarget(state, tabId);
  if (target === null) return false;
  let url = knownUrl;
  if (target !== tabId) {
    try {
      url = (await ext.tabs.get(target)).url ?? null;
    } catch {
      url = null;
    }
  }
  return profileFromUrl(url, LINKEDIN_ORIGIN) !== null;
}

export type PopupQuery = { tabId: number | null; tabUrl: string | null; settings: boolean };

export async function popupUi(ctx: UiContext, query: PopupQuery): Promise<UiState> {
  if (!(await hasHostPermissions())) return { kind: "permission" };
  const state = await ctx.controller.current();
  const extras = await ctx.controller.extras();
  const connected = await auth.isConnected();

  if (!connected) {
    // A capture waiting for a reconnect says so; otherwise there is only Connect.
    if (state.phase === "finalizing" && state.blocked === "auth") return { kind: "connectionEnded" };
    if (ctx.connecting()) return { kind: "connecting" };
    return { kind: "signedOut" };
  }

  const info = await sessionInfo(ctx);
  if (info === null) return ctx.connecting() ? { kind: "connecting" } : { kind: "signedOut" };
  if ("kind" in info) return info.kind === "outdated" ? { kind: "outdated" } : { kind: "notAvailable" };
  const workspace = info.workspace.name ?? "";

  if (query.settings) return { kind: "settings", name: info.user.name ?? "", email: info.user.email, workspace, version: EXTENSION_VERSION };

  const active = state.phase !== "idle" && state.phase !== "done";
  if (active && "tabId" in state && query.tabId !== null && query.tabId !== state.tabId) return { kind: "busy", workspace };
  const capture = captureUi(state, { minutesLeft: extras.minutesLeft }, workspace, ctx.now());
  // Off a profile, the screen's Capture action is disabled with what to do instead (no dead button).
  if (capture) return { ...capture, onProfile: await targetIsProfile(state, query.tabId, query.tabUrl) };

  const profile = profileFromUrl(query.tabUrl, LINKEDIN_ORIGIN);
  if (!profile) return { kind: "notOnProfile", workspace };
  if (!(await consentGiven())) return { kind: "consent", slug: profile.key, workspace };
  const left = info.limits.capturesLeftToday;
  return { kind: "ready", slug: profile.key, workspace, capturesLeft: left >= 0 ? left : null };
}
