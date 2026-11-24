// A mocked extension API, shaped like the promise-returning namespace both Chromium (chrome.*) and
// Firefox (browser.*) give a Manifest V3 extension. Installed once; reset between tests.
import { vi } from "vitest";

export type FakeArea = {
  data: Map<string, unknown>; writes: string[];
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
  setAccessLevel?: (options: unknown) => Promise<void>;
};

function area(): FakeArea {
  const data = new Map<string, unknown>();
  const writes: string[] = [];
  return {
    data, writes,
    async get(keys?: string | string[] | null) {
      const out: Record<string, unknown> = {};
      const wanted = keys == null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
      for (const key of wanted) if (data.has(key)) out[key] = structuredClone(data.get(key));
      return out;
    },
    async set(items: Record<string, unknown>) {
      for (const [key, value] of Object.entries(items)) { data.set(key, structuredClone(value)); writes.push(key); }
    },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key);
    },
    async clear() { data.clear(); },
    setAccessLevel: vi.fn(async () => undefined),
  };
}

export type FakeTab = { id: number; url: string; windowId: number; openerTabId?: number; lastAccessed?: number };

/** A match pattern without a port matches every port; the path is a prefix up to "*". */
function matches(pattern: string, url: string): boolean {
  const m = pattern.match(/^(\w+):\/\/([^/]+)(\/.*)$/);
  if (!m) return false;
  const u = new URL(url);
  return u.protocol === `${m[1]}:` && u.hostname === m[2] && u.pathname.startsWith(m[3]!.replace(/\*$/, ""));
}

/** As Chromium and Firefox give it without the "tabs" permission: `url` only under a granted host permission. */
function visible(tab: FakeTab): Partial<FakeTab> {
  const granted = [...fake.granted].some((pattern) => matches(pattern, tab.url));
  const { url, ...rest } = tab;
  return granted ? { ...rest, url } : rest;
}

export const fake = {
  session: area(), local: area(), sync: area(),
  granted: new Set<string>(),
  redirectUrl: "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/",
  launchWebAuthFlow: vi.fn(async (_details: { url: string; interactive: boolean }): Promise<string | undefined> => undefined),
  permissionsRequest: vi.fn(async (_p: { origins: string[] }) => true),
  runtimeMessages: [] as unknown[],
  tabMessages: [] as { tabId: number; message: unknown }[],
  createdTabs: [] as string[],
  /** Open tabs, for tabs.get / tabs.query({ url }) / tabs.update. Empty unless a test adds some. */
  tabList: [] as FakeTab[],
  updatedTabs: [] as { tabId: number; props: { url?: string; active?: boolean } }[],
  focusedWindows: [] as number[],
  lastFocusedWindow: 1,
  messages: {} as Record<string, string>,
};

export function resetFakeExt(): void {
  for (const a of [fake.session, fake.local, fake.sync]) { a.data.clear(); a.writes.length = 0; }
  fake.granted.clear();
  fake.launchWebAuthFlow.mockReset();
  fake.permissionsRequest.mockReset();
  fake.permissionsRequest.mockImplementation(async (p) => { for (const o of p.origins) fake.granted.add(o); return true; });
  fake.runtimeMessages.length = 0;
  fake.tabMessages.length = 0;
  fake.createdTabs.length = 0;
  fake.tabList.length = 0;
  fake.updatedTabs.length = 0;
  fake.focusedWindows.length = 0;
  fake.lastFocusedWindow = 1;
}

export function installFakeExt(target: "chrome" | "browser" = "chrome"): void {
  const api = {
    storage: { session: fake.session, local: fake.local, sync: fake.sync },
    identity: {
      getRedirectURL: () => fake.redirectUrl,
      launchWebAuthFlow: (details: { url: string; interactive: boolean }) => fake.launchWebAuthFlow(details),
    },
    permissions: {
      contains: async (p: { origins: string[] }) => p.origins.every((o) => fake.granted.has(o)),
      request: (p: { origins: string[] }) => fake.permissionsRequest(p),
    },
    runtime: {
      id: "fake-extension-id",
      getURL: (path: string) => `chrome-extension://fake-extension-id/${path}`,
      sendMessage: async (message: unknown) => { fake.runtimeMessages.push(message); return null; },
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
    },
    tabs: {
      create: async (o: { url: string }) => { fake.createdTabs.push(o.url); return {}; },
      sendMessage: async (tabId: number, message: unknown) => { fake.tabMessages.push({ tabId, message }); return null; },
      get: async (tabId: number) => {
        const tab = fake.tabList.find((t) => t.id === tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}.`);
        return visible(tab);
      },
      update: async (tabId: number, props: { url?: string; active?: boolean }) => {
        const tab = fake.tabList.find((t) => t.id === tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}.`);
        fake.updatedTabs.push({ tabId, props });
        if (props.url) tab.url = props.url;
        return visible(tab);
      },
      query: async (q: { url?: string; lastFocusedWindow?: boolean; active?: boolean; currentWindow?: boolean }) => {
        if (q.url === undefined && q.lastFocusedWindow === undefined) return [{ id: 7 }];
        return fake.tabList
          // Chromium ignores `url` for a tab without host permission (Firefox leaves the tab out); either way it has no url.
          .filter((t) => q.url === undefined || !fake.granted.has(q.url) || matches(q.url, t.url))
          .filter((t) => !q.lastFocusedWindow || t.windowId === fake.lastFocusedWindow)
          .map(visible);
      },
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
    },
    windows: {
      update: async (windowId: number, props: { focused?: boolean }) => { if (props.focused) fake.focusedWindows.push(windowId); return {}; },
    },
    i18n: {
      getMessage: (key: string, subs?: string | string[]) => {
        let text = fake.messages[key] ?? "";
        const list = subs === undefined ? [] : Array.isArray(subs) ? subs : [subs];
        list.forEach((value, i) => { text = text.split(`$${i + 1}`).join(value); });
        return text;
      },
    },
  };
  const scope = globalThis as unknown as Record<string, unknown>;
  delete scope.chrome;
  delete scope.browser;
  scope[target] = api;
}
