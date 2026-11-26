// Background entry: listeners only, all registered at top level so a restarted service worker
// (Chromium) or event page (Firefox) is woken by the next event and picks up where it was.
import { LINKEDIN_ORIGIN, PRIVACY_URL } from "../config";
import { singleFlight } from "./single-flight";
import { ext } from "../ext";
import type { Message, UiAction } from "../messages";
import { profileFromUrl } from "../profile-key";
import type { UiState } from "../ui/state";
import { createApi } from "./api";
import { appUrl, openAppPage, recentAppUrl } from "./app-tab";
import * as auth from "./auth";
import { captureTab, setCaptureTab } from "./capture-tab";
import { recordCapture } from "./dev-log";
import { createGate } from "./gate";
import * as outbox from "./outbox";
import { CaptureController, type CaptureState } from "./session";
import { storeUrlFrom } from "./store-url";
import { deferUpdates } from "./update";
import { clearWake, onWake, wakeAt } from "./wake";
import { captureUi, forgetSessionInfo, giveConsent, popupUi, sessionInfo, startCapture, targetIsProfile, type UiContext } from "./ui-state";

const api = createApi(auth.tokenSource);
let connecting = false;
/** Applies a waiting extension update once no capture is in progress (src/background/update.ts). */
let updateIfIdle: ((state: CaptureState) => Promise<void>) | null = null;

const controller = new CaptureController({
  api,
  tabs: {
    async get(tabId) {
      try {
        const tab = await ext.tabs.get(tabId);
        return { url: tab.url, status: tab.status };
      } catch {
        return null;
      }
    },
    async update(tabId, url) {
      await ext.tabs.update(tabId, { url });
    },
  },
  async inject(tabId, file) {
    try {
      await ext.scripting.executeScript({ target: { tabId }, files: [file] });
      return true;
    } catch {
      return false;
    }
  },
  async readerAlive(tabId) {
    // Runs in the reader's own isolated world: its busy flag is there only while a reader works in
    // the tab's current document (a reload drops it).
    try {
      const [first] = await ext.scripting.executeScript({
        target: { tabId },
        func: () => (globalThis as unknown as { __scoutyReaderBusy?: boolean }).__scoutyReaderBusy === true,
      });
      return first?.result === true;
    } catch {
      return false;
    }
  },
  store: {
    get: async (key) => (await ext.storage.session.get(key))[key],
    set: (key, value) => ext.storage.session.set({ [key]: value }),
    remove: (key) => ext.storage.session.remove(key),
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  wake: { at: wakeAt, clear: clearWake },
  now: Date.now,
  uuid: () => crypto.randomUUID(),
  changed: (state) => void broadcast(state),
});

const ui: UiContext = { api, controller, connecting: () => connecting, now: Date.now };

async function workspaceName(): Promise<string> {
  const info = await sessionInfo(ui);
  return info && "workspace" in info ? (info.workspace.name ?? "") : "";
}

/** The overlay's screen in its tab; a capture action there starts in that tab, so it needs a profile too. */
async function overlayState(state: CaptureState, tabId: number): Promise<UiState | null> {
  const extras = await controller.extras();
  const view = captureUi(state, { minutesLeft: extras.minutesLeft }, await workspaceName(), Date.now());
  if (view?.kind === "capturing") await controller.noteMinutesLeft(view.minutesLeft);
  return view ? { ...view, onProfile: await targetIsProfile(state, tabId, await tabUrl(tabId)) } : null;
}

/** Tells the popup (if open) and the overlay in the capture tab to redraw. */
async function broadcast(state: CaptureState): Promise<void> {
  void updateIfIdle?.(state);
  ext.runtime.sendMessage({ type: "ui:changed" } satisfies Message).catch(() => undefined);
  // The capture tab is kept in storage.session: an idle notice has no tab id, and a restarted
  // background must still redraw that tab's overlay (src/background/capture-tab.ts).
  let tab: number | null;
  if ("tabId" in state) {
    tab = state.tabId;
    await setCaptureTab(tab);
  } else if (state.notice?.kind === "recent") {
    tab = null;
    await setCaptureTab(null);
  } else {
    tab = await captureTab();
  }
  if (tab === null) return;
  // Development builds keep what the reader pressed for validation, outside every screen.
  if (__SCOUTY_DEV__ && state.phase === "done") {
    const url = await tabUrl(state.tabId);
    void recordCapture(state.result.appUrl, profileFromUrl(url, LINKEDIN_ORIGIN)?.key ?? "", (await controller.extras()).clickLog);
  }
  const view = await overlayState(state, tab);
  const message: Message = view ? { type: "overlay:state", state: view } : { type: "overlay:remove" };
  ext.tabs.sendMessage(tab, message).catch(() => undefined);
}

/** Only pages of the Scouty app are ever opened (appUrl in app-tab.ts), plus the add-on store page the server names (store-url.ts). */
function open(url: string): void {
  void ext.tabs.create({ url });
}

/** An app page: back in the Scouty tab the user came from when there is one (src/background/app-tab.ts). */
function openApp(url: string, linkedinTabId: number | null): void {
  void openAppPage(url, linkedinTabId);
}

async function tabUrl(tabId: number | null): Promise<string | null> {
  if (tabId === null) return null;
  try {
    return (await ext.tabs.get(tabId)).url ?? null;
  } catch {
    return null;
  }
}

async function connect(options: { create?: boolean } = {}): Promise<void> {
  if (connecting) return;
  connecting = true;
  void broadcast(await controller.current());
  try {
    await auth.connect(options);
    await forgetSessionInfo();
    const state = await controller.current();
    if (state.phase === "finalizing" && state.blocked === "auth") void controller.resume();
  } catch {
    // Cancelled, closed or refused: the popup shows Connect again.
  } finally {
    connecting = false;
    void broadcast(await controller.current());
  }
}

/**
 * One disconnect at a time: a sign-out can wait up to about 50 s (a refresh in flight, then the
 * revoke, each bounded by the request timeout), and a second press meanwhile joins it.
 */
const disconnect = singleFlight(async () => {
  await auth.signOut();
  await forgetSessionInfo();
  await controller.reset();
});

async function capture(tabId: number | null, recapture: boolean): Promise<void> {
  await startCapture(controller, tabId, recapture, tabUrl);
}

async function act(action: UiAction, tabId: number | null): Promise<void> {
  const state = await controller.current();
  switch (action) {
    case "connect": void connect(); return;
    case "signUp": void connect({ create: true }); return;
    case "cancelConnect":
      auth.cancelConnect();
      connecting = false;
      void broadcast(state);
      return;
    case "acceptConsent": await giveConsent(); return capture(tabId, false);
    case "capture": return capture(tabId, false);
    case "captureAgain": return capture(tabId, true);
    case "stop": return controller.userStop();
    case "dismiss": return controller.dismiss();
    case "retryNow": return controller.resume();
    case "openAnalysis": {
      const linkedinTab = "tabId" in state ? state.tabId : tabId;
      if (state.phase === "done") return openApp(appUrl(state.result.appUrl), linkedinTab);
      if (state.phase === "idle" && state.notice?.kind === "recent") return openApp(recentAppUrl(state.notice), linkedinTab);
      return openApp(appUrl(null), linkedinTab);
    }
    case "openScouty": return openApp(appUrl(null), "tabId" in state ? state.tabId : tabId);
    case "whatItReads": return open(PRIVACY_URL);
    case "openStore": {
      const info = await sessionInfo(ui, true);
      const fromNotice = state.phase === "idle" && state.notice?.kind === "outdated" ? storeUrlFrom(state.notice.storeUrl) : null;
      const fromInfo = info && "kind" in info && info.kind === "outdated" ? storeUrlFrom(info.storeUrl) : null;
      return open(fromNotice ?? fromInfo ?? appUrl(null));
    }
    case "showCapture":
      if ("tabId" in state) await ext.tabs.update(state.tabId, { active: true }).catch(() => undefined);
      return;
    case "disconnect": return disconnect();
    case "switchWorkspace": await disconnect(); void connect(); return;
    default: return;
  }
}

const handle = createGate({
  controller,
  captureTab,
  overlayState,
  popupState: async (tabId, settings) => popupUi(ui, { tabId, tabUrl: await tabUrl(tabId), settings }),
  act,
});

function listen(): void {
  auth.onConnectionEnded(async () => {
    await forgetSessionInfo();
    await controller.connectionEnded();
    void broadcast(await controller.current());
  });

  ext.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
    handle(message, sender).then(sendResponse, () => sendResponse(null));
    return true;
  });
  ext.tabs.onRemoved.addListener((tabId) => void controller.tabRemoved(tabId));
  ext.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === "complete") void controller.tabLoaded(tabId);
  });
  // A browser start never finds a capture from the previous run.
  ext.runtime.onStartup.addListener(() => void outbox.purgeOnStartup().then(() => controller.reset()));
  ext.runtime.onInstalled.addListener(() => void auth.hardenStorage());
  // An update waits while a capture is in progress (a reload would clear it) or sign-in is under way, then reloads.
  updateIfIdle = deferUpdates(() => controller.current(), { connecting: () => connecting });
  // "You're offline" is tried again as soon as the browser says the network is back (while this
  // background context is awake; otherwise when the popup or the overlay next asks, deviation 8).
  self.addEventListener("online", () => void controller.retryIfDue({ online: true }));
  // The retry alarm wakes a stopped background to try sending again (deviation 8), and to delete a
  // capture whose time ran out, also while it waits for sign-in (deviation 28).
  onWake(() => void controller.alarmFired());

  void auth.hardenStorage();
  void outbox.purgeIfExpired(Date.now()).then(() => controller.recover()).then(async () => updateIfIdle?.(await controller.current()));
}

if (__SCOUTY_ENTRY__) listen();
