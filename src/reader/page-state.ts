// Page-state detection. Only "ok" lets a read proceed; "unknown" stops it (fail closed).
import type { StopReason } from "../protocol";
import { queryFirst, selectors } from "./selectors";

export type PageState = "ok" | "logged_out" | "reduced_profile" | "checkpoint" | "not_found" | "unknown";

export function detectPageState(doc: Document): PageState {
  const s = selectors.pageState;
  if (queryFirst(doc, s.checkpoint)) return "checkpoint";
  if (queryFirst(doc, s.loggedOut)) return "logged_out";
  if (queryFirst(doc, s.notFound)) return "not_found";
  const signedIn = queryFirst(doc, s.signedInShell) !== null;
  if (!signedIn && queryFirst(doc, s.reducedProfile)) return "reduced_profile";
  if (signedIn && queryFirst(doc, s.appMain)) return "ok";
  return "unknown";
}

export function stopReasonFor(state: Exclude<PageState, "ok">): StopReason {
  return state === "unknown" ? "unknown_page" : state;
}
