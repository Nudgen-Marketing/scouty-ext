// The scroll loop: human-paced, bounded by a cap, a step limit and a time budget, and stopped the
// moment the page stops being a normal signed-in page.
import { PACING } from "../config";
import type { PageState } from "./page-state";

export type LoopEnd = "cap" | "idle" | "steps" | "timeout" | "state" | "stopped";

export type LoopOptions = {
  pageState: () => PageState;
  scrollStep: () => void;
  /** Expands truncated text newly in view. */
  expandNew: () => void;
  /** Number of items found so far. */
  collect: () => number;
  /** Clicks the load-more control if one exists and is allowed. */
  loadMore: () => boolean;
  /** Reports progress; "stop" ends the loop (the user pressed Stop). */
  onProgress: (count: number, step: number) => Promise<"continue" | "stop">;
  wait: (ms: number) => Promise<void>;
  random: () => number;
  now: () => number;
  /** 0 means no cap. */
  cap: number;
  maxSteps: number;
  budgetMs: number;
};

export type LoopResult = { end: LoopEnd; state: PageState; steps: number; count: number };

export function pauseMs(random: () => number): number {
  return Math.round(PACING.minPauseMs + random() * (PACING.maxPauseMs - PACING.minPauseMs));
}

export async function runScrollLoop(o: LoopOptions): Promise<LoopResult> {
  const started = o.now();
  let steps = 0;
  let idle = 0;
  let loadMoreTried = false;
  o.expandNew();
  let count = o.collect();
  for (;;) {
    const state = o.pageState();
    if (state !== "ok") return { end: "state", state, steps, count };
    if (o.cap > 0 && count >= o.cap) return { end: "cap", state, steps, count };
    if (idle >= PACING.idleSteps) {
      if (!loadMoreTried && o.loadMore()) {
        loadMoreTried = true;
        idle = 0;
      } else {
        return { end: "idle", state, steps, count };
      }
    }
    if (steps >= o.maxSteps) return { end: "steps", state, steps, count };
    if (o.now() - started >= o.budgetMs) return { end: "timeout", state, steps, count };
    if ((await o.onProgress(count, steps)) === "stop") return { end: "stopped", state, steps, count };
    o.scrollStep();
    steps += 1;
    await o.wait(pauseMs(o.random));
    o.expandNew();
    const next = o.collect();
    if (next > count) {
      idle = 0;
      loadMoreTried = false;
    } else {
      idle += 1;
    }
    count = next;
  }
}
