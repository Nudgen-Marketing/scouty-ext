// Fixed sample data: one UiState per screen (the 24 of plan 12.4 in its order, then "takenOver", "This capture stopped",
// and "notAnswering", "Scouty isn't answering right now"). Used by the state gallery and by the UI tests, so both
// show exactly the same 26 states. All names are invented.
import type { UiState } from "../src/ui/state";

const workspace = "Example Workspace";

export const SAMPLES: readonly UiState[] = [
  { kind: "permission" },
  { kind: "signedOut" },
  { kind: "connecting" },
  { kind: "notOnProfile", workspace },
  { kind: "consent", slug: "synthetic-person-one", workspace },
  { kind: "ready", slug: "synthetic-person-one", workspace, capturesLeft: 38 },
  { kind: "recent", finalizedAt: "2026-11-20T09:00:00.000Z", now: "2026-11-23T10:00:00.000Z", workspace },
  {
    kind: "capturing", section: "posts", count: 23, cap: 50, loading: false, minutesLeft: 1, workspace,
    steps: [
      { section: "profile", status: "done" }, { section: "experience", status: "done" }, { section: "skills", status: "done" },
      { section: "posts", status: "current" }, { section: "comments", status: "waiting" }, { section: "reactions", status: "waiting" },
    ],
  },
  { kind: "sending", slow: true, workspace },
  { kind: "doneComplete", counts: { profileSections: 6, posts: 42, comments: 12, reactions: 50 }, workspace },
  {
    kind: "donePartial", notExpanded: false, workspace,
    sections: [
      { section: "profile", state: "complete", reason: null, count: 4 }, { section: "experience", state: "complete", reason: null, count: 1 },
      { section: "skills", state: "complete", reason: null, count: 1 }, { section: "posts", state: "partial", reason: "user_stopped", count: 23 },
      { section: "comments", state: "skipped", reason: "user_stopped", count: null }, { section: "reactions", state: "skipped", reason: "user_stopped", count: null },
    ],
  },
  { kind: "linkedinSignIn", workspace },
  { kind: "verification", workspace },
  { kind: "unavailable", workspace },
  { kind: "addressChanged", address: "https://www.linkedin.com/in/synthetic-person-renamed/", workspace },
  { kind: "offline", workspace },
  { kind: "connectionEnded" },
  { kind: "limit", resetAt: null, workspace },
  { kind: "outdated" },
  { kind: "notAvailable" },
  { kind: "suppressed", workspace },
  { kind: "failed", workspace },
  { kind: "busy", workspace },
  { kind: "settings", name: "Synthetic Tester", email: "tester@example.invalid", workspace, version: "0.1.0" },
  { kind: "takenOver", workspace },
  // A rate limit: the screen also says roughly when the next try is.
  { kind: "notAnswering", retryAt: "2026-11-23T10:42:00.000Z", sending: true, workspace },
];

/** What the in-page overlay shows during and after a capture. */
export const OVERLAY_SAMPLES: readonly UiState[] = [
  SAMPLES[7]!,
  { kind: "capturing", section: "experience", count: 0, cap: 0, loading: true, minutesLeft: 2, workspace, steps: [{ section: "profile", status: "done" }, { section: "experience", status: "current" }, { section: "skills", status: "waiting" }, { section: "posts", status: "waiting" }] },
  SAMPLES[8]!, SAMPLES[9]!, SAMPLES[10]!, SAMPLES[12]!, SAMPLES[15]!, SAMPLES[25]!,
];
