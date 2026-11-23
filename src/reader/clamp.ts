// Clamps and the byte budget. Lengths are UTF-16 code units, the unit the server's schema counts,
// and a cut never splits a surrogate pair.

export const CUT_MARKER = "\n[…]\n";
const encoder = new TextEncoder();

const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

function headSlice(text: string, length: number): string {
  let end = Math.min(length, text.length);
  if (end > 0 && end < text.length && isHigh(text.charCodeAt(end - 1))) end -= 1;
  return text.slice(0, end);
}
function tailSlice(text: string, length: number): string {
  let start = Math.max(0, text.length - length);
  if (start > 0 && start < text.length && isLow(text.charCodeAt(start))) start += 1;
  return text.slice(start);
}

/**
 * Keeps the head and the tail of a long text with a marker between. On the comments page the
 * lead's own comment comes after the post it answers, so the end must survive.
 * The result never exceeds `max`, marker included.
 */
export function clampHeadTail(text: string, max = 4000, head = 1200): { text: string; clamped: boolean } {
  if (text.length <= max) return { text, clamped: false };
  const tail = Math.max(0, max - head - CUT_MARKER.length);
  return { text: headSlice(text, head) + CUT_MARKER + tailSlice(text, tail), clamped: true };
}

/** Cuts at `max`, keeping the head only. Used for profile sections, labels, name and headline. */
export function clampHead(text: string, max: number): { text: string; clamped: boolean } {
  if (text.length <= max) return { text, clamped: false };
  return { text: headSlice(text, max).trimEnd(), clamped: true };
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
