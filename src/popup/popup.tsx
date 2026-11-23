// Popup entry: asks the background for the current state, draws it, and sends the user's choices
// back. It reads no storage and makes no network request; the background owns both.
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { requestHostPermissions } from "../background/permissions";
import { ext } from "../ext";
import type { Message, UiAction } from "../messages";
import { t } from "../ui/i18n";
import type { UiState } from "../ui/state";
import { viewFor } from "../ui/view";
import { Skeleton } from "./components";
import { PopupView } from "./PopupView";
import { targetTabId } from "./target-tab";

const REFRESH_MS = 1500;

function Popup() {
  const [state, setState] = useState<UiState | null>(null);
  const [tabId, setTabId] = useState<number | null | undefined>(undefined);
  const [settings, setSettings] = useState(false);
  const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const refresh = useCallback(async (tab: number | null, inSettings: boolean) => {
    try {
      const next = (await ext.runtime.sendMessage({ type: "ui:getState", tabId: tab, settings: inSettings } satisfies Message)) as UiState | null;
      if (next) setState(next);
    } catch {
      // The background is starting; the next tick asks again.
    }
  }, []);

  useEffect(() => {
    void targetTabId().then(setTabId, () => setTabId(null));
  }, []);

  useEffect(() => {
    if (tabId === undefined) return;
    void refresh(tabId, settings);
    const onMessage = (message: Message): undefined => {
      if (message?.type === "ui:changed") void refresh(tabId, settings);
      return undefined;
    };
    ext.runtime.onMessage.addListener(onMessage);
    const timer = setInterval(() => void refresh(tabId, settings), REFRESH_MS);
    return () => {
      ext.runtime.onMessage.removeListener(onMessage);
      clearInterval(timer);
    };
  }, [tabId, settings, refresh]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") window.close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const onAction = (action: UiAction): void => {
    const tab = tabId ?? null;
    if (action === "allow") {
      // Called straight from the click, before any await: the browser requires a user action.
      void requestHostPermissions().then(() => refresh(tab, settings));
      return;
    }
    if (action === "openSettings" || action === "closeSettings") return setSettings(action === "openSettings");
    if (action === "cancel") return window.close();
    if (action === "disconnect" || action === "switchWorkspace") setSettings(false);
    void ext.runtime.sendMessage({ type: "ui:action", action, tabId: tab } satisfies Message).then(() => refresh(tab, false), () => undefined);
  };

  if (!state) {
    return (
      <div aria-busy="true" aria-label={t("working")} className="grid w-[360px] gap-3 p-4">
        <Skeleton className="h-5 w-24" /><Skeleton className="h-5 w-56" /><Skeleton className="h-4 w-full" /><Skeleton className="h-9 w-full" />
      </div>
    );
  }
  return <PopupView view={viewFor(state)} onAction={onAction} reducedMotion={reducedMotion} />;
}

function mount(): void {
  document.title = t("extName");
  const root = document.getElementById("root");
  if (root) createRoot(root).render(<Popup />);
}

if (__SCOUTY_ENTRY__) mount();
