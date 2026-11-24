import { chromium, expect, test as base, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { createMockLinkedin } from "./mock-linkedin.mjs";
import { createStubApi, type StubApi } from "./stub-api.mjs";

const root = path.join(import.meta.dirname, "..");
const dist = path.join(root, "dist", "e2e");
export const LINKEDIN = "http://linkedin.test";
export const SCOUTY = "http://scouty.test";

export type Click = { tag: string; cls: string; testid: string; hidden: string; inBox: boolean; text: string; path: string; trusted: boolean };
export type Rig = {
  context: BrowserContext;
  extensionId: string;
  worker: () => Promise<Worker>;
  stub: StubApi;
  linkedin: ReturnType<typeof createMockLinkedin>;
  /** Console errors and CSP violations seen on extension pages. */
  problems: string[];
  /** Opens a mock LinkedIn page and returns it with its tab id. */
  openProfile(slug: string, rest?: string): Promise<{ page: Page; tabId: number }>;
  /** Opens the popup (as a tab) for a given tab. */
  openPopup(tabId: number | null): Promise<Page>;
  /** Connect to Scouty through the browser's web-auth flow against the stub. */
  connect(popup: Page): Promise<void>;
  /** Every click the mock pages saw in this tab. */
  clicks(page: Page): Promise<Click[]>;
  /** Text inside the overlay's closed shadow root, read through the DevTools protocol. */
  overlayText(page: Page): Promise<string>;
};

export const test = base.extend<{ rig: Rig }>({
  // eslint-disable-next-line no-empty-pattern
  rig: async ({}, use) => {
    const { extensionId, key } = JSON.parse(await readFile(path.join(root, "e2e/build/key.json"), "utf8")) as { extensionId: string; key: string };
    void key;
    const linkedin = createMockLinkedin();
    const linkedinServer = (await linkedin.listen()) as Server;
    const stub = createStubApi({
      origin: SCOUTY, linkedinHost: "linkedin.test",
      clients: { "scouty-ext-chrome": `https://${extensionId}.chromiumapp.org/` },
      // Most scenarios read the profile pages and the posts only, to keep the human-paced run short.
      caps: { posts: 5, comments: 0, reactions: 0 },
    });
    const stubServer = (await stub.listen()) as Server;
    const port = (server: Server): number => (server.address() as { port: number }).port;
    const profile = await mkdtemp(path.join(os.tmpdir(), "scouty-ext-e2e-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${dist}`,
        `--load-extension=${dist}`,
        `--host-resolver-rules=MAP linkedin.test 127.0.0.1:${port(linkedinServer)}, MAP scouty.test 127.0.0.1:${port(stubServer)}`,
      ],
    });
    const worker = async (): Promise<Worker> => context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    expect((await worker()).url()).toBe(`chrome-extension://${extensionId}/background.js`);
    const problems: string[] = [];
    const watch = (page: Page): void => {
      page.on("console", (message) => {
        if (message.type() === "error" && page.url().startsWith("chrome-extension://")) problems.push(`${page.url()}: ${message.text()}`);
      });
      page.on("pageerror", (error) => problems.push(`${page.url()}: ${error.message}`));
    };
    context.on("page", watch);

    const rig: Rig = {
      context, extensionId, worker, stub, linkedin, problems,
      async openProfile(slug, rest = "") {
        const page = await context.newPage();
        await page.goto(`${LINKEDIN}/in/${slug}/${rest}`);
        const sw = await worker();
        const tabId = await sw.evaluate(async (needle) => {
          const tabs = await chrome.tabs.query({});
          return tabs.find((tab) => (tab.url ?? "").includes(needle))?.id ?? null;
        }, `/in/`);
        if (tabId === null) throw new Error("the extension cannot see the LinkedIn tab");
        return { page, tabId };
      },
      async openPopup(tabId) {
        const popup = await context.newPage();
        await popup.addInitScript(() => {
          document.addEventListener("securitypolicyviolation", (event) => console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`));
        });
        await popup.goto(`chrome-extension://${extensionId}/popup.html${tabId === null ? "" : `?tabId=${tabId}`}`);
        return popup;
      },
      async connect(popup) {
        await popup.getByRole("button", { name: "Connect to Scouty" }).click();
        await expect(popup.getByRole("heading", { level: 1 })).not.toHaveText(/Capture a LinkedIn profile into Scouty|Connecting to Scouty…/, { timeout: 30_000 });
      },
      async clicks(page) {
        return page.evaluate(() => JSON.parse(sessionStorage.getItem("__mock_clicks") ?? "[]") as Click[]);
      },
      async overlayText(page) {
        const session = await context.newCDPSession(page);
        const { root: document } = await session.send("DOM.getDocument", { depth: -1, pierce: true });
        type Node = { nodeName: string; nodeValue?: string; children?: Node[]; shadowRoots?: Node[] };
        const texts: string[] = [];
        const visit = (node: Node, inside: boolean): void => {
          const here = inside || node.nodeName === "SCOUTY-CAPTURE-OVERLAY";
          if (here && node.nodeName === "#text" && node.nodeValue) texts.push(node.nodeValue);
          if (node.nodeName === "STYLE") return;
          for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) visit(child, here);
        };
        visit(document as Node, false);
        await session.detach();
        return texts.join(" | ");
      },
    };
    await use(rig);
    await context.close();
    await new Promise((resolve) => linkedinServer.close(resolve));
    await new Promise((resolve) => stubServer.close(resolve));
    await rm(profile, { recursive: true, force: true });
  },
});

export { expect };

/** The mock LinkedIn saw only GET navigations to the expected pages (and the assets they reference). */
export function expectReadOnly(rig: Rig, slugs: string[]): void {
  const allowed = new Set(["/static/behaviour.js", "/favicon.ico", ...slugs.flatMap((slug) => rig.linkedin.pagesOf(slug))]);
  for (const request of rig.linkedin.requests) {
    expect(request.method, `${request.method} ${request.path}`).toBe("GET");
    expect([...allowed], `unexpected request ${request.path}`).toContain(request.path);
  }
  expect(rig.linkedin.requests.some((r) => /contact-info|overlay|messaging|feed/.test(r.path))).toBe(false);
}

/**
 * The pages saw clicks only on the one allowed control, never from a person (no test clicks there
 * either): the aria-hidden "… more" button with data-testid="expandable-text-button" inside an
 * expandable-text-box. (The SDUI pages have no load-more control.)
 */
export function expectOnlyExpandClicks(clicks: Click[]): void {
  for (const click of clicks) {
    expect(click.tag, JSON.stringify(click)).toBe("button");
    expect(click.testid, JSON.stringify(click)).toBe("expandable-text-button");
    expect(click.hidden, JSON.stringify(click)).toBe("true");
    expect(click.inBox, JSON.stringify(click)).toBe(true);
    expect(click.text, JSON.stringify(click)).toBe("… more");
    expect(click.trusted, JSON.stringify(click)).toBe(false);
  }
}

export const heading = (page: Page) => page.getByRole("heading", { level: 1 });
