// Protocol version 1 of the Scouty capture API (plan sections 5.2 to 5.4).
// The server's zod schema (scouty: src/lib/linkedin/protocol.ts) is the source of truth; this file
// mirrors it for the extension, and protocol-v1/ holds the examples both sides are tested against.
// It has no imports and only erasable TypeScript syntax, so Node can load it directly
// (the e2e API stub and the contract tools do).

export const PROTOCOL_VERSION = 1;

export const SECTION_NAMES = ["profile", "experience", "skills", "posts", "comments", "reactions"] as const;
export type SectionName = (typeof SECTION_NAMES)[number];
export const PROFILE_SECTIONS: readonly SectionName[] = ["profile", "experience", "skills"];
export const ACTIVITY_SECTIONS: readonly SectionName[] = ["posts", "comments", "reactions"];

export const STOP_REASONS = [
  "user_stopped", "tab_closed", "logged_out", "reduced_profile", "checkpoint", "not_found",
  "wrong_profile", "left_linkedin", "unknown_page", "timeout", "permission_missing", "signed_out_of_scouty",
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export const SECTION_STATES = ["complete", "partial", "skipped", "unavailable"] as const;
export type SectionState = (typeof SECTION_STATES)[number];
export const MANIFEST_ONLY_REASONS = ["cap_zero", "no_such_section", "read_failed"] as const;
export type ManifestReason = StopReason | (typeof MANIFEST_ONLY_REASONS)[number];

export const BROWSERS = ["chrome", "edge", "firefox"] as const;
export type BrowserName = (typeof BROWSERS)[number];
export const READ_MODES = ["ok", "empty", "degraded"] as const;
export type ReadMode = (typeof READ_MODES)[number];

export const LIMITS = {
  maxBlocks: 100,
  maxBlockChars: 4000,
  maxProfileSections: 20,
  maxLabelChars: 80,
  maxProfileSectionChars: 8000,
  maxProfileChars: 40000,
  // Wire bounds of the server schema. The reader clamps tighter (config.HARD_LIMITS).
  maxNameChars: 300,
  maxHeadlineChars: 500,
  maxSlugChars: 200,
  maxWireSlugChars: 1800,
  maxSeq: 10_000,
  maxSectionBodyBytes: 1_500_000,
  maxControlBodyBytes: 64_000,
} as const;

export const URN_PATTERN = /^urn:li:activity:\d{6,25}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type ProfileContent = {
  name: string | null;
  headline: string | null;
  sections: { label: string; text: string }[];
  truncated: string[];
};
export type Block = { text: string; urn: string | null; urnTime: string | null; truncated: boolean };

export type SectionPayload = {
  section: SectionName;
  seq: number;
  pageSlug: string;
  capturedAt: string;
  selectorsVersion: number;
  browser: BrowserName;
  locale: string | null;
  read: ReadMode;
  expanded: boolean;
  reachedCap: boolean;
  blockCount: number;
  profile: ProfileContent | null;
  blocks: Block[];
};

export type ManifestEntry = {
  section: SectionName;
  state: SectionState;
  reason: ManifestReason | null;
  seq: number | null;
  blockCount: number | null;
  sha256: string | null;
};
export type Manifest = { sections: ManifestEntry[]; stop: StopReason | null };

export type Caps = { posts: number; comments: number; reactions: number };
/** What was captured, as counts only. */
export type Counts = { profileSections: number; posts: number; comments: number; reactions: number };
export type Completeness = "complete" | "partial" | "insufficient";

export type SessionResponse = {
  protocol: number;
  user: { name: string | null; email: string };
  workspace: { id: string; name: string | null };
  caps: Caps;
  limits: { capturesLeftToday: number };
  serverTime: string;
};
export type CreateRequest = { linkedinUrl: string; recapture: boolean };
export type CreateCreated = {
  captureId: string; uploadToken: string; profileKey: string; profileUrl: string;
  expected: SectionName[]; caps: Caps; expiresAt: string; serverTime: string;
};
export type CreateRecent = { recent: { finalizedAt: string; completeness: "complete" | "partial"; counts: Counts } };
export type FinalizeResponse = { status: "finalized"; completeness: Completeness; captured: Counts; appUrl: string };
export type StatusResponse = {
  status: "open" | "finalized";
  received: { section: SectionName; seq: number; sha256: string; blockCount: number }[];
  expiresAt: string;
};
export type ErrorBody = {
  error: string; code?: string; minVersion?: string; storeUrl?: string;
  missing?: SectionName[]; mismatched?: SectionName[];
};

// ---- builders: the only way the extension makes a payload or a manifest ----

type PayloadMeta = {
  seq: number; pageSlug: string; capturedAt: string; selectorsVersion: number;
  browser: BrowserName; locale: string | null; read: ReadMode; expanded: boolean; reachedCap: boolean;
};

export function buildActivityPayload(section: SectionName, meta: PayloadMeta, blocks: Block[]): SectionPayload {
  return {
    section, seq: meta.seq, pageSlug: meta.pageSlug, capturedAt: meta.capturedAt,
    selectorsVersion: meta.selectorsVersion, browser: meta.browser, locale: meta.locale,
    read: meta.read, expanded: meta.expanded, reachedCap: meta.reachedCap,
    blockCount: blocks.length,
    profile: null,
    blocks: blocks.map((b) => ({ text: b.text, urn: b.urn, urnTime: b.urnTime, truncated: b.truncated })),
  };
}

export function buildProfilePayload(section: SectionName, meta: PayloadMeta, profile: ProfileContent): SectionPayload {
  return {
    section, seq: meta.seq, pageSlug: meta.pageSlug, capturedAt: meta.capturedAt,
    selectorsVersion: meta.selectorsVersion, browser: meta.browser, locale: meta.locale,
    read: meta.read, expanded: meta.expanded, reachedCap: meta.reachedCap,
    blockCount: profile.sections.length,
    profile: {
      name: section === "profile" ? profile.name : null,
      headline: section === "profile" ? profile.headline : null,
      sections: profile.sections.map((s) => ({ label: s.label, text: s.text })),
      truncated: [...profile.truncated],
    },
    blocks: [],
  };
}

export function buildManifest(entries: ManifestEntry[], stop: StopReason | null): Manifest {
  return {
    sections: entries.map((e) => {
      const uploaded = e.state === "complete" || e.state === "partial";
      return {
        section: e.section, state: e.state,
        reason: e.state === "complete" ? null : e.reason,
        seq: uploaded ? e.seq : null, blockCount: uploaded ? e.blockCount : null, sha256: uploaded ? e.sha256 : null,
      };
    }),
    stop,
  };
}

/** The exact text that is hashed and sent. Key order is the builders' order. */
export function serialize(value: SectionPayload | Manifest | CreateRequest): string {
  return JSON.stringify(value);
}

// ---- validation: mirrors the server's strict schema (unknown keys rejected, everything bounded) ----

export type Validation<T> = { ok: true; value: T } | { ok: false; code: "LINKEDIN_INVALID_PAYLOAD"; message: string };
const bad = (message: string): { ok: false; code: "LINKEDIN_INVALID_PAYLOAD"; message: string } =>
  ({ ok: false, code: "LINKEDIN_INVALID_PAYLOAD", message });

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function exactKeys(v: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of Object.keys(v)) if (!keys.includes(k)) return `unknown field "${k}"`;
  for (const k of keys) if (!(k in v)) return `missing field "${k}"`;
  return null;
}
/** At most `max` Unicode code points (an emoji counts once), as the server counts. */
const isStr = (v: unknown, max: number, min = 0): v is string =>
  typeof v === "string" && v.length >= min && v.length <= max * 2 && (v.length <= max || Array.from(v).length <= max);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isIso = (v: unknown): v is string => isStr(v, 40, 10) && !Number.isNaN(Date.parse(v));
const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

const PAYLOAD_KEYS = ["section", "seq", "pageSlug", "capturedAt", "selectorsVersion", "browser", "locale", "read", "expanded", "reachedCap", "blockCount", "profile", "blocks"] as const;

export function validateSectionPayload(input: unknown): Validation<SectionPayload> {
  if (!isRecord(input)) return bad("payload must be an object");
  const keyProblem = exactKeys(input, PAYLOAD_KEYS);
  if (keyProblem) return bad(keyProblem);
  if (!oneOf(input.section, SECTION_NAMES)) return bad("section");
  if (!isInt(input.seq, 1, LIMITS.maxSeq)) return bad("seq");
  if (!(typeof input.pageSlug === "string" && input.pageSlug.length >= 1 && input.pageSlug.length <= LIMITS.maxWireSlugChars)) return bad("pageSlug");
  if (!isIso(input.capturedAt)) return bad("capturedAt");
  if (!isInt(input.selectorsVersion, 0, 1_000_000)) return bad("selectorsVersion");
  if (!oneOf(input.browser, BROWSERS)) return bad("browser");
  if (input.locale !== null && !isStr(input.locale, 35)) return bad("locale");
  if (!oneOf(input.read, READ_MODES)) return bad("read");
  if (typeof input.expanded !== "boolean") return bad("expanded");
  if (typeof input.reachedCap !== "boolean") return bad("reachedCap");
  if (!isInt(input.blockCount, 0, LIMITS.maxBlocks)) return bad("blockCount");
  if (!Array.isArray(input.blocks)) return bad("blocks");
  const isProfileKind = PROFILE_SECTIONS.includes(input.section);

  if (isProfileKind) {
    const p = input.profile;
    if (!isRecord(p)) return bad("profile is required for this section");
    const pk = exactKeys(p, ["name", "headline", "sections", "truncated"]);
    if (pk) return bad(`profile: ${pk}`);
    if (p.name !== null && !isStr(p.name, LIMITS.maxNameChars)) return bad("profile.name");
    if (p.headline !== null && !isStr(p.headline, LIMITS.maxHeadlineChars)) return bad("profile.headline");
    if (!Array.isArray(p.sections) || p.sections.length > LIMITS.maxProfileSections) return bad("profile.sections");
    for (const s of p.sections as unknown[]) {
      if (!isRecord(s)) return bad("profile.sections item");
      const sk = exactKeys(s, ["label", "text"]);
      if (sk) return bad(`profile.sections: ${sk}`);
      if (!isStr(s.label, LIMITS.maxLabelChars)) return bad("profile.sections.label");
      if (!isStr(s.text, LIMITS.maxProfileSectionChars)) return bad("profile.sections.text");
    }
    if (!Array.isArray(p.truncated) || p.truncated.length > LIMITS.maxProfileSections) return bad("profile.truncated");
    for (const t of p.truncated as unknown[]) if (!isStr(t, LIMITS.maxLabelChars)) return bad("profile.truncated item");
    if (input.blocks.length !== 0) return bad("blocks must be empty for this section");
    if (input.blockCount !== p.sections.length) return bad("blockCount does not equal profile.sections.length");
  } else {
    if (input.profile !== null) return bad("profile must be null for this section");
    if (input.blocks.length > LIMITS.maxBlocks) return bad("too many blocks");
    for (const b of input.blocks as unknown[]) {
      if (!isRecord(b)) return bad("blocks item");
      const bk = exactKeys(b, ["text", "urn", "urnTime", "truncated"]);
      if (bk) return bad(`blocks: ${bk}`);
      if (!isStr(b.text, LIMITS.maxBlockChars)) return bad("blocks.text");
      // An odd urn or urnTime is accepted and treated as absent by the server; the reader only ever
      // sends a whole activity URN or null.
      if (b.urn !== null && !(typeof b.urn === "string" && b.urn.length <= 100)) return bad("blocks.urn");
      if (b.urnTime !== null && !(typeof b.urnTime === "string" && b.urnTime.length <= 40)) return bad("blocks.urnTime");
      if (typeof b.truncated !== "boolean") return bad("blocks.truncated");
    }
    if (input.blockCount !== input.blocks.length) return bad("blockCount does not equal blocks.length");
  }
  return { ok: true, value: input as unknown as SectionPayload };
}

export function validateManifest(input: unknown, expected?: readonly SectionName[]): Validation<Manifest> {
  if (!isRecord(input)) return bad("manifest must be an object");
  const keyProblem = exactKeys(input, ["sections", "stop"]);
  if (keyProblem) return bad(keyProblem);
  if (input.stop !== null && !oneOf(input.stop, STOP_REASONS)) return bad("stop");
  if (!Array.isArray(input.sections) || input.sections.length < 1 || input.sections.length > SECTION_NAMES.length) return bad("sections");
  const seen = new Set<string>();
  for (const e of input.sections as unknown[]) {
    if (!isRecord(e)) return bad("sections item");
    const ek = exactKeys(e, ["section", "state", "reason", "seq", "blockCount", "sha256"]);
    if (ek) return bad(`sections: ${ek}`);
    if (!oneOf(e.section, SECTION_NAMES)) return bad("sections.section");
    if (seen.has(e.section)) return bad("a section appears twice");
    seen.add(e.section);
    if (!oneOf(e.state, SECTION_STATES)) return bad("sections.state");
    const reasonOk = e.reason === null || oneOf(e.reason, STOP_REASONS) || oneOf(e.reason, MANIFEST_ONLY_REASONS);
    if (!reasonOk) return bad("sections.reason");
    if (e.state !== "complete" && e.reason === null) return bad("reason is required unless complete");
    if (e.seq !== null && !isInt(e.seq, 1, LIMITS.maxSeq)) return bad("sections.seq");
    if (e.blockCount !== null && !isInt(e.blockCount, 0, LIMITS.maxBlocks)) return bad("sections.blockCount");
    if (e.sha256 !== null && !(typeof e.sha256 === "string" && SHA256_HEX.test(e.sha256))) return bad("sections.sha256");
    const uploaded = e.state === "complete" || e.state === "partial";
    if (uploaded && (e.seq === null || e.blockCount === null || e.sha256 === null)) return bad("seq, blockCount and sha256 are required for an uploaded section");
  }
  if (expected) {
    if (seen.size !== expected.length) return bad("exactly one entry per expected section");
    for (const s of expected) if (!seen.has(s)) return bad(`missing expected section "${s}"`);
  }
  return { ok: true, value: input as unknown as Manifest };
}
