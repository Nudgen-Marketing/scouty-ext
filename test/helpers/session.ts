import * as auth from "../../src/background/auth";
import { CaptureController, type CaptureState, type TabInfo } from "../../src/background/session";
import type { ReaderResult } from "../../src/messages";
import type { SectionName } from "../../src/protocol";
import { fake } from "./fake-ext";
import { samplePayload, wire, type Wired } from "./stub";

export const TAB = 11;
export const PROFILE_URL = "https://www.linkedin.com/in/synthetic-person-one/";

export type Rig = Wired & {
  controller: CaptureController;
  tab: { info: TabInfo | null; updates: string[] };
  injected: string[];
  /** Whether a reader is still at work in the tab's document (the readerAlive probe). */
  reader: { alive: boolean; probes: number };
  states: CaptureState[];
  /** Resolvers of sleeps the controller is waiting on, by duration. */
  timers: { ms: number; fire: () => void }[];
  newController(): CaptureController;
  /** Plays the reader for the current section: hello, then the given result. */
  read(result?: (section: SectionName, seq: number) => ReaderResult): Promise<SectionName | null>;
  /** Reads every remaining section with ordinary payloads. */
  readAll(): Promise<void>;
  phase(): Promise<string>;
};

export const okResult = (section: SectionName, seq: number): ReaderResult =>
  ({ kind: "read", payload: samplePayload(section, seq), state: "complete", reason: null, clickLog: [] });

export async function rig(options: Record<string, unknown> = {}): Promise<Rig> {
  const wired = wire(options);
  await auth.connect();
  wired.stub.state.requests.length = 0;
  const tab: Rig["tab"] = { info: { url: PROFILE_URL, status: "complete" }, updates: [] };
  const injected: string[] = [];
  const reader: Rig["reader"] = { alive: false, probes: 0 };
  const states: CaptureState[] = [];
  const timers: Rig["timers"] = [];
  let n = 0;
  const make = (): CaptureController => new CaptureController({
    api: wired.api,
    tabs: {
      get: async () => (tab.info ? { ...tab.info } : null),
      update: async (_tabId, url) => { tab.updates.push(url); if (tab.info) tab.info = { url, status: "complete" }; },
    },
    inject: async (_tabId, file) => { injected.push(file); return true; },
    readerAlive: async () => { reader.probes += 1; return reader.alive; },
    store: {
      get: async (key) => (await fake.session.get(key))[key],
      set: (key, value) => fake.session.set({ [key]: value }),
      remove: (key) => fake.session.remove(key),
    },
    sleep: (ms) => new Promise<void>((resolve) => { timers.push({ ms, fire: resolve }); }),
    now: () => wired.clock.now,
    uuid: () => `uuid-0000-${(n += 1)}`,
    changed: (state) => { states.push(state); },
  });
  const self: Rig = {
    ...wired, controller: make(), tab, injected, reader, states, timers,
    newController() { self.controller = make(); return self.controller; },
    async read(result = okResult) {
      await self.controller.settledWork();
      const hello = await self.controller.readerHello(TAB);
      if (!hello.args) return null;
      await self.controller.readerProgress(TAB, hello.args.section, 1);
      await self.controller.readerResult(TAB, hello.args.section, hello.args.seq, result(hello.args.section, hello.args.seq));
      await self.controller.settledWork();
      return hello.args.section;
    },
    async readAll() {
      for (let i = 0; i < 10; i += 1) if ((await self.read()) === null) return;
    },
    async phase() { return (await self.controller.current()).phase; },
  };
  return self;
}
