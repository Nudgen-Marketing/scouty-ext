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
/** One Chrome profile with the extension loaded: what a person has in one browser. */
export type Browser = {
  context: BrowserContext;
  extensionId: string;
  worker: () => Promise<Worker>;
  /** Console errors and CSP violations seen on extension pages. */
  problems: string[];
  /**
   * Opens a mock LinkedIn page and returns it with its tab id. With `from` (a stub app page), the
   * app opens it in a new tab as the Scouty app does (a `_blank`, `noopener` link), so its tab has an opener.
   */
  openProfile(slug: string, rest?: string, from?: Page): Promise<{ page: Page; tabId: number }>;
  /** Opens a page of the stub Scouty app in a new tab. */
  openApp(path: string): Promise<Page>;
  /** Opens the popup (as a tab) for a given tab. */
  openPopup(tabId: number | null): Promise<Page>;
  /** Connect to Scouty through the browser's web-auth flow against the stub: "Sign in", or "Create account" with `create`. */
  connect(popup: Page, options?: { create?: boolean }): Promise<void>;
  /** Every click the mock pages saw in this tab. */
  clicks(page: Page): Promise<Click[]>;
  /** Text inside the overlay's closed shadow root, read through the DevTools protocol. */
  overlayText(page: Page): Promise<string>;
};

export type Rig = Browser & {
  stub: StubApi;
  linkedin: ReturnType<typeof createMockLinkedin>;
  /** A second, separate Chrome profile with its own extension, on the same mock LinkedIn and stub Scouty. */
  secondProfile(): Promise<Browser>;
};

type Launched = Browser & { close(): Promise<void> };

async function launch(extensionId: string, linkedinPort: number, stubPort: number): Promise<Launched> {
  const profile = await mkdtemp(path.join(os.tmpdir(), "scouty-ext-e2e-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      `--host-resolver-rules=MAP linkedin.test 127.0.0.1:${linkedinPort}, MAP scouty.test 127.0.0.1:${stubPort}`,
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

  return {
    context, extensionId, worker, problems,
    async openProfile(slug, rest = "", from) {
      const url = `${LINKEDIN}/in/${slug}/${rest}`;
      let page: Page;
      if (from) {
        // The user clicks in the app tab they are looking at.
        await from.bringToFront();
        const opened = context.waitForEvent("page");
        await from.evaluate((href) => {
          const link = Object.assign(document.createElement("a"), { href, target: "_blank", rel: "noopener noreferrer", textContent: "LinkedIn" });
          document.body.append(link);
          link.click();
        }, url);
        page = await opened;
        await page.waitForLoadState();
      } else {
        page = await context.newPage();
        await page.goto(url);
      }
      const sw = await worker();
      const tabId = await sw.evaluate(async (needle) => {
        const tabs = await chrome.tabs.query({});
        return tabs.find((tab) => (tab.url ?? "").includes(needle))?.id ?? null;
      }, `/in/`);
      if (tabId === null) throw new Error("the extension cannot see the LinkedIn tab");
      return { page, tabId };
    },
    async openApp(path) {
      const page = await context.newPage();
      await page.goto(`${SCOUTY}${path}`);
      return page;
    },
    async openPopup(tabId) {
      const popup = await context.newPage();
      await popup.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`));
      });
      await popup.goto(`chrome-extension://${extensionId}/popup.html${tabId === null ? "" : `?tabId=${tabId}`}`);
      return popup;
    },
    async connect(popup, options = {}) {
      // Signed out shows "Create account" and "Sign in"; a connection that ended shows "Connect".
      const name = options.create ? "Create account" : (await popup.getByRole("button", { name: "Sign in", exact: true }).count()) ? "Sign in" : "Connect";
      await popup.getByRole("button", { name, exact: true }).click();
      await expect(popup.getByRole("heading", { level: 1 })).not.toHaveText(/^(Get started with Scouty|Connect to Scouty again|Connecting…)$/, { timeout: 30_000 });
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
    async close() {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    },
  };
}

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
    const first = await launch(extensionId, port(linkedinServer), port(stubServer));
    const others: Launched[] = [];
    const rig: Rig = {
      ...first, stub, linkedin,
      async secondProfile() {
        const other = await launch(extensionId, port(linkedinServer), port(stubServer));
        others.push(other);
        return other;
      },
    };
    await use(rig);
    for (const browser of [first, ...others]) await browser.close();
    await new Promise((resolve) => linkedinServer.close(resolve));
    await new Promise((resolve) => stubServer.close(resolve));
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
