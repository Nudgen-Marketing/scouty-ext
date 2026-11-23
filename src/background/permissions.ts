// Host permissions at runtime. Firefox treats them as optional and Chromium users can restrict
// site access, so nothing is read or sent until both are present.
import { HOST_PATTERNS } from "../config";
import { ext } from "../ext";

export const REQUIRED_ORIGINS: readonly string[] = [HOST_PATTERNS.linkedin, HOST_PATTERNS.api];

export async function hasHostPermissions(): Promise<boolean> {
  try {
    return await ext.permissions.contains({ origins: [...REQUIRED_ORIGINS] });
  } catch {
    return false;
  }
}

/**
 * Must be called directly from a click handler, before any await: the browser only shows the
 * prompt for a user action.
 */
export function requestHostPermissions(): Promise<boolean> {
  return ext.permissions.request({ origins: [...REQUIRED_ORIGINS] }).then(Boolean, () => false);
}
