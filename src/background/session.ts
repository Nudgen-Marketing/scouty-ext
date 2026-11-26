// The capture state machine (plan 6.3). At most one capture exists at a time, and one starts only
// from the user's click on Capture.
//
//   idle → starting → running(section)… → [stopped(reason) →] finalizing → done → idle
//
// `transition` is the pure machine: it returns the next state, or null when the event is not
// legal in the current state (and then nothing happens). `CaptureController` performs the effects.
import { BROWSER, HARD_LIMITS, LINKEDIN_ORIGIN } from "../config";
import type { ClickLogEntry, ReaderArgs, ReaderResult } from "../messages";
import { profileFromUrl, sectionUrl } from "../profile-key";
import {
  ACTIVITY_SECTIONS,
  type Caps, type Completeness, type Counts, type CreateCreated, type FinalizeResponse, type SectionName, type StopReason,
} from "../protocol";
import { pageStateFromPath } from "../reader/page-state";
import { sectionPaths } from "../reader/selectors";
import type { SectionLine } from "../ui/state";
import { ApiError, NetworkError, SignedOutError, isRetryableStatus, type Api, type CaptureRef } from "./api";
import * as outbox from "./outbox";
import { storeUrlFrom } from "./store-url";

export type Notice =
  | { kind: "recent"; finalizedAt: string; tabId: number; url: string; appUrl?: string }
  | { kind: "outdated"; storeUrl: string | null }
  | { kind: "notAvailable" }
  | { kind: "limit"; resetAt: string | null }
  | { kind: "suppressed" }
  | { kind: "failed" }
  /**
   * Screen 25, "This capture stopped": the server no longer knows this capture. It was started again
   * from another browser or device (a newer create of the same profile), or removed in Scouty (by the
   * user, a teammate, or an erasure).
   */
  | { kind: "takenOver" }
  /**
   * Screen 27, "This capture timed out": the capture's 20 minutes ran out before it was sent,
   * noticed by this browser's clock or answered by Scouty (410 LINKEDIN_CAPTURE_EXPIRED). Nothing of
   * it was saved.
   */
  | { kind: "expired" }
  /**
   * Screen 26 at create: Scouty answered but could not start the capture (408, 429, 502, 503, 504
   * after the retries). retryAt (ISO) only for a rate limit.
   */
  | { kind: "notAnswering"; retryAt: string | null };

export type DoneResult = {
  completeness: Completeness; captured: Counts; appUrl: string;
  stop: StopReason | null; address: string | null; sections: SectionLine[]; notExpanded: boolean;
};

export type CaptureState =
  | { phase: "idle"; notice: Notice | null }
  | { phase: "starting"; tabId: number; profileKey: string }
  | { phase: "running"; tabId: number; profileKey: string; section: SectionName; count: number; loading: boolean; expected: SectionName[]; caps: Caps; finished: SectionName[] }
  | { phase: "stopped"; tabId: number; reason: StopReason; address: string | null }
  | {
    phase: "finalizing"; tabId: number; stop: StopReason | null; address: string | null; blocked: null | Blocked; slow: boolean;
    /**
     * While blocked by "server": when the next automatic try is due (ms), and whether a rate limit
     * (429) said so. While blocked by "offline": the earliest next try when the state is asked for.
     */
    retryAt?: number | null; rateLimited?: boolean;
  }
  | { phase: "done"; tabId: number; result: DoneResult };

/**
 * Why sending is waiting: "offline" when the last failure got no answer at all (a network error),
 * "server" when Scouty answered but could not take it right now (408, 429, 502, 503, 504), and
 * "auth" when the connection to Scouty ended.
 */
export type Blocked = "offline" | "server" | "auth";

export type Phase = CaptureState["phase"];
export const PHASES: readonly Phase[] = ["idle", "starting", "running", "stopped", "finalizing", "done"];

export type CaptureEvent =
  | { type: "capture"; tabId: number; profileKey: string }
  | { type: "created"; expected: SectionName[]; caps: Caps }
  | { type: "recent"; notice: Notice }
  | { type: "failed"; notice: Notice | null }
  | { type: "loaded" }
  | { type: "progress"; section: SectionName; count: number }
  | { type: "sectionDone"; section: SectionName }
  | { type: "stop"; reason: StopReason; address: string | null }
  | { type: "settled" }
  | { type: "blocked"; by: Blocked; retryAt?: number | null; rateLimited?: boolean }
  | { type: "slow" }
  | { type: "resume" }
  | { type: "finalized"; result: DoneResult }
  | { type: "dismiss" }
  | { type: "expired" };

export type EventType = CaptureEvent["type"];
export const EVENT_TYPES: readonly EventType[] = [
  "capture", "created", "recent", "failed", "loaded", "progress", "sectionDone", "stop", "settled", "blocked", "slow",
  "resume", "finalized", "dismiss", "expired",
];

export const IDLE: CaptureState = { phase: "idle", notice: null };
/** Where a capture whose time ran out ends: idle, with the notice that says so. */
export const EXPIRED: CaptureState = { phase: "idle", notice: { kind: "expired" } };

/** The pure machine. Null means the event is refused: the state does not change and nothing is done. */
export function transition(state: CaptureState, event: CaptureEvent): CaptureState | null {
  switch (state.phase) {
    case "idle":
      if (event.type === "capture") return { phase: "starting", tabId: event.tabId, profileKey: event.profileKey };
      if (event.type === "dismiss") return IDLE;
      return null;
    case "starting":
      if (event.type === "created") {
        const first = event.expected[0];
        if (!first) return null;
        return { phase: "running", tabId: state.tabId, profileKey: state.profileKey, section: first, count: 0, loading: true, expected: event.expected, caps: event.caps, finished: [] };
      }
      if (event.type === "recent") return { phase: "idle", notice: event.notice };
      if (event.type === "failed") return { phase: "idle", notice: event.notice };
      if (event.type === "expired") return EXPIRED;
      return null;
    case "running":
      if (event.type === "loaded") return { ...state, loading: false };
      if (event.type === "progress") return event.section === state.section ? { ...state, count: event.count, loading: false } : null;
      if (event.type === "sectionDone") {
        if (event.section !== state.section) return null;
        const finished = [...state.finished, state.section];
        const next = state.expected.find((section) => !finished.includes(section));
        if (!next) return { phase: "finalizing", tabId: state.tabId, stop: null, address: null, blocked: null, slow: false };
        return { ...state, section: next, count: 0, loading: true, finished };
      }
      if (event.type === "stop") return { phase: "stopped", tabId: state.tabId, reason: event.reason, address: event.address };
      if (event.type === "failed") return { phase: "idle", notice: event.notice };
      if (event.type === "expired") return EXPIRED;
      return null;
    case "stopped":
      if (event.type === "settled") return { phase: "finalizing", tabId: state.tabId, stop: state.reason, address: state.address, blocked: null, slow: false };
      if (event.type === "failed") return { phase: "idle", notice: event.notice };
      if (event.type === "expired") return EXPIRED;
      return null;
    case "finalizing":
      if (event.type === "blocked") {
        const { retryAt: _retryAt, rateLimited: _rateLimited, ...rest } = state;
        if (event.by === "server") return { ...rest, blocked: "server", retryAt: event.retryAt ?? null, rateLimited: event.rateLimited ?? false };
        // Offline: the earliest time the popup or the overlay asking for the state tries again.
        if (event.by === "offline" && typeof event.retryAt === "number") return { ...rest, blocked: "offline", retryAt: event.retryAt };
        return { ...rest, blocked: event.by };
      }
      if (event.type === "slow") return { ...state, slow: true };
      if (event.type === "resume") {
        if (!state.blocked) return null;
        const { retryAt: _retryAt, rateLimited: _rateLimited, ...rest } = state;
        return { ...rest, blocked: null, slow: false };
      }
      if (event.type === "finalized") return { phase: "done", tabId: state.tabId, result: event.result };
      if (event.type === "failed") return { phase: "idle", notice: event.notice };
      if (event.type === "expired") return EXPIRED;
      return null;
    case "done":
      if (event.type === "dismiss") return IDLE;
      if (event.type === "capture") return { phase: "starting", tabId: event.tabId, profileKey: event.profileKey };
      return null;
  }
}

/** Page-state stops: content read from a page in a bad state is never sent. */
export const PAGE_STATE_STOPS: readonly StopReason[] = ["logged_out", "reduced_profile", "checkpoint", "unknown_page", "wrong_profile", "not_found"];

// ---- effects ----

export type TabInfo = { url?: string; status?: string };
export type SessionDeps = {
  api: Api;
  tabs: {
    get(tabId: number): Promise<TabInfo | null>;
    update(tabId: number, url: string): Promise<void>;
  };
  /** Injects one of the extension's own bundles into the capture tab. False when not permitted. */
  inject(tabId: number, file: "reader.js" | "overlay.js"): Promise<boolean>;
  /** True when a reader injected into the tab's current document is still working (it is gone after a reload). */
  readerAlive(tabId: number): Promise<boolean>;
  store: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; remove(key: string): Promise<void> };
  sleep(ms: number): Promise<void>;
  /**
   * Wakes the background at a time (ms) to try sending again, also after it stopped (an alarm,
   * src/background/wake.ts); `clear` when nothing waits any more.
   */
  wake: { at(when: number): void; clear(): void };
  now(): number;
  uuid(): string;
  /** Called after every state change (the popup and the overlay are told to redraw). */
  changed(state: CaptureState): void;
};

type Aux = {
  stopRequested: boolean;
  readerActive: boolean;
  navigating: boolean;
  seq: Partial<Record<SectionName, number>>;
  deferred: boolean;
  clickLog: ClickLogEntry[];
  notExpanded: boolean;
  degraded: SectionName[];
  minutesLeft: number | null;
  /** Sections the watchdog read again after their reader went silent (once each). */
  rereads: Partial<Record<SectionName, number>>;
};
const freshAux = (): Aux => ({ stopRequested: false, readerActive: false, navigating: false, seq: {}, deferred: false, clickLog: [], notExpanded: false, degraded: [], minutesLeft: null, rereads: {} });

const STATE_KEY = "capture.state";
const AUX_KEY = "capture.aux";
const LOAD_POLL_MS = 250;
const LOAD_TIMEOUT_MS = 30_000;
/** Right after `tabs.update` a browser may still report the previous page as complete for a moment. */
const STALE_LOAD_GRACE_MS = 3_000;
const STOP_GRACE_MS = 6000;
/**
 * The least wait before trying again on its own after Scouty answered but could not take the
 * capture (the API client has already retried with backoff by then). A longer Retry-After is
 * honored. The in-memory timer is backed by an alarm (src/background/wake.ts), which wakes a
 * stopped service worker or event page; recover and the popup or overlay asking also pick it up.
 */
export const SERVER_RETRY_MS = 20_000;
/**
 * After a network failure ("You're offline") sending is tried again by the retry alarm, or when the
 * popup or the overlay asks for the state, once at least this long has passed since the last try
 * (the popup asks every 1.5 s; this keeps it from sending a request each time). Chromium fires the
 * alarm no sooner than 30 s after it was set (1 minute on Chrome 116-119; see wake.ts).
 */
export const OFFLINE_RETRY_MS = 15_000;
/**
 * A running reader reports progress on every scroll step. After this long without a word from it the
 * background checks that it is still there: a reader that is gone (the page was replaced without a
 * load event the extension could act on) is started again once, and the capture ends as partial
 * when it goes silent a second time on the same page. Under the 30 s a Chromium service worker may
 * idle, so the timer is not lost.
 */
export const READER_WATCHDOG_MS = 15_000;
/**
 * While sending is under way (finalizing, not waiting), the retry alarm is kept this far ahead, so a
 * background stopped mid-send is woken to pick it up (recover). More than the 30 s a Chromium service
 * worker may idle and the 1 minute alarm minimum of Chrome 116-119; an alarm that goes off while the
 * send is still in flight is set again.
 */
export const SENDING_WAKE_MS = 60_000;

export type StartOutcome = "started" | "busy" | "not_profile";

export class CaptureController {
  private state: CaptureState = IDLE;
  private aux: Aux = freshAux();
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();
  /** When the reader of the current section was last heard from (or started). Memory only. */
  private readerSeenAt = 0;

  constructor(private readonly deps: SessionDeps) {}

  // -- state --

  private async ready(): Promise<void> {
    if (this.loaded) return;
    const state = (await this.deps.store.get(STATE_KEY)) as CaptureState | undefined;
    const aux = (await this.deps.store.get(AUX_KEY)) as Aux | undefined;
    if (state && typeof state.phase === "string") this.state = state;
    if (aux) this.aux = { ...freshAux(), ...aux };
    this.loaded = true;
  }

  async current(): Promise<CaptureState> {
    await this.ready();
    await this.expireIfDue();
    return this.state;
  }

  async extras(): Promise<Readonly<Aux>> {
    await this.ready();
    return this.aux;
  }

  /** Keeps the "about N minutes left" shown, so a later screen never shows more (ui-state `minutesLeft`). */
  async noteMinutesLeft(minutes: number): Promise<void> {
    await this.ready();
    if (this.state.phase !== "running" || this.aux.minutesLeft === minutes) return;
    this.aux.minutesLeft = minutes;
    await this.saveAux();
  }

  /** Resolves when no work is in flight. */
  settledWork(): Promise<unknown> {
    return this.queue;
  }

  private async saveAux(): Promise<void> {
    await this.deps.store.set(AUX_KEY, this.aux);
  }

  private async dispatch(event: CaptureEvent): Promise<boolean> {
    const next = transition(this.state, event);
    if (!next) return false;
    const rewake = wakeKey(this.state) !== wakeKey(next);
    this.state = next;
    await this.deps.store.set(STATE_KEY, next);
    if (rewake) await this.syncWake();
    this.deps.changed(next);
    return true;
  }

  /**
   * Keeps the retry alarm (src/background/wake.ts) while an outbox exists, at the earlier of the next
   * try (a wait on Scouty or the network, or SENDING_WAKE_MS ahead while sending) and the outbox's
   * expiry, so a stopped background is woken to send, or to delete what ran out of time (the
   * 20 minutes PRIVACY.md promises), also while it waits for sign-in. No outbox: no alarm.
   */
  private async syncWake(): Promise<void> {
    const box = await outbox.load();
    if (!box) {
      this.deps.wake.clear();
      return;
    }
    const state = this.state;
    let when = box.expiresAt;
    if (state.phase === "finalizing") {
      if (waitsToRetry(state) && typeof state.retryAt === "number") when = Math.min(when, state.retryAt);
      else if (state.blocked === null) when = Math.min(when, this.deps.now() + SENDING_WAKE_MS);
    }
    this.deps.wake.at(when);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Expiry is checked lazily, by every handler, not by a timer. A capture whose time ran out ends in
   * "This capture timed out", not silently.
   */
  private async expireIfDue(): Promise<boolean> {
    if (this.state.phase === "idle" || this.state.phase === "done" || this.state.phase === "starting") return false;
    const box = await outbox.load();
    if (box && box.expiresAt > this.deps.now()) return false;
    await this.expire();
    return true;
  }

  /** The capture ran out of time (this browser's clock, or Scouty's 410): nothing of it is kept or tried again. */
  private async expire(): Promise<void> {
    await outbox.clear();
    this.aux = freshAux();
    await this.saveAux();
    await this.dispatch({ type: "expired" });
  }

  private async fail(notice: Notice | null): Promise<void> {
    if (notice?.kind === "expired") return this.expire();
    this.aux = freshAux();
    await this.saveAux();
    // As in finalize: the notice first, then the outbox, so a read in between never shows "timed out".
    await this.dispatch({ type: "failed", notice });
    await outbox.clear();
    await this.syncWake(); // no outbox now: no alarm
  }

  private async failWith(error: unknown, creating = false): Promise<void> {
    await this.fail(noticeFor(error, creating, this.deps.now()));
  }

  // -- start --

  start(input: { tabId: number; url: string; recapture: boolean }): Promise<StartOutcome> {
    return this.enqueue(async () => {
      await this.ready();
      await this.expireIfDue();
      const profile = profileFromUrl(input.url, LINKEDIN_ORIGIN);
      if (!profile) return "not_profile";
      if (this.state.phase !== "idle" && this.state.phase !== "done") return "busy";
      await outbox.clear();
      this.aux = freshAux();
      await this.saveAux();
      if (!(await this.dispatch({ type: "capture", tabId: input.tabId, profileKey: profile.key }))) return "busy";
      try {
        const answer = await this.deps.api.createCapture({ linkedinUrl: profile.url, recapture: input.recapture }, this.deps.uuid());
        if ("recent" in answer) {
          const appUrl = typeof answer.recent.appUrl === "string" ? { appUrl: answer.recent.appUrl } : {};
          await this.dispatch({ type: "recent", notice: { kind: "recent", finalizedAt: answer.recent.finalizedAt, tabId: input.tabId, url: input.url, ...appUrl } });
          return "started";
        }
        if (answer.profileKey !== profile.key || answer.expected.length === 0) {
          await this.fail({ kind: "failed" });
          return "started";
        }
        // Times that cannot be read are an answer the extension cannot use, like a wrong profile.
        if (!(await outbox.begin(clampCaps(answer), this.deps.now()))) {
          await this.fail({ kind: "failed" });
          return "started";
        }
        await this.dispatch({ type: "created", expected: answer.expected, caps: clampCaps(answer).caps });
        void this.enqueue(() => this.readCurrent(false));
      } catch (error) {
        if (error instanceof SignedOutError) await this.fail(null);
        else await this.failWith(error, true);
      }
      return "started";
    });
  }

  // -- reading --

  /**
   * `previous`: the address the tab showed before this navigation. A "complete" still showing it,
   * before any "loading" was seen, is the old page (not yet replaced), so it is waited out for a
   * moment instead of being taken for where LinkedIn sent the tab (which would declare the section
   * missing and skip it silently).
   */
  private async waitForLoad(tabId: number, previous: string | null = null): Promise<{ kind: "loaded"; url: string } | { kind: "closed" } | { kind: "left" } | { kind: "stop" } | { kind: "timeout" }> {
    const deadline = this.deps.now() + LOAD_TIMEOUT_MS;
    let sawLoading = false, staleReads = Math.ceil(STALE_LOAD_GRACE_MS / LOAD_POLL_MS);
    for (;;) {
      const tab = await this.deps.tabs.get(tabId);
      if (!tab) return { kind: "closed" };
      if (this.aux.stopRequested) return { kind: "stop" };
      if (tab.status !== "complete") sawLoading = true;
      // Bounded by reads (about 3 s at the poll interval), so it ends even if the clock stalls.
      const stale = previous !== null && !sawLoading && tab.url === previous && staleReads-- > 0;
      if (tab.status === "complete" && !stale) return tab.url ? { kind: "loaded", url: tab.url } : { kind: "left" };
      // Still loading after 30 s: a slow network, not the user going elsewhere.
      if (this.deps.now() >= deadline) return { kind: "timeout" };
      await this.deps.sleep(LOAD_POLL_MS);
    }
  }

  /** Opens the page of the current section (unless it is already open) and injects the reader. */
  private async readCurrent(navigate: boolean): Promise<void> {
    const state = this.state;
    if (state.phase !== "running") return;
    const expectedUrl = sectionUrl(LINKEDIN_ORIGIN, state.profileKey, sectionPaths[state.section]);
    this.aux.readerActive = false;
    this.aux.navigating = true;
    await this.saveAux();
    let previousUrl: string | null = null;
    try {
      // The first page is read where the user pressed Capture only when that is already this
      // section's page: a capture started from the activity or a detail page opens the profile first.
      const open = await this.deps.tabs.get(state.tabId);
      if (navigate || (open?.url && !samePage(open.url, expectedUrl))) {
        previousUrl = open?.url ?? null;
        await this.deps.tabs.update(state.tabId, expectedUrl);
      }
    } catch {
      return this.stop("tab_closed", null);
    }
    const loaded = await this.waitForLoad(state.tabId, previousUrl);
    this.aux.navigating = false;
    await this.saveAux();
    if (loaded.kind === "closed") return this.stop("tab_closed", null);
    if (loaded.kind === "stop") return this.stop("user_stopped", null);
    if (loaded.kind === "left") return this.stop("left_linkedin", null);
    if (loaded.kind === "timeout") return this.stop("timeout", null);
    // Target check before every read.
    const profile = profileFromUrl(loaded.url, LINKEDIN_ORIGIN);
    if (!profile) return this.stop(leftReason(loaded.url), null);
    if (profile.key !== state.profileKey) return this.stop("wrong_profile", profile.url);
    if (!samePage(loaded.url, expectedUrl)) {
      // LinkedIn sent the tab somewhere else on this profile: the profile has no such page.
      await outbox.declare(state.section, { state: "unavailable", reason: "no_such_section" });
      return this.advance(state.section);
    }
    await this.deps.inject(state.tabId, "overlay.js");
    const seq = (this.aux.seq[state.section] ?? 0) + 1;
    this.aux.seq[state.section] = seq;
    this.aux.readerActive = true;
    await this.saveAux();
    if (!(await this.deps.inject(state.tabId, "reader.js"))) return this.stop("permission_missing", null);
    this.readerSeenAt = this.deps.now();
    this.watch(state.section, seq);
    await this.dispatch({ type: "loaded" });
  }

  /** Starts the watchdog for this reader (READER_WATCHDOG_MS). */
  private watch(section: SectionName, seq: number, ms = READER_WATCHDOG_MS): void {
    void this.deps.sleep(ms).then(() => this.enqueue(() => this.checkReader(section, seq)));
  }

  /** The watchdog: is the reader of this section still working? */
  private async checkReader(section: SectionName, seq: number): Promise<void> {
    await this.ready();
    if (await this.expireIfDue()) return;
    const state = this.state;
    if (state.phase !== "running" || state.section !== section || !this.aux.readerActive) return;
    if ((this.aux.seq[section] ?? 1) !== seq) return;
    const quiet = this.deps.now() - this.readerSeenAt;
    if (quiet < READER_WATCHDOG_MS) return this.watch(section, seq, READER_WATCHDOG_MS - quiet);
    // Still there, only slow (a page that takes long to draw): keep waiting; its own time budget ends it.
    if (await this.deps.readerAlive(state.tabId)) {
      this.readerSeenAt = this.deps.now();
      return this.watch(section, seq);
    }
    if ((this.aux.rereads[section] ?? 0) >= 1) return this.stop("timeout", null);
    this.aux.rereads[section] = (this.aux.rereads[section] ?? 0) + 1;
    await this.saveAux();
    return this.readCurrent(false);
  }

  /** The reader asks what to read. Only the capture tab, in the running state, gets an answer. */
  async readerHello(tabId: number | null): Promise<{ args: ReaderArgs | null }> {
    await this.ready();
    const state = this.state;
    if (state.phase !== "running" || tabId !== state.tabId || !this.aux.readerActive) return { args: null };
    this.readerSeenAt = this.deps.now();
    const cap = ACTIVITY_SECTIONS.includes(state.section) ? state.caps[state.section as keyof Caps] : 0;
    return { args: { section: state.section, profileKey: state.profileKey, seq: this.aux.seq[state.section] ?? 1, cap, browser: BROWSER } };
  }

  async readerProgress(tabId: number | null, section: SectionName, count: number): Promise<{ stop: boolean }> {
    await this.ready();
    if (await this.expireIfDue()) return { stop: true };
    const state = this.state;
    if (state.phase !== "running" || tabId !== state.tabId) return { stop: true };
    if (section === state.section) this.readerSeenAt = this.deps.now();
    await this.dispatch({ type: "progress", section, count });
    return { stop: this.aux.stopRequested };
  }

  readerResult(tabId: number | null, section: SectionName, seq: number, result: ReaderResult): Promise<void> {
    return this.enqueue(async () => {
      await this.ready();
      if (await this.expireIfDue()) return;
      const state = this.state;
      if (state.phase !== "running" || tabId !== state.tabId || section !== state.section) return;
      if (seq !== (this.aux.seq[section] ?? 1)) return;
      this.aux.readerActive = false;
      if (result.clickLog.length) this.aux.clickLog = [...this.aux.clickLog, ...result.clickLog].slice(-200);
      await this.saveAux();

      if (result.kind === "stopped") {
        // Nothing read on a page in a bad state is kept.
        await outbox.declare(section, { state: "skipped", reason: result.reason });
        return this.stop(result.reason, result.address);
      }
      if (result.kind === "failed") {
        await outbox.declare(section, { state: "skipped", reason: "read_failed" });
        return this.advance(section);
      }
      const payload = result.payload;
      if (payload.section !== section) return this.fail({ kind: "failed" });
      if (!payload.expanded) this.aux.notExpanded = true;
      if (payload.read === "degraded" && !this.aux.degraded.includes(section)) this.aux.degraded.push(section);
      await this.saveAux();
      const nothingThere = payload.read === "empty" && (section !== "profile" || payload.profile?.name == null);
      if (nothingThere && result.state === "complete") {
        // LinkedIn itself shows this page as empty: declared, not uploaded.
        await outbox.declare(section, { state: "unavailable", reason: "no_such_section" });
      } else if (nothingThere) {
        await outbox.declare(section, { state: "skipped", reason: result.reason ?? "read_failed" });
      } else {
        // Written to the outbox before any upload is attempted.
        const entry = await outbox.addSection(payload, result.state, result.reason);
        if (entry) {
          const outcome = await this.upload(entry.section);
          if (outcome === "signed_out") return this.stop("signed_out_of_scouty", null);
          if (outcome === "terminal") return;
        }
      }
      if (result.state === "partial" && result.reason === "user_stopped") return this.stop("user_stopped", null);
      return this.advance(section);
    });
  }

  private async advance(section: SectionName): Promise<void> {
    if (this.aux.stopRequested) return this.stop("user_stopped", null);
    await this.dispatch({ type: "sectionDone", section });
    if (this.state.phase === "running") return this.readCurrent(true);
    if (this.state.phase === "finalizing") return this.finalize();
  }

  private async captureRef(): Promise<CaptureRef | null> {
    const box = await outbox.load();
    return box ? { captureId: box.captureId, uploadToken: box.uploadToken, expiresAt: box.expiresAt } : null;
  }

  /** Sends one section from the outbox. A network failure defers it to finalize; it is never lost. */
  private async upload(section: SectionName): Promise<"sent" | "deferred" | "signed_out" | "terminal"> {
    if (this.aux.deferred) return "deferred";
    const box = await outbox.load();
    const entry = box?.sections.find((s) => s.section === section);
    const body = await outbox.bodyOf(section);
    const ref = await this.captureRef();
    if (!entry || body === null || !ref) return "deferred";
    try {
      // One attempt only: a retry here would hold the reader queue (up to 6 x 25 s plus backoff) with
      // no alarm to wake a stopped worker. A transient failure leaves the section in the outbox for
      // finalize, which retries with alarms.
      await this.deps.api.putSection(ref, { section, body, digestBase64: entry.digestBase64 }, { maxAttempts: 1 });
      await outbox.ack(section, entry.sha256);
      return "sent";
    } catch (error) {
      if (error instanceof SignedOutError) return "signed_out";
      if (isTransient(error)) {
        this.aux.deferred = true;
        await this.saveAux();
        return "deferred";
      }
      await this.failWith(error);
      return "terminal";
    }
  }

  // -- stopping --

  /** The user pressed Stop. The reader hears it on its next step and hands back what it has. */
  userStop(): Promise<void> {
    return (async () => {
      await this.ready();
      if (this.state.phase !== "running") return;
      const section = this.state.section;
      this.aux.stopRequested = true;
      await this.saveAux();
      // If the reader does not answer (the page is still loading, or gone), stop anyway.
      void this.deps.sleep(STOP_GRACE_MS).then(() => this.enqueue(async () => {
        if (this.state.phase === "running" && this.state.section === section && this.aux.stopRequested) await this.stop("user_stopped", null);
      }));
    })();
  }

  tabRemoved(tabId: number): Promise<void> {
    return this.enqueue(async () => {
      await this.ready();
      if (this.state.phase === "running" && this.state.tabId === tabId) await this.stop("tab_closed", null);
    });
  }

  /**
   * The capture tab finished loading. If the user took it somewhere else while a capture was
   * running, the capture stops. The tab is asked where it is now; the event's own address may be old.
   * A load of the page being read that the extension did not start (the user reloaded it) replaced
   * the document and its reader: the section is read again, with a new sequence number.
   */
  tabLoaded(tabId: number): Promise<void> {
    return this.enqueue(async () => {
      await this.ready();
      const state = this.state;
      if (state.phase !== "running" || state.tabId !== tabId || this.aux.navigating) return;
      const tab = await this.deps.tabs.get(tabId);
      if (!tab) return this.stop("tab_closed", null);
      if (tab.status !== "complete") return;
      const profile = profileFromUrl(tab.url, LINKEDIN_ORIGIN);
      if (!profile) return this.stop(leftReason(tab.url), null);
      if (profile.key !== state.profileKey) return this.stop("wrong_profile", profile.url);
      const expectedUrl = sectionUrl(LINKEDIN_ORIGIN, state.profileKey, sectionPaths[state.section]);
      if (!samePage(tab.url ?? "", expectedUrl)) return this.stop("left_linkedin", null);
      // Events are handled in order, so this one may be the load the extension itself started and
      // already read; then the reader it injected is still at work and nothing is done.
      if (this.aux.readerActive && (await this.deps.readerAlive(tabId))) return;
      return this.readCurrent(false);
    });
  }

  private async stop(reason: StopReason, address: string | null): Promise<void> {
    if (this.state.phase !== "running") return;
    const section = this.state.section;
    const box = await outbox.load();
    const read = box?.sections.some((s) => s.section === section);
    if (!read && !box?.declared[section]) await outbox.declare(section, { state: "skipped", reason });
    await outbox.setStop(reason);
    this.aux.readerActive = false;
    await this.saveAux();
    await this.dispatch({ type: "stop", reason, address });
    await this.dispatch({ type: "settled" });
    if (reason === "signed_out_of_scouty") {
      await this.dispatch({ type: "blocked", by: "auth" });
      return;
    }
    return this.finalize();
  }

  // -- finalize and resume --

  private async finalize(): Promise<void> {
    let reconciled = false;
    for (;;) {
      const state = this.state;
      if (state.phase !== "finalizing") return;
      const box = await outbox.load();
      const ref = await this.captureRef();
      if (!box || !ref) return this.fail({ kind: "failed" });
      const onRetry = (attempt: number): void => {
        if (attempt >= 2) void this.dispatch({ type: "slow" });
      };
      try {
        for (const entry of outbox.pending(box)) {
          const body = await outbox.bodyOf(entry.section);
          if (body === null) {
            await outbox.unack(entry.section);
            continue;
          }
          try {
            await this.deps.api.putSection(ref, { section: entry.section, body, digestBase64: entry.digestBase64 }, { onRetry });
          } catch (error) {
            // The server finalized this capture already (our finalize got through, its answer did not):
            // send nothing more; the same finalize again returns the same answer (plan 5.5).
            if (error instanceof ApiError && error.code === "LINKEDIN_CAPTURE_FINALIZED") {
              await outbox.ackAll();
              break;
            }
            throw error;
          }
          await outbox.ack(entry.section, entry.sha256);
        }
        this.aux.deferred = false;
        await this.saveAux();
        const request = await outbox.finalizeRequest(this.deps.uuid);
        if (!request) return this.fail({ kind: "failed" });
        const answer = await this.deps.api.finalize(ref, request.manifest, request.key, onRetry);
        const result = await this.resultFrom(answer, state.stop, state.address);
        // The state first, then the outbox: a state read in between (the popup polls, outside the
        // queue) must never see this capture without its outbox and end it as timed out. An outbox
        // left behind by a stop here is deleted by the alarm (expired, no capture).
        await this.dispatch({ type: "finalized", result });
        await outbox.clear();
        await this.syncWake(); // no outbox now: no alarm
        return;
      } catch (error) {
        if (error instanceof SignedOutError) {
          await this.dispatch({ type: "blocked", by: "auth" });
          return;
        }
        if (isTransient(error)) return this.waitOut(error);
        if (error instanceof ApiError && error.code === "LINKEDIN_MANIFEST_MISMATCH" && !reconciled) {
          // One reconcile: send the named sections again from the outbox, then finalize again.
          reconciled = true;
          const named = [...(error.body?.missing ?? []), ...(error.body?.mismatched ?? [])];
          for (const section of named) await outbox.unack(section);
          continue;
        }
        return this.failWith(error);
      }
    }
  }

  private async resultFrom(answer: FinalizeResponse, stop: StopReason | null, address: string | null): Promise<DoneResult> {
    const box = await outbox.load();
    const manifest = box ? outbox.manifestOf(box) : { sections: [], stop };
    const sections: SectionLine[] = manifest.sections.map((entry) => ({
      section: entry.section, state: entry.state, reason: entry.reason, count: entry.blockCount, degraded: this.aux.degraded.includes(entry.section),
    }));
    return { completeness: answer.completeness, captured: answer.captured, appUrl: answer.appUrl, stop, address, sections, notExpanded: this.aux.notExpanded };
  }

  /**
   * Finishes sending after a network drop, a reconnect or a restart of the background context,
   * without reading LinkedIn again: ask what the server holds, re-send what differs, finalize.
   */
  resume(): Promise<void> {
    return this.enqueue(() => this.resumeNow());
  }

  private async resumeNow(): Promise<void> {
    await this.ready();
    if (await this.expireIfDue()) return;
    if (this.state.phase !== "finalizing") return;
    await this.dispatch({ type: "resume" });
    const ref = await this.captureRef();
    const box = await outbox.load();
    if (!ref || !box) return this.fail({ kind: "failed" });
    try {
      const status = await this.deps.api.status(ref);
      // Finalized already: the server lists nothing as received any more, and re-sending a section
      // would be refused. The same finalize again (same key, same manifest) returns the answer.
      if (status.status === "finalized") await outbox.ackAll();
      else for (const entry of box.sections) {
        const held = status.received.find((r) => r.section === entry.section);
        if (held && held.seq === entry.seq && held.sha256 === entry.sha256) await outbox.ack(entry.section, entry.sha256);
        else await outbox.unack(entry.section);
      }
    } catch (error) {
      if (error instanceof SignedOutError) {
        await this.dispatch({ type: "blocked", by: "auth" });
        return;
      }
      if (isTransient(error)) return this.waitOut(error);
      return this.failWith(error);
    }
    return this.finalize();
  }

  /**
   * Sending failed after the API client's own retries. A network error shows "You're offline"; an
   * answer from Scouty that it cannot take the capture right now (408, 429, 502, 503, 504) shows
   * "Scouty isn't responding" and is tried again on its own after a wait (the server's
   * Retry-After when longer), for as long as this browser keeps the capture.
   */
  private async waitOut(error: unknown): Promise<void> {
    if (!(error instanceof ApiError)) {
      // No timer: the next try comes from the alarm (which also wakes a stopped background), Try
      // now, the browser's `online` event, or the popup or the overlay asking for the state after
      // OFFLINE_RETRY_MS (retryIfDue).
      const retryAt = this.deps.now() + OFFLINE_RETRY_MS;
      await this.dispatch({ type: "blocked", by: "offline", retryAt });
      // A second offline wait has the same key as the first: set the alarm for its end.
      await this.syncWake();
      return;
    }
    const wait = Math.max(SERVER_RETRY_MS, error.retryAfterMs ?? 0);
    await this.dispatch({ type: "blocked", by: "server", retryAt: this.deps.now() + wait, rateLimited: error.status === 429 });
    await this.scheduleRetry(wait);
  }

  /**
   * A timer for while the background stays awake (an alarm fires no sooner than 30 s in Chromium, 1 minute on Chrome 116-119),
   * and an alarm for when it does not: a stopped service worker or event page loses the timer.
   */
  private async scheduleRetry(ms: number): Promise<void> {
    await this.syncWake();
    void this.deps.sleep(ms).then(() => this.retryIfDue());
  }

  /**
   * Tries again when sending waits on Scouty or on the network and the wait is over. Called by the
   * timer (server only) and the alarm (both), on a restart of the background context, whenever the
   * popup or the overlay asks for the state, and when the browser reports the network back
   * (`online`: then "You're offline" does not wait out its 15 s; a server wait still does). An
   * alarm that went off before the wait was over is set again for its end.
   */
  retryIfDue(options: { online?: boolean; alarm?: boolean } = {}): Promise<void> {
    return this.enqueue(async () => {
      await this.ready();
      return this.retryNowIfDue(options);
    });
  }

  private async retryNowIfDue(options: { online?: boolean; alarm?: boolean }): Promise<void> {
    const state = this.state;
    if (state.phase !== "finalizing" || (state.blocked !== "server" && state.blocked !== "offline")) {
      // The alarm went off while sending, waiting for sign-in or reading: set it again.
      if (options.alarm) await this.syncWake();
      return;
    }
    const waitOver = (state.retryAt ?? 0) <= this.deps.now();
    if (!waitOver && !(options.online && state.blocked === "offline")) {
      if (options.alarm) await this.syncWake();
      return;
    }
    return this.resumeNow();
  }

  /**
   * The retry alarm went off (it may have started this background). The alarm is set again at once,
   * outside the queue, in case a send in flight holds the queue and the background stops during it.
   * Then, in order: a capture whose time ran out ends ("This capture timed out") and its outbox is
   * deleted, an outbox left without a capture that ran out is deleted, and a due wait is tried again.
   */
  alarmFired(): Promise<void> {
    void this.ready().then(() => this.syncWake());
    return this.enqueue(async () => {
      await this.ready();
      if (await this.expireIfDue()) return;
      if (await outbox.purgeIfExpired(this.deps.now())) {
        this.deps.wake.clear();
        return;
      }
      return this.retryNowIfDue({ alarm: true });
    });
  }

  /** Called when the background context starts: pick up whatever a restart interrupted. */
  recover(): Promise<void> {
    return this.enqueue(async () => {
      await this.ready();
      if (await this.expireIfDue()) return;
      // An older version kept no alarm while sending or waiting for sign-in: set it now.
      await this.syncWake();
      const state = this.state;
      if (state.phase === "starting" || state.phase === "stopped") return this.fail({ kind: "failed" });
      if (state.phase === "finalizing" && !state.blocked) {
        // Straight back to sending: no "You're offline" in between, the network may be fine.
        void this.resume();
        return;
      }
      if (state.phase === "finalizing" && state.blocked === "offline") {
        // The alarm is set (above); try if the wait is over.
        void this.retryIfDue();
        return;
      }
      if (state.phase === "finalizing" && state.blocked === "server") {
        // A restart lost the timer: try now if the wait is over, else when it is.
        const left = (state.retryAt ?? 0) - this.deps.now();
        if (left > 0) await this.scheduleRetry(left);
        else void this.retryIfDue();
        return;
      }
      if (state.phase === "running" && !this.aux.readerActive) {
        this.aux.navigating = false;
        return this.readCurrent(true);
      }
      if (state.phase === "running") {
        // A reader was at work when the context stopped: watch it from now on.
        this.readerSeenAt = this.deps.now();
        this.watch(state.section, this.aux.seq[state.section] ?? 1);
      }
    });
  }

  dismiss(): Promise<void> {
    return this.enqueue(async () => {
      await this.ready();
      if (await this.dispatch({ type: "dismiss" })) {
        this.aux = freshAux();
        await this.saveAux();
      }
    });
  }

  /** Disconnect, or a browser start: nothing of a capture is kept. */
  reset(): Promise<void> {
    return this.enqueue(async () => {
      await this.ready();
      await outbox.clear();
      this.aux = freshAux();
      await this.saveAux();
      this.deps.wake.clear();
      this.state = IDLE;
      await this.deps.store.set(STATE_KEY, IDLE);
      this.deps.changed(IDLE);
    });
  }

  /** The connection to Scouty ended (refresh failed, grant revoked). A capture in flight waits for a reconnect. */
  connectionEnded(): Promise<void> {
    return (async () => {
      await this.ready();
      if (this.state.phase === "idle" || this.state.phase === "done") await outbox.clear();
    })();
  }
}

function clampCaps(created: CreateCreated): CreateCreated {
  // A positive cap is at least 1 (a fractional 0.5 is not "nothing"); 0 or less stays 0, which Scouty
  // never lists as expected.
  const clamp = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? (value > 0 ? Math.max(1, Math.min(HARD_LIMITS.maxCap, Math.floor(value))) : 0) : HARD_LIMITS.defaultCap);
  return { ...created, caps: { posts: clamp(created.caps?.posts), comments: clamp(created.caps?.comments), reactions: clamp(created.caps?.reactions) } };
}

/**
 * Why the tab is no longer on the capture's pages. A sign-in or security-check address of the site
 * (visible to the extension) keeps that page state; anything else (another site, an address the
 * extension cannot see, another page of the site) is "left the page".
 */
function leftReason(url: string | undefined): StopReason {
  if (!url) return "left_linkedin";
  try {
    const at = new URL(url);
    if (at.origin === LINKEDIN_ORIGIN) return pageStateFromPath(at.pathname) ?? "left_linkedin";
  } catch {
    // not an address: left
  }
  return "left_linkedin";
}

function samePage(actual: string, expected: string): boolean {
  try {
    const a = new URL(actual);
    const b = new URL(expected);
    const path = (p: string): string => decodeURIComponent(p).toLowerCase().replace(/\/+$/, "");
    return a.origin === b.origin && path(a.pathname) === path(b.pathname);
  } catch {
    return false;
  }
}

/** What the retry alarm's time depends on: a change of it sets the alarm again (syncWake). */
function wakeKey(state: CaptureState): string {
  if (state.phase !== "finalizing") return state.phase;
  return `finalizing:${state.blocked ?? "sending"}:${state.retryAt ?? ""}`;
}

/** Sending waits for a time to try again: on Scouty ("server") or on the network ("offline"). */
function waitsToRetry(state: CaptureState): boolean {
  return state.phase === "finalizing" && (state.blocked === "server" || state.blocked === "offline");
}

/**
 * An error the capture waits out instead of ending: a network error ("You're offline"), or a status
 * the API client retries (408, 429, 502, 503, 504; not LINKEDIN_DISABLED), which shows "Scouty isn't
 * answering right now". A 500 or any other 5xx is terminal and ends in "failed".
 */
export function isTransient(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  return error instanceof ApiError && isRetryableStatus(error);
}

/** One clear sentence per terminal error (plan 5.5, 12.4). */
export function noticeFor(error: unknown, creating = false, now: number = Date.now()): Notice {
  if (error instanceof ApiError) {
    if (error.status === 426) {
      return { kind: "outdated", storeUrl: storeUrlFrom(error.body?.storeUrl) };
    }
    if (error.code === "LINKEDIN_NOT_AVAILABLE" || error.code === "LINKEDIN_DISABLED") return { kind: "notAvailable" };
    if (error.code === "LINKEDIN_CAPTURE_LIMIT") {
      const resetAt = error.retryAfterMs !== null ? new Date(now + error.retryAfterMs).toISOString() : null;
      return { kind: "limit", resetAt };
    }
    // Scouty answered but could not start it now (the retries are spent): not a failure of this capture.
    if (creating && isRetryableStatus(error)) {
      const retryAt = error.status === 429 && error.retryAfterMs !== null ? new Date(now + error.retryAfterMs).toISOString() : null;
      return { kind: "notAnswering", retryAt };
    }
    // A 404 when creating means the server refuses this profile; it does not say why.
    if (error.status === 404 && creating) return { kind: "suppressed" };
    // A 404 on a capture this extension holds: either a newer create of the same profile from another
    // browser or device was handed this capture with a new upload token (plan 5.5), or the capture was
    // removed in Scouty. Either way ours no longer opens it.
    if (error.status === 404) return { kind: "takenOver" };
    // A capture this extension holds ran out of time by Scouty's clock: status, section PUT or
    // finalize. Not expected on create (a create starts a new window), so there it stays "failed".
    if (!creating && (error.status === 410 || error.code === "LINKEDIN_CAPTURE_EXPIRED")) return { kind: "expired" };
  }
  return { kind: "failed" };
}
