// Values fixed at build time by build.mjs (esbuild `define`), plus the hard limits.
import type { BrowserName } from "./protocol";

declare const __SCOUTY_BUILD__: {
  apiOrigin: string;
  linkedinOrigin: string;
  clientId: string;
  browser: BrowserName;
  version: string;
  debugClicks: boolean;
  dev: boolean;
};

const build = __SCOUTY_BUILD__;

/** The Scouty app origin. The only network destination of the extension. */
export const API_ORIGIN: string = build.apiOrigin;
/** The origin the reader may be injected into. Never fetched. */
export const LINKEDIN_ORIGIN: string = build.linkedinOrigin;
/** OAuth public client id of this browser's build. Not a secret. */
export const CLIENT_ID: string = build.clientId;
export const BROWSER: BrowserName = build.browser;
export const EXTENSION_VERSION: string = build.version;
export const DEBUG_CLICKS: boolean = build.debugClicks;
export const DEV_BUILD: boolean = build.dev;

export const OAUTH_SCOPE = "scouty:linkedin_capture";
export const OAUTH_RESOURCE = `${API_ORIGIN}/api/linkedin/ext`;
export const PRIVACY_URL = `${API_ORIGIN}/privacy`;

export const HOST_PATTERNS = {
  linkedin: `${LINKEDIN_ORIGIN}/in/*`,
  // Host match patterns carry no port (Firefox does not support one).
  api: `${new URL(API_ORIGIN).protocol}//${new URL(API_ORIGIN).hostname}/*`,
};

export const HARD_LIMITS = {
  maxCap: 100,
  defaultCap: 50,
  payloadByteBudget: 1_200_000,
  outboxBytes: 8_000_000,
  blockChars: 4000,
  blockHead: 1200,
  profileSectionChars: 8000,
  profileChars: 40000,
  profileSections: 20,
  labelChars: 80,
  nameChars: 120,
  headlineChars: 220,
} as const;

export const PACING = {
  minPauseMs: 1200,
  maxPauseMs: 2500,
  idleSteps: 3,
  /** Extra pauses after a scroll step while LinkedIn's loader is showing, before the step counts as idle. */
  loaderWaits: 3,
  activity: { maxSteps: 40, budgetMs: 90_000 },
  profile: { maxSteps: 15, budgetMs: 45_000 },
} as const;

export const RETRY = { baseMs: 1000, capMs: 30_000, maxAttempts: 6 } as const;
export const REFRESH_MARGIN_MS = 60_000;
export const SUPPORTED_UI_LANGS: readonly string[] = ["en", "vi"];
