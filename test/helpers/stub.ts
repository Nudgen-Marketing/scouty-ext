import { setApiDeps, createApi, type Api } from "../../src/background/api";
import * as auth from "../../src/background/auth";
import { createStubApi, type StubApi } from "../../e2e/stub-api.mjs";
import { buildActivityPayload, buildProfilePayload, type SectionName, type SectionPayload } from "../../src/protocol";
import { fake } from "./fake-ext";

export type Wired = { stub: StubApi; api: Api; sleeps: number[]; clock: { now: number } };

/** Wires the real API client and auth module to the in-process stub of the capture API. */
export function wire(options: Record<string, unknown> = {}): Wired {
  const clock = { now: Date.UTC(2026, 10, 23, 9, 0, 0) };
  const stub = createStubApi({ origin: "https://scouty.to", now: () => clock.now, ...options });
  const sleeps: number[] = [];
  setApiDeps({ transport: (url, init) => stub.fetch(url, init),
    sleep: async (ms) => { sleeps.push(ms); clock.now += ms; },
    random: () => 0.5,
    now: () => clock.now,
  });
  auth.setAuthClock(() => clock.now);
  fake.launchWebAuthFlow.mockImplementation(async (details) => {
    const response = stub.handle({ method: "GET", url: details.url });
    if (response === "drop" || response.status !== 302) return undefined;
    return response.headers.Location;
  });
  return { stub, api: createApi(auth.tokenSource), sleeps, clock };
}

export function unwire(): void {
  setApiDeps(null);
  auth.setAuthClock(null);
}

const meta = (seq: number, slug: string) => ({
  seq, pageSlug: slug, capturedAt: "2026-11-23T09:00:00.000Z", selectorsVersion: 1, browser: "chrome" as const,
  locale: "en", read: "ok" as const, expanded: true, reachedCap: false,
});

export function samplePayload(section: SectionName, seq = 1, slug = "synthetic-person-one", text = "Invented text"): SectionPayload {
  if (section === "profile" || section === "experience" || section === "skills") {
    return buildProfilePayload(section, meta(seq, slug), { name: "Synthetic Person One", headline: "Invented headline", sections: [{ label: "About", text }], truncated: [] });
  }
  return buildActivityPayload(section, meta(seq, slug), [{ text, urn: "urn:li:activity:7130316800000000000", urnTime: "2023-11-14T22:13:20.000Z", truncated: false }]);
}
