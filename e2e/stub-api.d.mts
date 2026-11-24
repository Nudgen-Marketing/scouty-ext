export const EXTENSION_SCOPE: string;
export type StubRequest = { method: string; path: string; headers: Record<string, string>; bytes: number; at: number; status?: number; fault?: string };
export type StubResponse = { status: number; headers: Record<string, string>; body: string | null };
export type StubCapture = {
  id: string; profileKey: string; status: "open" | "finalized" | "expired"; expected: string[]; expiresAt: number;
  sections: Map<string, { seq: number; sha256: string; blockCount: number; byteLength: number; payload: import("../src/protocol").SectionPayload }>;
  manifest?: import("../src/protocol").Manifest; finalizedAt?: number; result: import("../src/protocol").FinalizeResponse | null;
};
export type StubApi = {
  state: {
    origin: string; now: () => number; minVersion: string; storeUrl: string; available: boolean; capturesLeftToday: number;
    caps: { posts: number; comments: number; reactions: number }; capsBySlug: Record<string, Partial<{ posts: number; comments: number; reactions: number }>>;
    appPath: (profileKey: string) => string; recentAppUrl: boolean;
    accessTtlMs: number; captureTtlMs: number; suppressed: Set<string>; requests: StubRequest[]; captures: Map<string, StubCapture>;
    finalizedByKey: Map<string, unknown>; access: Map<string, { grantId: string; expiresAt: number }>; grants: Map<string, { revoked: boolean }>;
    workspace: { id: string; name: string }; user: { name: string; email: string };
  };
  handle(request: { method: string; url: string; headers?: Record<string, string>; body?: Uint8Array }): StubResponse | "drop";
  listen(port?: number): Promise<import("node:http").Server>;
  expireAccessTokens(): void;
  revokeAll(): void;
  fail(match: RegExp, kind: "503" | "500" | "502" | "504" | "drop" | "429" | "429-long" | "401" | "disabled" | "lose-answer", times?: number): void;
  clearFaults(): void;
  fetch(url: string, init?: RequestInit): Promise<Response>;
};
export function createStubApi(options?: Record<string, unknown>): StubApi;
