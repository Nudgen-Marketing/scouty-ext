// Reader entry: injected into the LinkedIn tab only during a capture. Reads one section, reports
// progress and returns the payload. It makes no network request and touches no storage.
import { BROWSER, DEBUG_CLICKS, HARD_LIMITS, PACING, SUPPORTED_UI_LANGS } from "../config";
import { contextGone, cutOff, ext } from "../ext";
import type { ReaderArgs, ReaderMessage, ReaderResult } from "../messages";
import { profileKeyFromSlug, slugFromPath } from "../profile-key";
import { ACTIVITY_SECTIONS, buildActivityPayload, buildProfilePayload, serialize, type SectionPayload } from "../protocol";
import { activityListEmpty, blockOrder, degradedBlock, expandWithin, hasEmptyState, isLoading, readBlocks, textContainersOf, type ReadContext } from "./blocks";
import { fitByteBudget, utf8Length } from "./clamp";
import { createInteractions } from "./interactions";
import { runScrollLoop } from "./pacing";
import { detectPageState, pageStateFromPath, stopReasonFor, type PageState } from "./page-state";
import { expandProfile, profileProgress, readProfile, topCard } from "./profile";
import { SELECTORS_VERSION, selectors } from "./selectors";
import { domIsVisible, domReach, type IsVisible, type Reach } from "./visible-text";

export type ReaderEnv = {
  doc: Document;
  isVisible: IsVisible;
  wait: (ms: number) => Promise<void>;
  random: () => number;
  now: () => number;
  onProgress: (count: number, step: number) => Promise<"continue" | "stop">;
  /** Where a control is against the viewport (domReach in the browser). Without it every control is near. */
  reach?: Reach;
  /** True once the extension was reloaded or updated under this reader: it stops at once and sends nothing. */
  cutOff?: () => boolean;
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
  const interactions = createInteractions(doc, { clicksEnabled: uiLanguageSupported(doc), recordClicks: DEBUG_CLICKS, ...(env.reach ? { reach: env.reach } : {}) });
  const clickLog = interactions.clickLog;
  const ctx: ReadContext = { doc, isVisible: env.isVisible, interactions, now: env.now(), ...(env.reach ? { reach: env.reach } : {}) };

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
  // An activity page always has a cap of at least 1: 0 means "no cap" to the scroll loop but "keep
  // nothing" to the payload, and only a malformed answer from Scouty could ask for it.
  const cap = activity ? Math.max(1, Math.min(args.cap, HARD_LIMITS.maxCap)) : 0;
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
    // Only the items that will be kept are expanded.
    expandNew: () => (activity
      ? expandWithin(blockOrder(doc).filter(({ place }) => cap <= 0 || place < cap).flatMap(({ el }) => textContainersOf(el)), ctx)
      : expandProfile(ctx, args.section)),
    // Distinct posts, as the cap counts them: repeats of one post never end the read early.
    collect: () => (activity ? new Set(blockOrder(doc).map(({ place }) => place)).size : profileProgress(ctx, args.section)),
    loading: () => activity && isLoading(doc),
    loadMore: () => interactions.loadMore(),
    onProgress: env.onProgress,
    ...(env.cutOff ? { cutOff: env.cutOff } : {}),
    wait: env.wait,
    random: env.random,
    now: env.now,
    cap,
    maxSteps: limits.maxSteps,
    budgetMs: limits.budgetMs,
  });
  // The extension was reloaded or updated: nothing is built, and there is no one to send it to.
  if (loop.end === "cut_off") return { kind: "failed", clickLog };
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

/**
 * The reader's line to the background. Once the extension is reloaded or updated under it (the same
 * test as the overlay's: the "context invalidated" error and no runtime id), it stops trying and
 * marks itself cut off; the loop then ends before the next scroll or press.
 */
export function readerChannel(sendMessage: (message: ReaderMessage) => Promise<unknown>, pause: (ms: number) => Promise<void>) {
  let cut = false;
  const isCut = (): boolean => cut || contextGone();
  async function send<T>(message: ReaderMessage): Promise<T | null> {
    for (let attempt = 0; attempt < 3 && !isCut(); attempt += 1) {
      try {
        return (await sendMessage(message)) as T;
      } catch (error) {
        if (cutOff(error)) {
          cut = true;
          return null;
        }
        await pause(500);
      }
    }
    return null;
  }
  return { send, isCut };
}

async function main(): Promise<void> {
  const scope = globalThis as unknown as { __scoutyReaderBusy?: boolean };
  if (scope.__scoutyReaderBusy) return;
  scope.__scoutyReaderBusy = true;
  const { send, isCut } = readerChannel((message) => ext.runtime.sendMessage(message), (ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  try {
    const hello = await send<{ args: ReaderArgs | null }>({ type: "reader:hello" });
    const args = hello?.args;
    if (!args) return;
    const result = await readSection(args, {
      doc: document,
      isVisible: domIsVisible,
      reach: domReach,
      cutOff: isCut,
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      random: Math.random,
      now: Date.now,
      onProgress: async (count, step) => {
        const reply = await send<{ stop: boolean }>({ type: "reader:progress", section: args.section, count, step });
        return reply?.stop ? "stop" : "continue";
      },
    });
    if (isCut()) return;
    await send({ type: "reader:result", section: args.section, seq: args.seq, result });
  } finally {
    scope.__scoutyReaderBusy = false;
  }
}

if (__SCOUTY_ENTRY__) void main();
