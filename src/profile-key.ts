// The profile key: the normalized public identifier from /in/<slug> (plan 8.3).
import { LIMITS } from "./protocol.ts";

const IN_PATH = /^\/in\/([^/?#]+)/;

export function profileKeyFromSlug(slug: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    return null;
  }
  const key = decoded.normalize("NFC").toLowerCase().trim();
  if (!key || key.length > LIMITS.maxSlugChars) return null;
  return key;
}

/** The raw slug of an /in/<slug>/… path, as it appears in the address. */
export function slugFromPath(pathname: string): string | null {
  const match = IN_PATH.exec(pathname);
  return match ? match[1]! : null;
}

export type ProfileAddress = { key: string; slug: string; url: string };

/** A tab address the extension may read: exactly the LinkedIn origin and an /in/<slug> path. */
export function profileFromUrl(raw: string | null | undefined, linkedinOrigin: string): ProfileAddress | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.origin !== linkedinOrigin || url.username || url.password) return null;
  const slug = slugFromPath(url.pathname);
  if (!slug) return null;
  const key = profileKeyFromSlug(slug);
  if (!key) return null;
  return { key, slug, url: `${linkedinOrigin}/in/${encodeURIComponent(key)}/` };
}

/** The page of one section for a profile key. Built only from the normalized key. */
export function sectionUrl(linkedinOrigin: string, key: string, path: string): string {
  return `${linkedinOrigin}/in/${encodeURIComponent(key)}/${path}`;
}
