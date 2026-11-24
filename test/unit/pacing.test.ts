import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PACING } from "../../src/config";
import { pauseMs, runScrollLoop, type LoopOptions } from "../../src/reader/pacing";
import type { PageState } from "../../src/reader/page-state";

type Tracked = LoopOptions & { scrolls: number; loadMores: number; pauses: number[] };
function options(over: Partial<LoopOptions> & { counts?: (step: number) => number } = {}): Tracked {
  const self: Tracked = {
    scrolls: 0, loadMores: 0, pauses: [] as number[],
    pageState: (): PageState => "ok",
    scrollStep: () => { self.scrolls += 1; },
    expandNew: () => undefined,
    collect: (): number => (over.counts ? over.counts(self.scrolls) : 0),
    loadMore: () => false,
    onProgress: async () => "continue" as const,
    wait: (ms: number) => { self.pauses.push(ms); return new Promise<void>((resolve) => setTimeout(resolve, ms)); },
    random: () => 0.5,
    now: () => Date.now(),
    cap: 50, maxSteps: PACING.activity.maxSteps, budgetMs: PACING.activity.budgetMs,
    ...over,
  };
  return self;
}

async function run(o: LoopOptions) {
  const promise = runScrollLoop(o);
  await vi.runAllTimersAsync();
  return promise;
}

describe("pacing", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });

  it("pauses a randomized 1.2 to 2.5 seconds", () => {
    expect(pauseMs(() => 0)).toBe(1200);
    expect(pauseMs(() => 1)).toBe(2500);
    expect(pauseMs(() => 0.5)).toBe(1850);
  });

  it("stops at the cap", async () => {
    const o = options({ counts: (step) => step * 10, cap: 50 });
    const result = await run(o);
    expect(result).toMatchObject({ end: "cap", count: 50, steps: 5 });
    expect(o.scrolls).toBe(5);
    expect(o.pauses.every((ms) => ms >= 1200 && ms <= 2500)).toBe(true);
  });

  it("stops after 3 steps with nothing new", async () => {
    const o = options({ counts: (step) => Math.min(step, 2) });
    const result = await run(o);
    expect(result).toMatchObject({ end: "idle", count: 2, steps: 5 });
  });

  it("tries load-more once before giving up, and again only after new items", async () => {
    let loaded = 0;
    const o = options({ counts: () => loaded * 5, loadMore: () => { o.loadMores += 1; if (loaded < 2) { loaded += 1; return true; } return false; } });
    const result = await run(o);
    expect(result.end).toBe("idle");
    expect(result.count).toBe(10);
    expect(o.loadMores).toBe(3);
  });

  it("stops at 40 steps", async () => {
    const o = options({ counts: (step) => step, cap: 100, budgetMs: 10 ** 9 });
    expect(await run(o)).toMatchObject({ end: "steps", steps: 40 });
  });

  it("stops at 90 seconds", async () => {
    const o = options({ counts: (step) => step, cap: 100, maxSteps: 10 ** 6, random: () => 1 });
    const result = await run(o);
    expect(result.end).toBe("timeout");
    expect(Date.now()).toBe(90_000);
    expect(result.steps).toBe(36);
  });

  it("uses the profile limits of 15 steps and 45 seconds", async () => {
    expect(PACING.profile).toEqual({ maxSteps: 15, budgetMs: 45_000 });
    const o = options({ counts: (step) => step, cap: 0, ...PACING.profile });
    expect(await run(o)).toMatchObject({ end: "steps", steps: 15 });
  });

  it.each(["checkpoint", "logged_out"] as const)("stops when the page state turns to %s mid-scroll", async (bad) => {
    const o = options({ counts: (step) => step, pageState: () => (o.scrolls >= 3 ? bad : "ok") });
    const result = await run(o);
    expect(result).toMatchObject({ end: "state", state: bad, steps: 3 });
    expect(o.scrolls).toBe(3);
  });

  it("stops when the user stops, before scrolling again", async () => {
    const o = options({ counts: (step) => step, onProgress: async (_count, step) => (step >= 2 ? "stop" : "continue") });
    expect(await run(o)).toMatchObject({ end: "stopped", steps: 2 });
    expect(o.scrolls).toBe(2);
  });

  it("reports progress on every step", async () => {
    const seen: number[] = [];
    const o = options({ counts: (step) => step * 20, onProgress: async (count) => { seen.push(count); return "continue"; } });
    await run(o);
    expect(seen).toEqual([0, 20, 40]);
  });
  it("waits while the loader shows, a bounded number of pauses per step, and then counts the step", async () => {
    // Items arrive while the loader shows: the loop waits for them instead of counting idle steps.
    let loaderUntil = 0;
    const o = options({
      cap: 10,
      loading: () => o.pauses.length < loaderUntil,
      counts: () => Math.min(10, o.pauses.length),
      scrollStep: () => { o.scrolls += 1; loaderUntil = o.pauses.length + 3; },
    });
    const result = await run(o);
    expect(result.end).toBe("cap");
    expect(o.scrolls).toBeLessThan(10);
    // A loader that never goes away cannot hold the loop: each step waits at most PACING.loaderWaits more pauses.
    const stuck = options({ loading: () => true });
    const end = await run(stuck);
    expect(end.end).toBe("idle");
    expect(stuck.scrolls).toBe(PACING.idleSteps);
    expect(stuck.pauses).toHaveLength(PACING.idleSteps * (1 + PACING.loaderWaits));
  });
});
