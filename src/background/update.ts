// An extension update reloads the extension, and a reload clears storage.session, where a capture in
// progress lives (outbox, state). Listening to `runtime.onUpdateAvailable` defers the update: it is
// applied by `runtime.reload()` once no capture is in progress (the idle phase), at once if none is.
// Firefox then waits for that reload (or a browser restart). Chromium also applies a deferred update
// when its service worker stops after about 30 s idle, which this cannot prevent (DEVIATIONS 26).
import { ext } from "../ext";
import type { CaptureState } from "./session";

/** Kept in storage.session so a stopped background that starts again still knows (an update clears it). */
export const UPDATE_KEY = "update.pending";
/** When a finished capture's screen (the done phase) was first seen, also in storage.session. */
export const DONE_SINCE_KEY = "update.doneSince";
/**
 * How long a finished capture's screen holds an update. The done screen stays until the user closes
 * it, and Firefox applies an update only when told, so without a bound the update could wait forever.
 */
export const DONE_HOLD_MS = 30 * 60_000;

export type HoldContext = {
  /** Sign-in is in progress (the browser's sign-in window is open): a reload would cancel it. */
  connecting?: boolean;
  /** When the done phase was first seen; with `now`, the done screen holds for DONE_HOLD_MS only. */
  doneSince?: number | null;
  now?: number;
};

/** A capture is in progress, sign-in is under way, or a capture's result has been on screen under 30 minutes: an update waits. */
export function holdsUpdate(state: CaptureState, context: HoldContext = {}): boolean {
  if (context.connecting) return true;
  if (state.phase === "idle") return false;
  if (state.phase === "done" && context.doneSince != null && context.now !== undefined) return context.now - context.doneSince < DONE_HOLD_MS;
  return true;
}

export type DeferOptions = {
  /** Whether sign-in is in progress (index.ts `connecting`). */
  connecting?: () => boolean;
  now?: () => number;
  /** Runs `fn` after `ms` while the background is awake (default setTimeout). */
  later?: (fn: () => void, ms: number) => void;
};

/**
 * Listens for an available update (at top level, so the event can wake the background) and returns
 * the function to call with every state: it reloads once nothing holds the update and an update waits.
 */
export function deferUpdates(current: () => Promise<CaptureState>, options: DeferOptions = {}): (state: CaptureState) => Promise<void> {
  const now = options.now ?? Date.now;
  const later = options.later ?? ((fn, ms) => void setTimeout(fn, ms));
  let pending: boolean | null = null;
  let doneSince: number | null | undefined;
  let timerFor: number | null = null;
  const isPending = async (): Promise<boolean> => {
    pending ??= (await ext.storage.session.get(UPDATE_KEY))[UPDATE_KEY] === true;
    return pending;
  };
  /** When the current done screen was first seen (kept across a background restart), or null when not done. */
  const doneSinceFor = async (state: CaptureState, at: number): Promise<number | null> => {
    if (state.phase !== "done") {
      if (doneSince !== null) {
        doneSince = null;
        await ext.storage.session.remove(DONE_SINCE_KEY);
      }
      return null;
    }
    if (typeof doneSince !== "number") {
      const stored = (await ext.storage.session.get(DONE_SINCE_KEY))[DONE_SINCE_KEY];
      doneSince = typeof stored === "number" ? stored : at;
      if (stored !== doneSince) await ext.storage.session.set({ [DONE_SINCE_KEY]: doneSince });
    }
    return doneSince;
  };
  const check = async (state: CaptureState): Promise<void> => {
    const at = now();
    const since = await doneSinceFor(state, at);
    if (!(await isPending())) return;
    if (holdsUpdate(state, { connecting: options.connecting?.() ?? false, doneSince: since, now: at })) {
      // A done screen stops holding after DONE_HOLD_MS: look again then (while awake; otherwise on the
      // next event that starts the background, which checks again).
      if (since !== null && timerFor !== since) {
        timerFor = since;
        later(() => void current().then(check), Math.max(0, since + DONE_HOLD_MS - at));
      }
      return;
    }
    ext.runtime.reload();
  };
  ext.runtime.onUpdateAvailable.addListener(() => {
    pending = true;
    void ext.storage.session.set({ [UPDATE_KEY]: true }).then(async () => check(await current()));
  });
  return check;
}
