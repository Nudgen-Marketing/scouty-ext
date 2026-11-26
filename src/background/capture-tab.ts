// The tab whose overlay shows the capture's screens, kept in storage.session (deviation 28). An idle
// notice ("This capture timed out", "failed"…) carries no tab id, so a background that restarted while
// such a screen was shown would otherwise not know where it is: the gate refused that overlay's
// buttons and nothing redrew it. storage.session is cleared when the browser or the extension
// restarts, when a tab id means nothing any more.
import { ext } from "../ext";

export const CAPTURE_TAB_KEY = "capture.overlayTab";

/** The capture tab, or null when no capture screen is shown in a tab. */
export async function captureTab(): Promise<number | null> {
  try {
    const value = (await ext.storage.session.get(CAPTURE_TAB_KEY))[CAPTURE_TAB_KEY];
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}

/** Remembers the capture tab (null: none), writing only when it changes. */
export async function setCaptureTab(tabId: number | null): Promise<void> {
  try {
    if ((await captureTab()) === tabId) return;
    if (tabId === null) await ext.storage.session.remove(CAPTURE_TAB_KEY);
    else await ext.storage.session.set({ [CAPTURE_TAB_KEY]: tabId });
  } catch {
    // No storage: the overlay's own state still comes from the capture while it has a tab.
  }
}
