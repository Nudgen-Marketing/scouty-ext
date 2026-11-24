// Activity URN parsing, permalink and timestamp decoding.
// UNVERIFIED (owner task E0): that the high bits of the numeric activity id are a millisecond
// timestamp. If that is wrong, set URN_TIME_ENABLED to false: dates then come only from the page.
import { URN_PATTERN } from "../protocol";

export const URN_TIME_ENABLED = true;
const EARLIEST = Date.UTC(2003, 0, 1);
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/** Returns the URN only when the whole value is "urn:li:activity:<digits>"; anything else is null. */
export function parseActivityUrn(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return URN_PATTERN.test(trimmed) ? trimmed : null;
}

export type PostUrnKind = "activity" | "share" | "ugcPost";
export type PostUrn = { kind: PostUrnKind; urn: string };

const POST_PATHS = ["/feed/update/", "/analytics/post-summary/"];
const POST_URN_IN_PATH = /^urn:li:(activity|share|ugcPost):(\d{6,25})\/?$/;

/**
 * The post URN a link names, for the two link forms LinkedIn uses on activity pages:
 * `/feed/update/<urn>/` and `/analytics/post-summary/<urn>/` (one's own posts). Anything else is null.
 */
export function postUrnFromHref(href: string | null | undefined): PostUrn | null {
  if (!href) return null;
  let path: string;
  try {
    path = decodeURIComponent(new URL(href, "https://www.linkedin.com").pathname);
  } catch {
    return null;
  }
  const prefix = POST_PATHS.find((p) => path.startsWith(p));
  if (!prefix) return null;
  const match = POST_URN_IN_PATH.exec(path.slice(prefix.length));
  if (!match) return null;
  return { kind: match[1] as PostUrnKind, urn: `urn:li:${match[1]}:${match[2]}` };
}

/** The first activity URN among the links, else the first share or ugcPost URN, else null. */
export function postUrnFromLinks(hrefs: readonly (string | null)[]): PostUrn | null {
  const found = hrefs.map(postUrnFromHref).filter((u): u is PostUrn => u !== null);
  return found.find((u) => u.kind === "activity") ?? found[0] ?? null;
}

/** The public permalink of the post an activity URN names. Always on www.linkedin.com. */
export function permalinkFor(urn: string): string | null {
  const parsed = parseActivityUrn(urn);
  return parsed ? `https://www.linkedin.com/feed/update/${parsed}/` : null;
}

/** Decodes the time of the post from its activity id: the bits above the low 22 are milliseconds. */
export function urnTime(urn: string, now: number = Date.now()): string | null {
  if (!URN_TIME_ENABLED) return null;
  const parsed = parseActivityUrn(urn);
  if (!parsed) return null;
  const id = BigInt(parsed.slice(parsed.lastIndexOf(":") + 1));
  const ms = Number(id >> 22n);
  if (!Number.isSafeInteger(ms) || ms < EARLIEST || ms > now + FUTURE_TOLERANCE_MS) return null;
  return new Date(ms).toISOString();
}

/** A `<time datetime>` value, accepted only when it parses and is plausible. */
export function plausibleIsoTime(value: string | null | undefined, now: number = Date.now()): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms) || ms < EARLIEST || ms > now + FUTURE_TOLERANCE_MS) return null;
  return new Date(ms).toISOString();
}
