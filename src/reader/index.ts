// Reader entry: injected into the LinkedIn tab only during a capture. Reads one section, reports
// progress and returns the payload. It makes no network request and touches no storage.
import { BROWSER, DEBUG_CLICKS, HARD_LIMITS, PACING, SUPPORTED_UI_LANGS } from "../config";
import { ext } from "../ext";
import type { ReaderArgs, ReaderMessage, ReaderResult } from "../messages";
import { profileKeyFromSlug, slugFromPath } from "../profile-key";
import { ACTIVITY_SECTIONS, buildActivityPayload, buildProfilePayload, serialize, type SectionPayload } from "../protocol";
import { degradedBlock, expandWithin, findBlocks, hasEmptyState, readBlocks, textContainersOf, type ReadContext } from "./blocks";
import { fitByteBudget, utf8Length } from "./clamp";
import { createInteractions } from "./interactions";
import { runScrollLoop } from "./pacing";
import { detectPageState, stopReasonFor, type PageState } from "./page-state";
import { expandProfile, profileProgress, readProfile } from "./profile";
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

  // Target check: the page must be the profile this capture was created for.
  const slug = slugFromPath(address?.pathname ?? "");
  const key = slug ? profileKeyFromSlug(slug) : null;
  if (!slug || !key) return { kind: "stopped", reason: "left_linkedin", address: null, clickLog };
  if (key !== args.profileKey) {
    return { kind: "stopped", reason: "wrong_profile", address: `${address.origin}/in/${slug}/`, clickLog };
  }

  // The application may still be drawing: give an unrecognised page a moment before failing closed.
  let state: PageState = detectPageState(doc);
  for (let i = 0; state === "unknown" && i < SETTLE_TRIES; i += 1) {
    await env.wait(SETTLE_MS);
    state = detectPageState(doc);
  }
  if (state !== "ok") return { kind: "stopped", reason: stopReasonFor(state), address: null, clickLog };

  const activity = ACTIVITY_SECTIONS.includes(args.section);
  const cap = activity ? Math.max(0, Math.min(args.cap, HARD_LIMITS.maxCap)) : 0;
  const limits = activity ? PACING.activity : PACING.profile;

  const loop = await runScrollLoop({
    pageState: () => detectPageState(doc),
    scrollStep: () => interactions.scrollStep(),
    expandNew: () => {
      if (activity) expandWithin(findBlocks(doc).flatMap((block) => textContainersOf(block)), ctx);
      else expandProfile(ctx, args.section);
    },
    collect: () => (activity ? findBlocks(doc).length : profileProgress(ctx, args.section)),
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
    return { kind: "stopped", reason: stopReasonFor(loop.state), address: null, clickLog };
  }
  // Once more before anything is built: content from a page in a bad state is never kept.
  const last = detectPageState(doc);
  if (last !== "ok") return { kind: "stopped", reason: stopReasonFor(last), address: null, clickLog };

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
    } else if (hasEmptyState(doc, selectors.activity.emptyState)) {
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
