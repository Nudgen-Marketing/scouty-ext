// Development builds only: the evidence of what the reader pressed on LinkedIn (validation R4),
// kept out of every screen a user sees. Each finished capture adds one record to memory-only
// storage (bounded) and prints a one-line summary to the background console; the popup's
// Settings → Developer disclosure reads it back with a copy button.
//
// Every call site is behind `if (__SCOUTY_DEV__)`, so a store build drops this whole module
// (test/static checks that none of its strings reach a store bundle).
import { summarize, summaryLine, type DevCapture, type DevInfo } from "../dev-summary";
import { ext } from "../ext";
import type { ClickLogEntry } from "../messages";
import * as auth from "./auth";

const KEY = "dev.clickLog";
const LAST_KEY = "dev.clickLog.last";
/** Captures kept, newest last. */
export const DEV_LOG_CAPTURES = 10;

/**
 * Records a finished capture once. `id` names the capture (it is called on every redraw of the
 * finished screen); a second call with the same id does nothing.
 */
export async function recordCapture(id: string, profile: string, log: readonly ClickLogEntry[]): Promise<void> {
  const stored = await ext.storage.session.get([KEY, LAST_KEY]);
  if (stored[LAST_KEY] === id) return;
  const capture = summarize(profile, log, new Date().toISOString());
  const captures = [...((stored[KEY] as DevCapture[] | undefined) ?? []), capture].slice(-DEV_LOG_CAPTURES);
  await ext.storage.session.set({ [KEY]: captures, [LAST_KEY]: id });
  // eslint-disable-next-line no-console -- development builds only: the R4 evidence line.
  console.info(summaryLine(capture));
}

export async function devInfo(): Promise<DevInfo> {
  const captures = ((await ext.storage.session.get(KEY))[KEY] as DevCapture[] | undefined) ?? [];
  return { redirectUrl: auth.redirectUri(), captures };
}

/** The popup's request for the developer disclosure; null for any other message. */
export function devRequest(message: { type: string }): Promise<DevInfo> | null {
  return message.type === "dev:info" ? devInfo() : null;
}
