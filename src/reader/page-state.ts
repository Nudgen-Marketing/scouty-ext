// Page-state detection. Only "ok" lets a read proceed; "unknown" stops it (fail closed).
// A page is "ok" only when it is LinkedIn's signed-in application (`main#workspace`) AND it names
// the screen of the section being read (`data-sdui-screen`). A sign-in or security-check address,
// or one of the legacy sign-in, checkpoint or unavailable markers, stops the read.
import type { SectionName, StopReason } from "../protocol";
import { queryFirst, sduiScreens, selectors, statePaths } from "./selectors";

export type PageState = "ok" | "logged_out" | "reduced_profile" | "checkpoint" | "not_found" | "unknown";

const startsWithAny = (path: string, prefixes: readonly string[]): boolean => prefixes.some((prefix) => path.startsWith(prefix));

/** The state an address alone shows: LinkedIn's sign-in, authwall or checkpoint pages. */
export function pageStateFromPath(pathname: string): "logged_out" | "checkpoint" | null {
  const path = pathname.toLowerCase();
  if (startsWithAny(path, statePaths.checkpoint)) return "checkpoint";
  if (startsWithAny(path, statePaths.loggedOut)) return "logged_out";
  return null;
}

/** True when an element names exactly the expected screen of this section. */
export function onScreen(doc: Document, section: SectionName): boolean {
  const attribute = selectors.pageState.screen;
  const expected = sduiScreens[section];
  return Array.from(doc.querySelectorAll(`[${attribute}]`)).some((el) => el.getAttribute(attribute) === expected);
}

export function detectPageState(doc: Document, section: SectionName): PageState {
  const s = selectors.pageState;
  const byPath = pageStateFromPath(doc.defaultView?.location.pathname ?? doc.location?.pathname ?? "");
  if (byPath) return byPath;
  if (queryFirst(doc, s.checkpoint)) return "checkpoint";
  if (queryFirst(doc, s.loggedOut)) return "logged_out";
  if (queryFirst(doc, s.notFound)) return "not_found";
  const workspace = queryFirst(doc, s.workspace) !== null;
  if (!workspace && queryFirst(doc, s.reducedProfile)) return "reduced_profile";
  if (workspace && onScreen(doc, section)) return "ok";
  return "unknown";
}

export function stopReasonFor(state: Exclude<PageState, "ok">): StopReason {
  return state === "unknown" ? "unknown_page" : state;
}
