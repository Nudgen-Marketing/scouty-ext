// The only place the extension API namespace is read. Firefox exposes promise-returning
// `browser.*`; Chromium Manifest V3 exposes promise-returning `chrome.*`. No polyfill is bundled.
type ExtensionApi = typeof chrome;
const scope = globalThis as unknown as { browser?: ExtensionApi; chrome?: ExtensionApi };
export const ext: ExtensionApi = (scope.browser ?? scope.chrome) as ExtensionApi;

/**
 * The error a content script gets once its extension was reloaded, updated or removed: the message
 * says so and the runtime has lost its id. The overlay and the reader stop on it.
 */
export function cutOff(error: unknown): boolean {
  return /context invalidated|extension context|receiving end does not exist/i.test(error instanceof Error ? error.message : String(error)) && !ext.runtime?.id;
}

/** True once this script's extension context is gone (no runtime id): it must stop touching the page. */
export function contextGone(): boolean {
  return !ext.runtime?.id;
}
