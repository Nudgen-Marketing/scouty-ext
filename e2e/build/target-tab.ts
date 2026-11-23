// E2E BUILD ONLY. In the test the popup is opened as an ordinary tab, so it must be told which
// tab to capture instead of taking itself for "the active tab". Never part of a store build.
import { ext } from "../../src/ext";

export async function targetTabId(): Promise<number | null> {
  const named = new URLSearchParams(location.search).get("tabId");
  if (named && /^\d+$/.test(named)) return Number(named);
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}
