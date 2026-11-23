// The state every screen is drawn from. Plain data: built in the background, drawn by the popup
// (React) and the in-page overlay (plain DOM) through the same viewFor().
import type { ClickLogEntry } from "../messages";
import type { Counts, ManifestReason, SectionName, SectionState } from "../protocol";

export type SectionLine = { section: SectionName; state: SectionState; reason: ManifestReason | null; count: number | null; degraded?: boolean };
export type StepStatus = "done" | "current" | "waiting";

export type UiState =
  | { kind: "permission" }
  | { kind: "signedOut"; devRedirectUrl?: string | null }
  | { kind: "connecting" }
  | { kind: "notOnProfile"; workspace: string }
  | { kind: "consent"; slug: string; workspace: string }
  | { kind: "ready"; slug: string; workspace: string; capturesLeft: number | null }
  | { kind: "recent"; finalizedAt: string; now: string; workspace: string }
  | { kind: "capturing"; section: SectionName; count: number; cap: number; loading: boolean; steps: { section: SectionName; status: StepStatus }[]; minutesLeft: number; workspace: string }
  | { kind: "sending"; slow: boolean; workspace: string }
  | { kind: "doneComplete"; counts: Counts; workspace: string; clickLog?: ClickLogEntry[] | null }
  | { kind: "donePartial"; sections: SectionLine[]; notExpanded: boolean; workspace: string; clickLog?: ClickLogEntry[] | null }
  | { kind: "linkedinSignIn"; workspace: string }
  | { kind: "verification"; workspace: string }
  | { kind: "unavailable"; workspace: string }
  | { kind: "addressChanged"; address: string; workspace: string }
  | { kind: "offline"; workspace: string }
  | { kind: "connectionEnded" }
  | { kind: "limit"; resetAt: string | null; workspace: string }
  | { kind: "outdated" }
  | { kind: "notAvailable" }
  | { kind: "suppressed"; workspace: string }
  | { kind: "failed"; workspace: string }
  | { kind: "busy"; workspace: string }
  | { kind: "settings"; name: string; email: string; workspace: string; version: string; devRedirectUrl?: string | null }
  | { kind: "takenOver"; workspace: string }
  /** Sending waits because Scouty answered but could not take it now; retryAt (ISO) only for a rate limit. */
  | { kind: "notAnswering"; retryAt: string | null; workspace: string };

export type UiKind = UiState["kind"];

/**
 * The 26 screens: the 24 of plan 12.4 in its order, then two added after review (docs/DEVIATIONS.md):
 * "takenOver" (25, "This capture stopped") for a capture the server no longer knows, started again
 * from another browser or device or removed in Scouty; and "notAnswering" (26, "Scouty isn't
 * answering right now") when Scouty is reachable but failing or rate-limiting, as opposed to 16,
 * "You're offline", which is only for a network failure.
 */
export const UI_KINDS: readonly UiKind[] = [
  "permission", "signedOut", "connecting", "notOnProfile", "consent", "ready", "recent", "capturing", "sending",
  "doneComplete", "donePartial", "linkedinSignIn", "verification", "unavailable", "addressChanged", "offline",
  "connectionEnded", "limit", "outdated", "notAvailable", "suppressed", "failed", "busy", "settings", "takenOver",
  "notAnswering",
];
