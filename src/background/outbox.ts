// The outbox: what was read and not yet confirmed by Scouty. It lives in storage.session, which is
// memory only, so captured content never rests on disk in the browser. It is what makes an
// interrupted upload resumable without reading LinkedIn again.
import { HARD_LIMITS } from "../config";
import { ext } from "../ext";
import {
  buildManifest, serialize,
  type Caps, type CreateCreated, type Manifest, type ManifestEntry, type ManifestReason, type SectionName, type SectionPayload, type StopReason,
} from "../protocol";

const META_KEY = "outbox";
const bodyKey = (section: SectionName): string => `outbox.body.${section}`;

export type OutboxSection = {
  section: SectionName; seq: number; sha256: string; digestBase64: string; blockCount: number; bytes: number;
  state: "complete" | "partial"; reason: ManifestReason | null;
  /** The server confirmed these exact bytes. */
  acked: boolean;
  /** The bytes are still held (needed to re-send). */
  held: boolean;
  order: number;
};

export type Declared = { state: "skipped" | "unavailable"; reason: ManifestReason };

export type Outbox = {
  captureId: string; uploadToken: string; profileKey: string; profileUrl: string;
  expected: SectionName[]; caps: Caps; expiresAt: number;
  sections: OutboxSection[];
  declared: Partial<Record<SectionName, Declared>>;
  stop: StopReason | null;
  /** The manifest last sent and its idempotency key, until finalize succeeds. */
  finalize: { key: string; manifest: string } | null;
  nextOrder: number;
};

const session = () => ext.storage.session;

export async function digest(body: string): Promise<{ sha256: string; digestBase64: string; bytes: number }> {
  const bytes = new TextEncoder().encode(body);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  let binary = "";
  for (const byte of hash) {
    hex += byte.toString(16).padStart(2, "0");
    binary += String.fromCharCode(byte);
  }
  return { sha256: hex, digestBase64: btoa(binary), bytes: bytes.length };
}

export async function load(): Promise<Outbox | null> {
  const found = (await session().get(META_KEY))[META_KEY] as Outbox | undefined;
  return found && typeof found.captureId === "string" ? found : null;
}

async function save(outbox: Outbox): Promise<void> {
  await session().set({ [META_KEY]: outbox });
}

/**
 * When the capture runs out, on this browser's clock: the time Scouty gave it (`expiresAt - serverTime`,
 * both on Scouty's clock) from now, so a browser clock that is off does not shorten or stretch it.
 * Null when either time cannot be read.
 */
export function localExpiresAt(created: Pick<CreateCreated, "expiresAt" | "serverTime">, now: number): number | null {
  const expires = typeof created.expiresAt === "string" ? Date.parse(created.expiresAt) : NaN;
  const server = typeof created.serverTime === "string" ? Date.parse(created.serverTime) : NaN;
  if (!Number.isFinite(expires) || !Number.isFinite(server)) return null;
  // Never longer than the privacy promise, whatever window the server answers.
  return now + Math.min(expires - server, HARD_LIMITS.outboxWindowMs);
}

/**
 * Starts the outbox of a new capture. Null (nothing kept) when the create answer's times cannot be
 * read: the caller ends the capture as for any other answer it cannot use.
 */
export async function begin(created: CreateCreated, now: number = Date.now()): Promise<Outbox | null> {
  await clear();
  const expiresAt = localExpiresAt(created, now);
  if (expiresAt === null) return null;
  const outbox: Outbox = {
    captureId: created.captureId, uploadToken: created.uploadToken, profileKey: created.profileKey, profileUrl: created.profileUrl,
    expected: [...created.expected], caps: created.caps, expiresAt,
    sections: [], declared: {}, stop: null, finalize: null, nextOrder: 1,
  };
  await save(outbox);
  return outbox;
}

/** Holds the total under the bound: confirmed bytes go first, then the oldest unsent section. */
async function enforceBound(outbox: Outbox): Promise<void> {
  const held = (): number => outbox.sections.filter((s) => s.held).reduce((sum, s) => sum + s.bytes, 0);
  const oldest = (acked: boolean): OutboxSection | undefined =>
    outbox.sections.filter((s) => s.held && s.acked === acked).sort((a, b) => a.order - b.order)[0];
  while (held() > HARD_LIMITS.outboxBytes) {
    const confirmed = oldest(true);
    if (confirmed) {
      confirmed.held = false;
      await session().remove(bodyKey(confirmed.section));
      continue;
    }
    const unsent = oldest(false);
    if (!unsent) break;
    outbox.sections = outbox.sections.filter((s) => s !== unsent);
    outbox.declared[unsent.section] = { state: "skipped", reason: "read_failed" };
    await session().remove(bodyKey(unsent.section));
  }
}

/** Writes a read section to the outbox. Called before any upload is attempted. */
export async function addSection(payload: SectionPayload, state: "complete" | "partial", reason: ManifestReason | null): Promise<OutboxSection | null> {
  const outbox = await load();
  if (!outbox) return null;
  const body = serialize(payload);
  const hashed = await digest(body);
  const entry: OutboxSection = {
    section: payload.section, seq: payload.seq, sha256: hashed.sha256, digestBase64: hashed.digestBase64,
    blockCount: payload.blockCount, bytes: hashed.bytes, state, reason: state === "complete" ? null : reason,
    acked: false, held: true, order: outbox.nextOrder,
  };
  outbox.nextOrder += 1;
  outbox.sections = [...outbox.sections.filter((s) => s.section !== payload.section), entry];
  delete outbox.declared[payload.section];
  outbox.finalize = null;
  await session().set({ [bodyKey(payload.section)]: body });
  await enforceBound(outbox);
  await save(outbox);
  return outbox.sections.find((s) => s.section === payload.section) ?? null;
}

export async function bodyOf(section: SectionName): Promise<string | null> {
  const found = (await session().get(bodyKey(section)))[bodyKey(section)] as string | undefined;
  return typeof found === "string" ? found : null;
}

async function update(change: (outbox: Outbox) => void | Promise<void>): Promise<Outbox | null> {
  const outbox = await load();
  if (!outbox) return null;
  await change(outbox);
  await save(outbox);
  return outbox;
}

export function ack(section: SectionName, sha256: string): Promise<Outbox | null> {
  return update((outbox) => {
    const entry = outbox.sections.find((s) => s.section === section && s.sha256 === sha256);
    if (entry) entry.acked = true;
  });
}

/** The server already finalized this capture (a lost answer): nothing it holds is sent again. */
export function ackAll(): Promise<Outbox | null> {
  return update((outbox) => {
    for (const entry of outbox.sections) entry.acked = true;
  });
}

/** Marks a section as needing to be sent again. Returns false when its bytes are no longer held. */
export async function unack(section: SectionName): Promise<boolean> {
  let possible = false;
  await update(async (outbox) => {
    const entry = outbox.sections.find((s) => s.section === section);
    if (!entry) return;
    if (entry.held) {
      entry.acked = false;
      possible = true;
    } else {
      outbox.sections = outbox.sections.filter((s) => s !== entry);
      outbox.declared[section] = { state: "skipped", reason: "read_failed" };
    }
    outbox.finalize = null;
  });
  return possible;
}

/** Declares a section not uploaded, discarding anything read for it. */
export function declare(section: SectionName, declared: Declared): Promise<Outbox | null> {
  return update(async (outbox) => {
    outbox.sections = outbox.sections.filter((s) => s.section !== section);
    outbox.declared[section] = declared;
    outbox.finalize = null;
    await session().remove(bodyKey(section));
  });
}

export function setStop(stop: StopReason | null): Promise<Outbox | null> {
  return update((outbox) => {
    outbox.stop = stop;
    outbox.finalize = null;
  });
}

/** Sections read but not yet confirmed, oldest first. */
export function pending(outbox: Outbox): OutboxSection[] {
  return outbox.sections.filter((s) => !s.acked && s.held).sort((a, b) => a.order - b.order);
}

/** Exactly one entry per expected section, built only from what the outbox holds. */
export function manifestOf(outbox: Outbox): Manifest {
  const entries: ManifestEntry[] = outbox.expected.map((section) => {
    const read = outbox.sections.find((s) => s.section === section);
    if (read) return { section, state: read.state, reason: read.reason, seq: read.seq, blockCount: read.blockCount, sha256: read.sha256 };
    const declared = outbox.declared[section];
    if (declared) return { section, state: declared.state, reason: declared.reason, seq: null, blockCount: null, sha256: null };
    return { section, state: "skipped", reason: outbox.stop ?? "read_failed", seq: null, blockCount: null, sha256: null };
  });
  return buildManifest(entries, outbox.stop);
}

/** The manifest to send and its idempotency key: the same key for as long as the manifest is the same. */
export async function finalizeRequest(newKey: () => string): Promise<{ manifest: Manifest; key: string } | null> {
  const outbox = await load();
  if (!outbox) return null;
  const manifest = manifestOf(outbox);
  const text = serialize(manifest);
  if (!outbox.finalize || outbox.finalize.manifest !== text) {
    outbox.finalize = { key: newKey(), manifest: text };
    await save(outbox);
  }
  return { manifest, key: outbox.finalize.key };
}

export async function clear(): Promise<void> {
  const all = await session().get(null);
  const keys = Object.keys(all).filter((key) => key === META_KEY || key.startsWith("outbox.body."));
  if (keys.length) await session().remove(keys);
}

/** Second guard: a browser start never finds a capture left over from the previous run. */
export function purgeOnStartup(): Promise<void> {
  return clear();
}

export async function purgeIfExpired(now: number): Promise<boolean> {
  const outbox = await load();
  if (outbox && outbox.expiresAt <= now) {
    await clear();
    return true;
  }
  return false;
}
