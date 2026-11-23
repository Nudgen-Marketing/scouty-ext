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
import { sectionPaths } from "../reader/selectors";
import type { SectionLine } from "../ui/state";
import { ApiError, NetworkError, SignedOutError, type Api, type CaptureRef } from "./api";
import * as outbox from "./outbox";

export type Notice =
  | { kind: "recent"; finalizedAt: string; tabId: number; url: string }
  | { kind: "outdated"; storeUrl: string | null }
  | { kind: "notAvailable" }
  | { kind: "limit"; resetAt: string | null }
  | { kind: "suppressed" }
  | { kind: "failed" };

export type DoneResult = {
  completeness: Completeness; captured: Counts; appUrl: string;
  stop: StopReason | null; address: string | null; sections: SectionLine[]; notExpanded: boolean;
};

export type CaptureState =
  | { phase: "idle"; notice: Notice | null }
  | { phase: "starting"; tabId: number; profileKey: string }
  | { phase: "running"; tabId: number; profileKey: string; section: SectionName; count: number; loading: boolean; expected: SectionName[]; caps: Caps; finished: SectionName[] }
  | { phase: "stopped"; tabId: number; reason: StopReason; address: string | null }
  | { phase: "finalizing"; tabId: number; stop: StopReason | null; address: string | null; blocked: null | "offline" | "auth"; slow: boolean }
  | { phase: "done"; tabId: number; result: DoneResult };

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
  | { type: "blocked"; by: "offline" | "auth" }
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
      if (event.type === "expired") return IDLE;
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
      if (event.type === "expired") return IDLE;
      return null;
    case "stopped":
      if (event.type === "settled") return { phase: "finalizing", tabId: state.tabId, stop: state.reason, address: state.address, blocked: null, slow: false };
      if (event.type === "failed") return { phase: "idle", notice: event.notice };
      if (event.type === "expired") return IDLE;
      return null;
    case "finalizing":
      if (event.type === "blocked") return { ...state, blocked: event.by };
      if (event.type === "slow") return { ...state, slow: true };
      if (event.type === "resume") return state.blocked ? { ...state, blocked: null, slow: false } : null;
      if (event.type === "finalized") return { phase: "done", tabId: state.tabId, result: event.result };
      if (event.type === "failed") return { phase: "idle", notice: event.notice };
      if (event.type === "expired") return IDLE;
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
  store: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; remove(key: string): Promise<void> };
  sleep(ms: number): Promise<void>;
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
};
const freshAux = (): Aux => ({ stopRequested: false, readerActive: false, navigating: false, seq: {}, deferred: false, clickLog: [], notExpanded: false, degraded: [], minutesLeft: null });

const STATE_KEY = "capture.state";
const AUX_KEY = "capture.aux";
const LOAD_POLL_MS = 250;
const LOAD_TIMEOUT_MS = 30_000;
const STOP_GRACE_MS = 6000;

export type StartOutcome = "started" | "busy" | "not_profile";

export class CaptureController {
  private state: CaptureState = IDLE;
  private aux: Aux = freshAux();
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();

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
    this.state = next;
    await this.deps.store.set(STATE_KEY, next);
    this.deps.changed(next);
    return true;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Expiry is checked lazily, by every handler, not by a timer. */
  private async expireIfDue(): Promise<boolean> {
    if (this.state.phase === "idle" || this.state.phase === "done" || this.state.phase === "starting") return false;
    const box = await outbox.load();
    if (box && box.expiresAt > this.deps.now()) return false;
    await outbox.clear();
    this.aux = freshAux();
    await this.saveAux();
    await this.dispatch({ type: "expired" });
    return true;
  }

  private async fail(notice: Notice | null): Promise<void> {
    await outbox.clear();
    this.aux = freshAux();
    await this.saveAux();
    await this.dispatch({ type: "failed", notice });
  }

  private async failWith(error: unknown, creating = false): Promise<void> {
    await this.fail(noticeFor(error, creating));
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
          await this.dispatch({ type: "recent", notice: { kind: "recent", finalizedAt: answer.recent.finalizedAt, tabId: input.tabId, url: input.url } });
          return "started";
        }
        if (answer.profileKey !== profile.key || answer.expected.length === 0) {
          await this.fail({ kind: "failed" });
          return "started";
        }
        await outbox.begin(clampCaps(answer));
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

  private async waitForLoad(tabId: number): Promise<{ kind: "loaded"; url: string } | { kind: "closed" } | { kind: "left" } | { kind: "stop" }> {
    const deadline = this.deps.now() + LOAD_TIMEOUT_MS;
    for (;;) {
      const tab = await this.deps.tabs.get(tabId);
      if (!tab) return { kind: "closed" };
      if (this.aux.stopRequested) return { kind: "stop" };
      if (tab.status === "complete") return tab.url ? { kind: "loaded", url: tab.url } : { kind: "left" };
      if (this.deps.now() >= deadline) return { kind: "left" };
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
    try {
      if (navigate) await this.deps.tabs.update(state.tabId, expectedUrl);
    } catch {
      return this.stop("tab_closed", null);
    }
    const loaded = await this.waitForLoad(state.tabId);
    this.aux.navigating = false;
    await this.saveAux();
    if (loaded.kind === "closed") return this.stop("tab_closed", null);
    if (loaded.kind === "stop") return this.stop("user_stopped", null);
    if (loaded.kind === "left") return this.stop("left_linkedin", null);
    // Target check before every read.
    const profile = profileFromUrl(loaded.url, LINKEDIN_ORIGIN);
    if (!profile) return this.stop("left_linkedin", null);
    if (profile.key !== state.profileKey) return this.stop("wrong_profile", profile.url);
    if (!samePage(loaded.url, expectedUrl)) {
      // LinkedIn sent the tab somewhere else on this profile: the profile has no such page.
      await outbox.declare(state.section, { state: "unavailable", reason: "no_such_section" });
      return this.advance(state.section);
    }
    await this.deps.inject(state.tabId, "overlay.js");
    this.aux.seq[state.section] = (this.aux.seq[state.section] ?? 0) + 1;
    this.aux.readerActive = true;
    await this.saveAux();
    if (!(await this.deps.inject(state.tabId, "reader.js"))) return this.stop("permission_missing", null);
    await this.dispatch({ type: "loaded" });
  }

  /** The reader asks what to read. Only the capture tab, in the running state, gets an answer. */
  async readerHello(tabId: number | null): Promise<{ args: ReaderArgs | null }> {
    await this.ready();
    const state = this.state;
    if (state.phase !== "running" || tabId !== state.tabId || !this.aux.readerActive) return { args: null };
    const cap = ACTIVITY_SECTIONS.includes(state.section) ? state.caps[state.section as keyof Caps] : 0;
    return { args: { section: state.section, profileKey: state.profileKey, seq: this.aux.seq[state.section] ?? 1, cap, browser: BROWSER } };
  }

  async readerProgress(tabId: number | null, section: SectionName, count: number): Promise<{ stop: boolean }> {
    await this.ready();
    if (await this.expireIfDue()) return { stop: true };
    const state = this.state;
    if (state.phase !== "running" || tabId !== state.tabId) return { stop: true };
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
      await this.deps.api.putSection(ref, { section, body, digestBase64: entry.digestBase64 });
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
      if (!profile) return this.stop("left_linkedin", null);
      if (profile.key !== state.profileKey) return this.stop("wrong_profile", profile.url);
      const expectedUrl = sectionUrl(LINKEDIN_ORIGIN, state.profileKey, sectionPaths[state.section]);
      if (!samePage(tab.url ?? "", expectedUrl)) return this.stop("left_linkedin", null);
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
          await this.deps.api.putSection(ref, { section: entry.section, body, digestBase64: entry.digestBase64 }, onRetry);
          await outbox.ack(entry.section, entry.sha256);
        }
        this.aux.deferred = false;
        await this.saveAux();
        const request = await outbox.finalizeRequest(this.deps.uuid);
        if (!request) return this.fail({ kind: "failed" });
        const answer = await this.deps.api.finalize(ref, request.manifest, request.key, onRetry);
        const result = await this.resultFrom(answer, state.stop, state.address);
        await outbox.clear();
        await this.dispatch({ type: "finalized", result });
        return;
      } catch (error) {
        if (error instanceof SignedOutError) {
          await this.dispatch({ type: "blocked", by: "auth" });
          return;
        }
        if (isTransient(error)) {
          await this.dispatch({ type: "blocked", by: "offline" });
          return;
        }
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
    return this.enqueue(async () => {
      await this.ready();
      if (await this.expireIfDue()) return;
      if (this.state.phase !== "finalizing") return;
      await this.dispatch({ type: "resume" });
      const ref = await this.captureRef();
      const box = await outbox.load();
      if (!ref || !box) return this.fail({ kind: "failed" });
      try {
        const status = await this.deps.api.status(ref);
        for (const entry of box.sections) {
          const held = status.received.find((r) => r.section === entry.section);
          if (held && held.seq === entry.seq && held.sha256 === entry.sha256) await outbox.ack(entry.section, entry.sha256);
          else await outbox.unack(entry.section);
        }
      } catch (error) {
        if (error instanceof SignedOutError) {
          await this.dispatch({ type: "blocked", by: "auth" });
          return;
        }
        if (isTransient(error)) {
          await this.dispatch({ type: "blocked", by: "offline" });
          return;
        }
        return this.failWith(error);
      }
      return this.finalize();
    });
  }

  /** Called when the background context starts: pick up whatever a restart interrupted. */
  recover(): Promise<void> {
    return this.enqueue(async () => {
      await this.ready();
      if (await this.expireIfDue()) return;
      const state = this.state;
      if (state.phase === "starting" || state.phase === "stopped") return this.fail({ kind: "failed" });
      if (state.phase === "finalizing" && !state.blocked) {
        await this.dispatch({ type: "blocked", by: "offline" });
        void this.resume();
        return;
      }
      if (state.phase === "running" && !this.aux.readerActive) {
        this.aux.navigating = false;
        return this.readCurrent(true);
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
  const clamp = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(HARD_LIMITS.maxCap, Math.floor(value))) : HARD_LIMITS.defaultCap);
  return { ...created, caps: { posts: clamp(created.caps?.posts), comments: clamp(created.caps?.comments), reactions: clamp(created.caps?.reactions) } };
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

function isTransient(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  return error instanceof ApiError && (error.status === 408 || error.status === 429 || error.status >= 500);
}

/** One clear sentence per terminal error (plan 5.5, 12.4). */
export function noticeFor(error: unknown, creating = false): Notice {
  if (error instanceof ApiError) {
    if (error.status === 426) {
      const store = error.body?.storeUrl;
      return { kind: "outdated", storeUrl: typeof store === "string" && store.startsWith("https://") ? store : null };
    }
    if (error.code === "LINKEDIN_NOT_AVAILABLE" || error.code === "LINKEDIN_DISABLED") return { kind: "notAvailable" };
    if (error.code === "LINKEDIN_CAPTURE_LIMIT") {
      const resetAt = error.retryAfterMs !== null ? new Date(Date.now() + error.retryAfterMs).toISOString() : null;
      return { kind: "limit", resetAt };
    }
    // A 404 when creating means the server refuses this profile; it does not say why.
    if (error.status === 404 && creating) return { kind: "suppressed" };
  }
  return { kind: "failed" };
}
