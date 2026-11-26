import { describe, expect, it } from "vitest";
import { IDLE, type CaptureState } from "../../src/background/session";
import { DONE_HOLD_MS, DONE_SINCE_KEY, deferUpdates, holdsUpdate, UPDATE_KEY } from "../../src/background/update";
import { fake } from "../helpers/fake-ext";

const running: CaptureState = {
  phase: "running", tabId: 1, profileKey: "k", section: "posts", count: 3, loading: false,
  expected: ["profile", "posts"], caps: { posts: 50, comments: 50, reactions: 50 }, finished: ["profile"],
};
const finalizing: CaptureState = { phase: "finalizing", tabId: 1, stop: null, address: null, blocked: "offline", slow: false, retryAt: 5 };
const done = { phase: "done", tabId: 1, result: { completeness: "complete" } } as unknown as CaptureState;
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("an extension update waits for the capture in progress", () => {
  it("every phase but idle holds it", () => {
    expect(holdsUpdate(IDLE)).toBe(false);
    expect(holdsUpdate({ phase: "idle", notice: { kind: "expired" } })).toBe(false);
    for (const state of [running, finalizing, { phase: "starting", tabId: 1, profileKey: "k" } as CaptureState]) expect(holdsUpdate(state)).toBe(true);
  });

  it("an update during a capture is not applied; it reloads when the capture ends (idle)", async () => {
    let state: CaptureState = running;
    const check = deferUpdates(async () => state);
    expect(fake.updateListeners).toHaveLength(1);
    fake.updateListeners[0]!();
    await settle();
    expect(fake.reload).not.toHaveBeenCalled();
    expect(fake.session.data.get(UPDATE_KEY)).toBe(true);
    state = finalizing;
    await check(state);
    expect(fake.reload).not.toHaveBeenCalled();
    state = IDLE;
    await check(state);
    expect(fake.reload).toHaveBeenCalledTimes(1);
  });

  it("with no capture in progress the update is applied at once", async () => {
    deferUpdates(async () => IDLE);
    fake.updateListeners[0]!();
    await settle();
    expect(fake.reload).toHaveBeenCalledTimes(1);
  });

  it("no update waiting: idle does not reload", async () => {
    const check = deferUpdates(async () => IDLE);
    await check(IDLE);
    expect(fake.reload).not.toHaveBeenCalled();
  });

  it("a background that stopped and started again still knows an update waits (storage.session)", async () => {
    deferUpdates(async () => running);
    fake.updateListeners[0]!();
    await settle();
    const restarted = deferUpdates(async () => IDLE);
    await restarted(IDLE);
    expect(fake.reload).toHaveBeenCalledTimes(1);
  });

  it("sign-in in progress holds it, also when idle; it reloads once sign-in ends", async () => {
    expect(holdsUpdate(IDLE, { connecting: true })).toBe(true);
    let connecting = true;
    const check = deferUpdates(async () => IDLE, { connecting: () => connecting });
    fake.updateListeners[0]!();
    await settle();
    expect(fake.reload).not.toHaveBeenCalled();
    await check(IDLE);
    expect(fake.reload).not.toHaveBeenCalled();
    connecting = false; // index.ts broadcasts the state when sign-in ends, which calls check
    await check(IDLE);
    expect(fake.reload).toHaveBeenCalledTimes(1);
  });

  it("a done screen holds it for DONE_HOLD_MS (30 min) only, then the update is applied", async () => {
    expect(holdsUpdate(done)).toBe(true);
    expect(holdsUpdate(done, { doneSince: 0, now: DONE_HOLD_MS - 1 })).toBe(true);
    expect(holdsUpdate(done, { doneSince: 0, now: DONE_HOLD_MS })).toBe(false);
    // Only the done phase is bounded: a capture in progress holds it however long it takes.
    expect(holdsUpdate(running, { doneSince: 0, now: 10 * DONE_HOLD_MS })).toBe(true);

    let clock = 1_000_000;
    const timers: { fn: () => void; ms: number }[] = [];
    const check = deferUpdates(async () => done, { now: () => clock, later: (fn, ms) => timers.push({ fn, ms }) });
    fake.updateListeners[0]!();
    await settle();
    expect(fake.reload).not.toHaveBeenCalled();
    expect(fake.session.data.get(DONE_SINCE_KEY)).toBe(1_000_000);
    // One timer for the end of the hold, not one per check.
    clock += 60_000;
    await check(done);
    expect(timers.map((t) => t.ms)).toEqual([DONE_HOLD_MS]);
    expect(fake.reload).not.toHaveBeenCalled();
    clock = 1_000_000 + DONE_HOLD_MS;
    timers[0]!.fn();
    await settle(); await settle();
    expect(fake.reload).toHaveBeenCalledTimes(1);
  });

  it("the done screen's start survives a restarted background, and a new capture starts the count again", async () => {
    let clock = 5_000;
    deferUpdates(async () => done, { now: () => clock, later: () => undefined });
    fake.updateListeners[0]!();
    await settle();
    clock += DONE_HOLD_MS;
    const restarted = deferUpdates(async () => done, { now: () => clock, later: () => undefined });
    await restarted(done);
    expect(fake.reload).toHaveBeenCalledTimes(1);
    // Leaving done forgets when it started.
    await restarted(running);
    expect(fake.session.data.has(DONE_SINCE_KEY)).toBe(false);
  });
});
