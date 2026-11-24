// Development builds only: the summary of what the reader pressed on LinkedIn in one capture
// (validation R4). Pure, shared by the background log (background/dev-log.ts) and the popup's
// developer disclosure (popup/DevPanel.tsx); store builds reference neither.
import type { ClickLogEntry } from "./messages";

/** Entries kept per capture (the session already keeps at most 200). */
export const DEV_LOG_ENTRIES = 200;

export type DevCapture = { at: string; profile: string; total: number; expand: number; loadMore: number; other: ClickLogEntry[]; entries: ClickLogEntry[] };
export type DevInfo = { redirectUrl: string; captures: DevCapture[] };

/** An entry the allow-list expects: an inline "… more" or a "Show more results" control matched by a selector. */
function kindOf(entry: ClickLogEntry): "expand" | "loadMore" | "other" {
  const [kind, selector] = entry.selector.split(/:\s(.*)/s);
  if (!selector) return "other";
  return kind === "expandText" ? "expand" : kind === "loadMore" ? "loadMore" : "other";
}

export function summarize(profile: string, log: readonly ClickLogEntry[], at: string): DevCapture {
  const kinds = log.map(kindOf);
  return {
    at, profile, total: log.length,
    expand: kinds.filter((k) => k === "expand").length,
    loadMore: kinds.filter((k) => k === "loadMore").length,
    other: log.filter((_, i) => kinds[i] === "other"),
    entries: log.slice(0, DEV_LOG_ENTRIES),
  };
}

/** "Scouty dev: 54 clicks, all expand controls", plus every click that was not an allowed control. */
export function summaryLine(capture: DevCapture): string {
  const head = `Scouty dev: ${capture.total} ${capture.total === 1 ? "click" : "clicks"}`;
  if (capture.total === 0) return `${head}, nothing pressed`;
  const allowed = capture.loadMore === 0 ? (capture.other.length === 0 ? "all expand controls" : `${capture.expand} expand`) : `${capture.expand} expand, ${capture.loadMore} show more results`;
  const other = capture.other.length === 0 ? "" : `; NOT ALLOWED (${capture.other.length}): ${capture.other.map((e) => `${e.name} (${e.selector}, ${e.tag} in ${e.container})`).join("; ")}`;
  return `${head}, ${allowed}${other}`;
}
