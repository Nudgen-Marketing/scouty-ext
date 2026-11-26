// The scroll loop: human-paced, bounded by a cap, a step limit and a time budget, and stopped the
// moment the page stops being a normal signed-in page.
import { PACING } from "../config";
import type { ExpandStep } from "./blocks";
import type { PageState } from "./page-state";

export type LoopEnd = "cap" | "idle" | "steps" | "timeout" | "state" | "stopped" | "cut_off";

export type LoopOptions = {
  pageState: () => PageState;
  scrollStep: () => void;
  /** Presses at most one "… more" control near the viewport; the loop paces and caps the presses. */
  expandNew: () => ExpandStep;
  /** Number of items found so far. */
  collect: () => number;
  /** True while the page shows that more items are loading; the loop waits (bounded) before counting a step idle. */
  loading?: () => boolean;
  /** Clicks the load-more control if one exists and is allowed. */
  loadMore: () => boolean;
  /** Reports progress; "stop" ends the loop (the user pressed Stop). */
  onProgress: (count: number, step: number) => Promise<"continue" | "stop">;
  /** True once the extension was reloaded or updated under this reader: nothing more is scrolled or pressed. */
  cutOff?: () => boolean;
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

/** The gap between two "… more" presses: 300 to 900 ms, from the same randomness as the scroll pauses. */
export function clickGapMs(random: () => number): number {
  return Math.round(PACING.minClickGapMs + random() * (PACING.maxClickGapMs - PACING.minClickGapMs));
}

/**
 * The presses of one scroll step: up to PACING.maxClicksPerStep, a jittered gap apart, only near the
 * viewport (expandNew decides that). Returns the presses and how many allowed controls are still to press.
 */
async function expandStep(o: LoopOptions, started: number): Promise<{ clicks: number; pending: number }> {
  const cut = (): boolean => o.cutOff?.() === true;
  if (cut()) return { clicks: 0, pending: 0 };
  let step = o.expandNew();
  let clicks = step.clicked ? 1 : 0;
  while (step.clicked && clicks < PACING.maxClicksPerStep) {
    await o.wait(clickGapMs(o.random));
    if (cut() || o.now() - started >= o.budgetMs) break;
    step = o.expandNew();
    if (step.clicked) clicks += 1;
  }
  return { clicks, pending: step.pending };
}

export async function runScrollLoop(o: LoopOptions): Promise<LoopResult> {
  const started = o.now();
  const cut = (): boolean => o.cutOff?.() === true;
  let steps = 0;
  let idle = 0;
  let loadMoreTried = false;
  let { pending } = await expandStep(o, started);
  let count = o.collect();
  for (;;) {
    if (cut()) return { end: "cut_off", state: "ok", steps, count };
    const state = o.pageState();
    if (state !== "ok") return { end: "state", state, steps, count };
    // At the cap, the loop goes on only to reach "… more" controls of the kept items still ahead: not
    // for longer than it would wait for new items, nor past the step limit or the time budget (the
    // items are all there, so that is still the cap).
    const spent = steps >= o.maxSteps || o.now() - started >= o.budgetMs;
    if (o.cap > 0 && count >= o.cap && (pending === 0 || idle >= PACING.idleSteps || spent)) return { end: "cap", state, steps, count };
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
    const reply = await o.onProgress(count, steps);
    if (cut()) return { end: "cut_off", state, steps, count };
    if (reply === "stop") return { end: "stopped", state, steps, count };
    o.scrollStep();
    steps += 1;
    await o.wait(pauseMs(o.random));
    // Infinite scroll: while LinkedIn's loader shows, give it a few more pauses (still within the budget).
    for (let extra = 0; extra < PACING.loaderWaits && o.loading?.() && o.now() - started < o.budgetMs; extra += 1) {
      await o.wait(pauseMs(o.random));
    }
    if (cut()) return { end: "cut_off", state: "ok", steps, count };
    const expanded = await expandStep(o, started);
    pending = expanded.pending;
    const next = o.collect();
    // At the cap a step that pressed something is progress too (its items are all there already).
    if (next > count || (o.cap > 0 && count >= o.cap && expanded.clicks > 0)) {
      idle = 0;
      loadMoreTried = false;
    } else {
      idle += 1;
    }
    count = next;
  }
}
