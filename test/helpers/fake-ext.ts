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

export const fake = {
  session: area(), local: area(), sync: area(),
  granted: new Set<string>(),
  redirectUrl: "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/",
  launchWebAuthFlow: vi.fn(async (_details: { url: string; interactive: boolean }): Promise<string | undefined> => undefined),
  permissionsRequest: vi.fn(async (_p: { origins: string[] }) => true),
  runtimeMessages: [] as unknown[],
  tabMessages: [] as { tabId: number; message: unknown }[],
  createdTabs: [] as string[],
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
      query: async () => [{ id: 7 }],
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
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
