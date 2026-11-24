// Opening a Scouty app page: back in the app tab the user came from when there is one, else a new tab.
// Uses no "tabs" permission: with the host permission for the Scouty origin, Chromium and Firefox
// fill in `tab.url` for (and filter `tabs.query({ url })` to) tabs on that origin only. Without it
// (Firefox lets the user withhold it) `tab.url` is missing, so no tab is reused and a new one opens.
// Only a tab whose address is on the Scouty origin is ever navigated; a LinkedIn tab never is.
import { API_ORIGIN, HOST_PATTERNS } from "../config";
import { ext } from "../ext";

type TabLike = { id?: number; url?: string; windowId?: number; openerTabId?: number; lastAccessed?: number };

function onScouty(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).origin === API_ORIGIN;
  } catch {
    return false;
  }
}

function pathOf(url: string): string {
  return new URL(url).pathname;
}

async function getTab(tabId: number | null): Promise<TabLike | null> {
  if (tabId === null) return null;
  try {
    return (await ext.tabs.get(tabId)) as TabLike;
  } catch {
    return null;
  }
}

const newestFirst = (a: TabLike, b: TabLike): number => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0);

/**
 * The Scouty tab to show `target` in, or null for a new tab. In order: the tab that opened the
 * LinkedIn tab, if it is on Scouty; a Scouty tab already on the target's path (query ignored);
 * the most recently used Scouty tab in the LinkedIn tab's window (or the last focused window).
 */
export async function chooseAppTab(target: string, linkedinTabId: number | null): Promise<TabLike | null> {
  try {
    if (!(await ext.permissions.contains({ origins: [HOST_PATTERNS.api] }))) return null;
  } catch {
    return null;
  }
  const linkedin = await getTab(linkedinTabId);
  const usable = (tab: TabLike | null): tab is TabLike & { id: number } =>
    !!tab && typeof tab.id === "number" && onScouty(tab.url);

  // a. The app tab that opened LinkedIn.
  const opener = await getTab(linkedin?.openerTabId ?? null);
  if (usable(opener)) return opener;

  let all: TabLike[];
  try {
    all = ((await ext.tabs.query({ url: HOST_PATTERNS.api })) as TabLike[]).filter(usable).sort(newestFirst);
  } catch {
    return null;
  }
  if (all.length === 0) return null;

  // b. A Scouty tab already on that page.
  const path = pathOf(target);
  const samePage = all.find((tab) => pathOf(tab.url!) === path);
  if (samePage) return samePage;

  // c. The most recently used Scouty tab in the current window.
  let windowId = linkedin?.windowId;
  if (windowId === undefined) {
    try {
      windowId = ((await ext.tabs.query({ lastFocusedWindow: true })) as TabLike[])[0]?.windowId;
    } catch {
      windowId = undefined;
    }
  }
  return all.find((tab) => windowId !== undefined && tab.windowId === windowId) ?? null;
}

/** Shows `target` (a Scouty app address) in the chosen app tab, focusing its window; else opens a new tab. */
export async function openAppPage(target: string, linkedinTabId: number | null): Promise<void> {
  if (onScouty(target)) {
    const tab = await chooseAppTab(target, linkedinTabId);
    if (tab && typeof tab.id === "number") {
      try {
        await ext.tabs.update(tab.id, { url: target, active: true });
        if (typeof tab.windowId === "number") await ext.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
        return;
      } catch {
        // The tab closed in between: a new tab, as below.
      }
    }
  }
  await ext.tabs.create({ url: target });
}
