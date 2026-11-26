// The background's message gate: who may ask for what. Kept apart from index.ts so it can be tested
// with fakes; index.ts wires it to the real controller and screens.
import { ext } from "../ext";
import type { Message, UiAction } from "../messages";
import type { UiState } from "../ui/state";
import { devRequest } from "./dev-log";
import type { CaptureController, CaptureState } from "./session";

/** What the overlay in the LinkedIn tab may ask for. Everything else comes from the popup only. */
export const OVERLAY_ACTIONS: readonly UiAction[] = ["stop", "dismiss", "openAnalysis", "retryNow", "captureAgain", "capture", "connect", "openScouty", "openStore"];

export type Sender = { id?: string; url?: string; tab?: { id?: number } };

export type GateDeps = {
  controller: Pick<CaptureController, "current" | "retryIfDue" | "readerHello" | "readerProgress" | "readerResult">;
  /**
   * The tab the overlay was last sent to, kept in storage.session (src/background/capture-tab.ts) so
   * a restarted background still knows it while an idle notice, which has no tab id, is shown.
   */
  captureTab: () => Promise<number | null>;
  overlayState: (state: CaptureState, tabId: number) => Promise<UiState | null>;
  popupState: (tabId: number | null, settings: boolean) => Promise<unknown>;
  act: (action: UiAction, tabId: number | null) => Promise<void>;
};

/** Answers one runtime message, or null when the sender may not ask for it. */
export function createGate(deps: GateDeps): (message: Message, sender: Sender) => Promise<unknown> {
  const { controller } = deps;
  /** The overlay in this tab shows the capture: its own tab, or the tab its last screen (an idle notice) went to. */
  const owns = async (state: CaptureState, tabId: number): Promise<boolean> =>
    ("tabId" in state && state.tabId === tabId) || (await deps.captureTab()) === tabId;
  return async function handle(message, sender) {
    if (sender.id !== ext.runtime.id) return null;
    const fromPage = typeof sender.url === "string" && sender.url.startsWith(ext.runtime.getURL(""));
    if (__SCOUTY_DEV__ && fromPage) {
      const dev = devRequest(message);
      if (dev) return dev;
    }
    const senderTab = sender.tab?.id ?? null;
    // A capture waiting on Scouty is tried again whenever the popup or the overlay asks for the state
    // and its wait is over, in case a stopped background context lost the timer.
    if (message.type === "ui:getState" || message.type === "overlay:hello") void controller.retryIfDue();
    switch (message.type) {
      case "reader:hello": return fromPage ? null : controller.readerHello(senderTab);
      case "reader:progress": return fromPage ? null : controller.readerProgress(senderTab, message.section, message.count);
      case "reader:result":
        if (!fromPage) await controller.readerResult(senderTab, message.section, message.seq, message.result);
        return null;
      case "overlay:hello": {
        if (fromPage || senderTab === null) return null;
        const state = await controller.current();
        if (!(await owns(state, senderTab))) return null;
        return deps.overlayState(state, senderTab);
      }
      case "ui:getState":
        if (!fromPage) return null;
        return deps.popupState(message.tabId, message.settings);
      case "ui:action": {
        if (!fromPage) {
          if (senderTab === null || !OVERLAY_ACTIONS.includes(message.action)) return null;
          if (!(await owns(await controller.current(), senderTab))) return null;
          await deps.act(message.action, senderTab);
          return null;
        }
        await deps.act(message.action, message.tabId);
        return null;
      }
      default: return null;
    }
  };
}
