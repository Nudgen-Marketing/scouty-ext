// The only place the extension API namespace is read. Firefox exposes promise-returning
// `browser.*`; Chromium Manifest V3 exposes promise-returning `chrome.*`. No polyfill is bundled.
type ExtensionApi = typeof chrome;
const scope = globalThis as unknown as { browser?: ExtensionApi; chrome?: ExtensionApi };
export const ext: ExtensionApi = (scope.browser ?? scope.chrome) as ExtensionApi;
