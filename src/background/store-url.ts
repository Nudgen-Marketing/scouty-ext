// The store page the server may name when this version is too old (426). Opened in a new tab, so
// only the browsers' own add-on stores and the configured Scouty origin are accepted.
import { API_ORIGIN } from "../config";

const STORE_HOSTS: readonly string[] = ["chromewebstore.google.com", "chrome.google.com", "microsoftedge.microsoft.com", "addons.mozilla.org"];

/** The server's store link if it is an https page of a known add-on store or of the Scouty origin; else null. */
export function storeUrlFrom(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.origin === new URL(API_ORIGIN).origin) return url.href;
  if (url.protocol !== "https:" || url.port !== "") return null;
  return STORE_HOSTS.includes(url.hostname) ? url.href : null;
}
