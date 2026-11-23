// Messages between the extension's own contexts (runtime messaging only; never the page).
import type { BrowserName, SectionName, SectionPayload, StopReason } from "./protocol";

export type ClickLogEntry = { tag: string; selector: string; name: string; container: string };

export type ReaderArgs = { section: SectionName; profileKey: string; seq: number; cap: number; browser: BrowserName };

export type ReaderResult =
  /** The page was read. `state` says whether to its end (or cap) or only in part. */
  | { kind: "read"; payload: SectionPayload; state: "complete" | "partial"; reason: StopReason | null; clickLog: ClickLogEntry[] }
  /** The page is in a state that must not be read. Nothing is kept. */
  | { kind: "stopped"; reason: StopReason; address: string | null; clickLog: ClickLogEntry[] }
  /** Nothing readable was found. */
  | { kind: "failed"; clickLog: ClickLogEntry[] };

export type ReaderMessage =
  | { type: "reader:hello" }
  | { type: "reader:progress"; section: SectionName; count: number; step: number }
  | { type: "reader:result"; section: SectionName; seq: number; result: ReaderResult };

export type UiAction =
  | "allow" | "whatItReads" | "connect" | "cancelConnect" | "openScouty" | "acceptConsent" | "cancel"
  | "capture" | "captureAgain" | "openAnalysis" | "stop" | "dismiss" | "retryNow" | "openStore"
  | "showCapture" | "openSettings" | "closeSettings" | "disconnect" | "switchWorkspace";

export type UiMessage =
  | { type: "ui:getState"; tabId: number | null; settings: boolean }
  | { type: "ui:action"; action: UiAction; tabId: number | null }
  | { type: "ui:changed" }
  | { type: "overlay:hello" }
  | { type: "overlay:state"; state: unknown; clickLog: ClickLogEntry[] | null }
  | { type: "overlay:remove" };

export type Message = ReaderMessage | UiMessage;
