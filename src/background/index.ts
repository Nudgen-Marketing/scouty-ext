// Background entry: listeners only, all registered at top level so a restarted service worker
// (Chromium) or event page (Firefox) is woken by the next event and picks up where it was.
import { API_ORIGIN, LINKEDIN_ORIGIN, PRIVACY_URL } from "../config";
import { ext } from "../ext";
import type { Message, UiAction } from "../messages";
import { profileFromUrl } from "../profile-key";
import type { UiState } from "../ui/state";
import { createApi } from "./api";
import * as auth from "./auth";
import * as outbox from "./outbox";
import { CaptureController, type CaptureState } from "./session";
import { captureUi, forgetSessionInfo, giveConsent, popupUi, sessionInfo, type UiContext } from "./ui-state";

const api = createApi(auth.tokenSource);
let connecting = false;
let captureTab: number | null = null;

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
  store: {
    get: async (key) => (await ext.storage.session.get(key))[key],
    set: (key, value) => ext.storage.session.set({ [key]: value }),
    remove: (key) => ext.storage.session.remove(key),
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
  uuid: () => crypto.randomUUID(),
  changed: (state) => void broadcast(state),
});

const ui: UiContext = { api, controller, connecting: () => connecting, now: Date.now };

async function workspaceName(): Promise<string> {
  const info = await sessionInfo(ui);
  return info && "workspace" in info ? (info.workspace.name ?? "") : "";
}

async function overlayState(state: CaptureState): Promise<UiState | null> {
  const extras = await controller.extras();
  return captureUi(state, { clickLog: extras.clickLog, minutesLeft: extras.minutesLeft }, await workspaceName(), Date.now());
}

/** Tells the popup (if open) and the overlay in the capture tab to redraw. */
async function broadcast(state: CaptureState): Promise<void> {
  ext.runtime.sendMessage({ type: "ui:changed" } satisfies Message).catch(() => undefined);
  if ("tabId" in state) captureTab = state.tabId;
  else if (state.notice?.kind === "recent") captureTab = null;
  if (captureTab === null) return;
  const view = await overlayState(state);
  const message: Message = view ? { type: "overlay:state", state: view, clickLog: null } : { type: "overlay:remove" };
  ext.tabs.sendMessage(captureTab, message).catch(() => undefined);
}

function open(url: string): void {
  void ext.tabs.create({ url });
}

/** Only pages of the Scouty app are ever opened, plus the store page the server names. */
function appUrl(candidate: string | null | undefined): string {
  return candidate && candidate.startsWith(`${API_ORIGIN}/`) ? candidate : `${API_ORIGIN}/`;
}

async function tabUrl(tabId: number | null): Promise<string | null> {
  if (tabId === null) return null;
  try {
    return (await ext.tabs.get(tabId)).url ?? null;
  } catch {
    return null;
  }
}

async function connect(): Promise<void> {
  if (connecting) return;
  connecting = true;
  void broadcast(await controller.current());
  try {
    await auth.connect();
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

async function disconnect(): Promise<void> {
  await auth.signOut();
  await forgetSessionInfo();
  await controller.reset();
}

async function capture(tabId: number | null, recapture: boolean): Promise<void> {
  const state = await controller.current();
  const target = tabId ?? ("tabId" in state ? state.tabId : state.phase === "idle" && state.notice?.kind === "recent" ? state.notice.tabId : null);
  const url = await tabUrl(target);
  if (target === null || !url) return;
  await controller.start({ tabId: target, url, recapture });
}

async function act(action: UiAction, tabId: number | null): Promise<void> {
  const state = await controller.current();
  switch (action) {
    case "connect": void connect(); return;
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
      if (state.phase === "done") return open(appUrl(state.result.appUrl));
      if (state.phase === "idle" && state.notice?.kind === "recent") {
        const profile = profileFromUrl(state.notice.url, LINKEDIN_ORIGIN);
        return open(profile ? `${API_ORIGIN}/dashboard?linkedin=${encodeURIComponent(profile.key)}` : appUrl(null));
      }
      return open(appUrl(null));
    }
    case "openScouty": return open(appUrl(null));
    case "whatItReads": return open(PRIVACY_URL);
    case "openStore": {
      const info = await sessionInfo(ui, true);
      const fromNotice = state.phase === "idle" && state.notice?.kind === "outdated" ? state.notice.storeUrl : null;
      const fromInfo = info && "kind" in info && info.kind === "outdated" ? info.storeUrl : null;
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

/** What the overlay in the LinkedIn tab may ask for. Everything else comes from the popup only. */
const OVERLAY_ACTIONS: readonly UiAction[] = ["stop", "dismiss", "openAnalysis", "retryNow", "captureAgain", "capture", "connect", "openScouty", "openStore"];

type Sender = { id?: string; url?: string; tab?: { id?: number } };

async function handle(message: Message, sender: Sender): Promise<unknown> {
  if (sender.id !== ext.runtime.id) return null;
  const fromPage = typeof sender.url === "string" && sender.url.startsWith(ext.runtime.getURL(""));
  const senderTab = sender.tab?.id ?? null;
  switch (message.type) {
    case "reader:hello": return fromPage ? null : controller.readerHello(senderTab);
    case "reader:progress": return fromPage ? null : controller.readerProgress(senderTab, message.section, message.count);
    case "reader:result":
      if (!fromPage) await controller.readerResult(senderTab, message.section, message.seq, message.result);
      return null;
    case "overlay:hello": {
      const state = await controller.current();
      if (fromPage || !("tabId" in state) || state.tabId !== senderTab) return null;
      return overlayState(state);
    }
    case "ui:getState":
      if (!fromPage) return null;
      return popupUi(ui, { tabId: message.tabId, tabUrl: await tabUrl(message.tabId), settings: message.settings });
    case "ui:action": {
      if (!fromPage) {
        const state = await controller.current();
        const owns = senderTab !== null && (("tabId" in state && state.tabId === senderTab) || captureTab === senderTab);
        if (!owns || !OVERLAY_ACTIONS.includes(message.action)) return null;
        await act(message.action, senderTab);
        return null;
      }
      await act(message.action, message.tabId);
      return null;
    }
    default: return null;
  }
}

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

  void auth.hardenStorage();
  void outbox.purgeIfExpired(Date.now()).then(() => controller.recover());
}

if (__SCOUTY_ENTRY__) listen();
