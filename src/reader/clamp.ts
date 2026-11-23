// Clamps and the byte budget. Lengths are Unicode code points, the unit the server's schema and
// the plan count (an emoji counts once), so a cut never splits a surrogate pair.

export const CUT_MARKER = "\n[…]\n";
const MARKER_POINTS = Array.from(CUT_MARKER).length; // 5
const encoder = new TextEncoder();

/** The length of `text` in Unicode code points. */
export function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}

/**
 * Keeps the head and the tail of a long text with a marker between. On the comments page the
 * lead's own comment comes after the post it answers, so the end must survive.
 * Counted in code points; the result never exceeds `max`, marker included.
 */
export function clampHeadTail(text: string, max = 4000, head = 1200): { text: string; clamped: boolean } {
  if (text.length <= max) return { text, clamped: false }; // UTF-16 units ≥ code points
  const points = Array.from(text);
  if (points.length <= max) return { text, clamped: false };
  const headPoints = Math.max(0, Math.min(head, max - MARKER_POINTS));
  const tailPoints = Math.max(0, max - headPoints - MARKER_POINTS);
  return { text: points.slice(0, headPoints).join("") + CUT_MARKER + points.slice(points.length - tailPoints).join(""), clamped: true };
}

/** Cuts at `max` code points, keeping the head only. Used for profile sections, labels, name and headline. */
export function clampHead(text: string, max: number): { text: string; clamped: boolean } {
  if (text.length <= max) return { text, clamped: false };
  const points = Array.from(text);
  if (points.length <= max) return { text, clamped: false };
  return { text: points.slice(0, Math.max(0, max)).join("").trimEnd(), clamped: true };
}

export function utf8Length(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Keeps the leading items whose serialized size, added to `baseBytes`, stays within `maxBytes`.
 * Sizes are UTF-8 bytes of the JSON text, which is what is uploaded.
 */
export function fitByteBudget<T>(items: readonly T[], baseBytes: number, maxBytes: number): { kept: T[]; cut: boolean } {
  const kept: T[] = [];
  let used = baseBytes;
  for (const item of items) {
    const size = utf8Length(JSON.stringify(item)) + 1;
    if (used + size > maxBytes) return { kept, cut: true };
    used += size;
    kept.push(item);
  }
  return { kept, cut: false };
}
