import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../../src/messages";
import { HOST_TAG, OFFLINE_RECHECK_MS, startOverlay } from "../../src/overlay/overlay";
import type { UiState } from "../../src/ui/state";

type Runtime = { sendMessage: (message: Message) => Promise<unknown>; onMessage: { addListener: ReturnType<typeof vi.fn> } };
const runtime = (): Runtime => (globalThis as unknown as { chrome: { runtime: Runtime } }).chrome.runtime;
const offline: UiState = { kind: "offline", workspace: "W" };

let answers: unknown[];
let timers: { fn: () => void; ms: number }[];
let original: Runtime["sendMessage"];

beforeEach(() => {
  delete (globalThis as unknown as { __scoutyOverlay?: boolean }).__scoutyOverlay;
  document.documentElement.querySelectorAll(HOST_TAG).forEach((node) => node.remove());
  answers = [];
  timers = [];
  original = runtime().sendMessage;
  runtime().onMessage.addListener.mockClear();
  runtime().sendMessage = async (message) => (message.type === "overlay:hello" ? answers.shift() : null);
});

afterEach(() => {
  runtime().sendMessage = original;
});

const start = async (): Promise<void> => {
  startOverlay(document, { set: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; }, clear: () => undefined });
  await vi.waitFor(() => expect(answers).toHaveLength(0));
  await Promise.resolve();
};
const host = (): Element | null => document.documentElement.querySelector(HOST_TAG);

describe("overlay after a background restart (deviation 28)", () => {
  it("removes itself when its recheck is answered null, instead of keeping a stale screen", async () => {
    answers.push(offline);
    await start();
    expect(host()).not.toBeNull();
    expect(timers).toEqual([{ fn: expect.any(Function), ms: OFFLINE_RECHECK_MS }]);
    // The background restarted and shows nothing in this tab any more.
    answers.push(null);
    timers[0]!.fn();
    await vi.waitFor(() => expect(host()).toBeNull());
  });

  it("removes itself when overlay:hello is answered null, and redraws on the next state message", async () => {
    answers.push(null);
    await start();
    expect(host()).toBeNull();
    const listener = runtime().onMessage.addListener.mock.calls[0]![0] as (message: Message) => void;
    listener({ type: "overlay:state", state: offline });
    expect(host()).not.toBeNull();
    listener({ type: "overlay:remove" });
    expect(host()).toBeNull();
  });

  it("leaves the page when the extension was reloaded (context invalidated): overlay removed, no more rechecks", async () => {
    answers.push(offline);
    await start();
    expect(host()).not.toBeNull();
    const chrome = (globalThis as unknown as { chrome: { runtime: { id?: string } } }).chrome;
    const id = chrome.runtime.id;
    let asked = 0;
    runtime().sendMessage = () => { asked += 1; throw new Error("Extension context invalidated."); };
    try {
      delete chrome.runtime.id;
      timers[0]!.fn();
      await vi.waitFor(() => expect(host()).toBeNull());
      const after = timers.length;
      // Orphaned: a later recheck sends nothing and schedules nothing.
      timers[timers.length - 1]!.fn();
      await Promise.resolve();
      expect(asked).toBe(1);
      expect(timers).toHaveLength(after);
    } finally {
      chrome.runtime.id = id;
    }
  });

  it("keeps its screen when an ask gets no answer at all (a failed send)", async () => {
    answers.push(offline);
    await start();
    runtime().sendMessage = async () => { throw new Error("Could not establish connection"); };
    timers[0]!.fn();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host()).not.toBeNull();
  });
});
