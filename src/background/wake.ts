// One alarm that wakes the background to try sending again (deviation 8). A timer does not outlive a
// Chromium service worker or a Firefox event page, which stop after about 30 s idle; an alarm does,
// and its event starts the background again. The `alarms` permission shows no install warning.
// Chromium fires an alarm no sooner than 30 s after it was set on Chrome 120 and later, and no sooner
// than 1 minute on Chrome 116-119 (minimum_chrome_version is 116); the in-memory timer still covers a
// shorter wait while the background is awake.
import { ext } from "../ext";

export const RETRY_ALARM = "scouty.retry";

/** Wakes the background at `when` (ms since the epoch). Setting it again replaces the earlier time. */
export function wakeAt(when: number): void {
  try {
    // Chromium returns a promise; Firefox returns nothing.
    void Promise.resolve(ext.alarms.create(RETRY_ALARM, { when })).catch(() => undefined);
  } catch {
    // No alarm: the overlay's asks, the popup and a restart still try again.
  }
}

/** No more wake: nothing is waiting to be sent. */
export function clearWake(): void {
  try {
    void Promise.resolve(ext.alarms.clear(RETRY_ALARM)).catch(() => undefined);
  } catch {
    // Nothing to clear.
  }
}

/** Calls `fn` when the retry alarm goes off. Registered at top level so the alarm wakes the background. */
export function onWake(fn: () => void): void {
  ext.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RETRY_ALARM) fn();
  });
}
