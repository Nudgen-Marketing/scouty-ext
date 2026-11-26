// Reader entry: injected into the LinkedIn tab only during a capture. Reads one section, reports
// progress and returns the payload. It makes no network request and touches no storage.
import { BROWSER, DEBUG_CLICKS, HARD_LIMITS, PACING, SUPPORTED_UI_LANGS } from "../config";
import { ext } from "../ext";
import type { ReaderArgs, ReaderMessage, ReaderResult } from "../messages";
import { profileKeyFromSlug, slugFromPath } from "../profile-key";
import { ACTIVITY_SECTIONS, buildActivityPayload, buildProfilePayload, serialize, type SectionPayload } from "../protocol";
import { activityListEmpty, degradedBlock, expandWithin, findBlocks, hasEmptyState, isLoading, readBlocks, textContainersOf, type ReadContext } from "./blocks";
import { fitByteBudget, utf8Length } from "./clamp";
import { createInteractions } from "./interactions";
import { runScrollLoop } from "./pacing";
import { detectPageState, pageStateFromPath, stopReasonFor, type PageState } from "./page-state";
import { expandProfile, profileProgress, readProfile, topCard } from "./profile";
import { SELECTORS_VERSION, selectors } from "./selectors";
import { domIsVisible, type IsVisible } from "./visible-text";

export type ReaderEnv = {
  doc: Document;
  isVisible: IsVisible;
  wait: (ms: number) => Promise<void>;
  random: () => number;
  now: () => number;
  onProgress: (count: number, step: number) => Promise<"continue" | "stop">;
};

const SETTLE_TRIES = 20;
const SETTLE_MS = 400;

export function uiLanguageSupported(doc: Document): boolean {
  const lang = (doc.documentElement.getAttribute("lang") ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
  return SUPPORTED_UI_LANGS.includes(lang);
}

export async function readSection(args: ReaderArgs, env: ReaderEnv): Promise<ReaderResult> {
  const doc = env.doc;
  const address = doc.defaultView?.location ?? doc.location;
  const interactions = createInteractions(doc, { clicksEnabled: uiLanguageSupported(doc), recordClicks: DEBUG_CLICKS });
  const clickLog = interactions.clickLog;
  const ctx: ReadContext = { doc, isVisible: env.isVisible, interactions, now: env.now() };

  // LinkedIn's sign-in, authwall or checkpoint address: stop before anything else.
  const byPath = pageStateFromPath(address?.pathname ?? "");
  if (byPath) return { kind: "stopped", reason: byPath, address: null, clickLog };

  // Target check: the page must be the profile this capture was created for. It is made again on
  // every step and once more before anything is built: an in-page navigation to another profile
  // must never have its text sent as this one's.
  const offTarget = (): ReaderResult | null => {
    const now = slugFromPath(address?.pathname ?? "");
    const key = now ? profileKeyFromSlug(now) : null;
    if (!now || !key) return { kind: "stopped", reason: "left_linkedin", address: null, clickLog };
    if (key !== args.profileKey) return { kind: "stopped", reason: "wrong_profile", address: `${address.origin}/in/${now}/`, clickLog };
    return null;
  };
  const moved = offTarget();
  if (moved) return moved;
  const slug = slugFromPath(address?.pathname ?? "") ?? "";

  // The application may still be drawing: give an unrecognised page a moment before failing closed.
  const section = args.section;
  let state: PageState = detectPageState(doc, section);
  for (let i = 0; state === "unknown" && i < SETTLE_TRIES; i += 1) {
    await env.wait(SETTLE_MS);
    state = detectPageState(doc, section);
  }
  if (state !== "ok") return { kind: "stopped", reason: stopReasonFor(state), address: null, clickLog };
  // After a navigation LinkedIn names the screen before it draws the top card: give the name a moment
  // (bounded like the settle above); without it the read goes on and the name is left out.
  for (let i = 0; section === "profile" && topCard(doc) === null && i < SETTLE_TRIES; i += 1) {
    await env.wait(SETTLE_MS);
  }

  const activity = ACTIVITY_SECTIONS.includes(args.section);
  const cap = activity ? Math.max(0, Math.min(args.cap, HARD_LIMITS.maxCap)) : 0;
  const limits = activity ? PACING.activity : PACING.profile;

  // Set when a step finds the tab on another profile (or off the profile pages): that ends the loop.
  const drift: { result: ReaderResult | null } = { result: null };
  const loop = await runScrollLoop({
    pageState: () => {
      // Page state first: a sign-in or checkpoint address keeps its own outcome.
      const state = detectPageState(doc, section);
      if (state !== "ok") return state;
      drift.result = offTarget();
      return drift.result ? "unknown" : "ok";
    },
    scrollStep: () => interactions.scrollStep(),
    expandNew: () => {
      if (activity) expandWithin(findBlocks(doc).flatMap((block) => textContainersOf(block)), ctx);
      else expandProfile(ctx, args.section);
    },
    collect: () => (activity ? findBlocks(doc).length : profileProgress(ctx, args.section)),
    loading: () => activity && isLoading(doc),
    loadMore: () => interactions.loadMore(),
    onProgress: env.onProgress,
    wait: env.wait,
    random: env.random,
    now: env.now,
    cap,
    maxSteps: limits.maxSteps,
    budgetMs: limits.budgetMs,
  });
  if (loop.end === "state" && loop.state !== "ok") {
    return drift.result ?? { kind: "stopped", reason: stopReasonFor(loop.state), address: null, clickLog };
  }
  // Once more before anything is built: content from a page in a bad state, or of another profile,
  // is never kept.
  const last = detectPageState(doc, section);
  if (last !== "ok") return { kind: "stopped", reason: stopReasonFor(last), address: null, clickLog };
  const away = offTarget();
  if (away) return away;

  const meta = {
    seq: args.seq, pageSlug: slug, capturedAt: new Date(env.now()).toISOString(), selectorsVersion: SELECTORS_VERSION,
    browser: args.browser ?? BROWSER, locale: doc.documentElement.getAttribute("lang") || null,
    expanded: interactions.clicksEnabled,
  };

  let payload: SectionPayload;
  if (activity) {
    const all = readBlocks(ctx);
    if (all.length > 0) {
      const capped = all.slice(0, cap);
      const base = utf8Length(serialize(buildActivityPayload(args.section, { ...meta, read: "ok", reachedCap: true }, [])));
      const fitted = fitByteBudget(capped, base, HARD_LIMITS.payloadByteBudget);
      const reachedCap = all.length >= cap || fitted.cut;
      payload = buildActivityPayload(args.section, { ...meta, read: "ok", reachedCap }, fitted.kept);
    } else if (hasEmptyState(doc, selectors.activity.emptyState) || activityListEmpty(doc)) {
      payload = buildActivityPayload(args.section, { ...meta, read: "empty", reachedCap: false }, []);
    } else {
      const whole = degradedBlock(ctx);
      if (!whole) return { kind: "failed", clickLog };
      payload = buildActivityPayload(args.section, { ...meta, read: "degraded", reachedCap: false }, [whole]);
    }
  } else {
    const profile = readProfile(ctx, args.section);
    if (!profile) return { kind: "failed", clickLog };
    payload = buildProfilePayload(args.section, { ...meta, read: profile.read, reachedCap: profile.cut }, profile.content);
  }

  if (loop.end === "stopped") return { kind: "read", payload, state: "partial", reason: "user_stopped", clickLog };
  if (loop.end === "steps" || loop.end === "timeout") return { kind: "read", payload, state: "partial", reason: "timeout", clickLog };
  return { kind: "read", payload, state: "complete", reason: null, clickLog };
}

async function send<T>(message: ReaderMessage): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return (await ext.runtime.sendMessage(message)) as T;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return null;
}

async function main(): Promise<void> {
  const scope = globalThis as unknown as { __scoutyReaderBusy?: boolean };
  if (scope.__scoutyReaderBusy) return;
  scope.__scoutyReaderBusy = true;
  try {
    const hello = await send<{ args: ReaderArgs | null }>({ type: "reader:hello" });
    const args = hello?.args;
    if (!args) return;
    const result = await readSection(args, {
      doc: document,
      isVisible: domIsVisible,
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      random: Math.random,
      now: Date.now,
      onProgress: async (count, step) => {
        const reply = await send<{ stop: boolean }>({ type: "reader:progress", section: args.section, count, step });
        return reply?.stop ? "stop" : "continue";
      },
    });
    await send({ type: "reader:result", section: args.section, seq: args.seq, result });
  } finally {
    scope.__scoutyReaderBusy = false;
  }
}

if (__SCOUTY_ENTRY__) void main();
