export const SLUGS: Record<string, unknown>;
export function createMockLinkedin(): {
  requests: { method: string; path: string }[];
  listen(port?: number): Promise<import("node:http").Server>;
  close(): Promise<void>;
  port(): number;
  pagesOf(slug: string): string[];
};
