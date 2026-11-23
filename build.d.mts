export const PRODUCTION_API_ORIGIN: string;
export const LINKEDIN_ORIGIN: string;
export const CLIENT_IDS: Record<"chrome" | "edge" | "firefox", string>;
export const E2E: { apiOrigin: string; linkedinOrigin: string };
export function manifestFor(target: "chrome" | "edge" | "firefox", options: { apiOrigin: string; linkedinOrigin: string; version: string; key?: string }): Promise<Record<string, unknown>>;
