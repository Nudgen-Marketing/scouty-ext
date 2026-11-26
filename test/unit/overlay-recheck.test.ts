import { describe, expect, it } from "vitest";
import { OFFLINE_RECHECK_MS, offlineRecheck } from "../../src/overlay/overlay";
import type { UiState } from "../../src/ui/state";

describe("overlay: 'You're offline' asks for the state again", () => {
  it("every 15 s while it shows the offline state, and stops on any other state or none", () => {
    expect(OFFLINE_RECHECK_MS).toBe(15_000);
    const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
    const fake = {
      set: (fn: () => void, ms: number) => { timers.push({ fn, ms, cleared: false }); return timers.length - 1; },
      clear: (id: unknown) => { timers[id as number]!.cleared = true; },
    };
    let asks = 0;
    const recheck = offlineRecheck(() => { asks += 1; }, fake);
    const offline: UiState = { kind: "offline", workspace: "W" };
    recheck(offline);
    recheck(offline); // the same screen drawn again: still one timer
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(15_000);
    timers[0]!.fn();
    expect(asks).toBe(1);
    recheck({ kind: "notAvailable" });
    expect(timers[0]!.cleared).toBe(true);
    recheck(offline);
    expect(timers).toHaveLength(2);
    recheck(null);
    expect(timers[1]!.cleared).toBe(true);
  });

  it("also while 'Scouty isn't answering' waits to send, but not in its create form (nothing is kept)", () => {
    const timers: { ms: number; cleared: boolean }[] = [];
    const fake = {
      set: (_fn: () => void, ms: number) => { timers.push({ ms, cleared: false }); return timers.length - 1; },
      clear: (id: unknown) => { timers[id as number]!.cleared = true; },
    };
    const recheck = offlineRecheck(() => undefined, fake);
    recheck({ kind: "notAnswering", retryAt: null, sending: false, workspace: "W" });
    expect(timers).toHaveLength(0);
    recheck({ kind: "notAnswering", retryAt: null, sending: true, workspace: "W" });
    expect(timers).toEqual([{ ms: OFFLINE_RECHECK_MS, cleared: false }]);
    recheck({ kind: "offline", workspace: "W" }); // from one waiting screen to the other: the same timer
    expect(timers).toHaveLength(1);
    recheck({ kind: "notAnswering", retryAt: null, sending: false, workspace: "W" });
    expect(timers[0]!.cleared).toBe(true);
  });
});
