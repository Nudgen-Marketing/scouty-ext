// The tab the popup acts on: the active tab of the window the toolbar icon was clicked in.
// (The e2e build swaps this one module; see e2e/build/target-tab.ts.)
import { ext } from "../ext";

export async function targetTabId(): Promise<number | null> {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}
