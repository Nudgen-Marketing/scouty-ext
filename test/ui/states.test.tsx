import axe from "axe-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OVERLAY_SAMPLES, SAMPLES } from "../../gallery/samples";
import type { UiAction } from "../../src/messages";
import { HOST_TAG, mountOverlay, renderOverlay } from "../../src/overlay/overlay";
import { PopupView } from "../../src/popup/PopupView";
import { UI_KINDS, type UiState } from "../../src/ui/state";
import { viewFor } from "../../src/ui/view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Title and primary action of every screen, word for word from plan 12.4. */
const EXPECTED: [string, string | null, string | null][] = [
  ["Allow Scouty to work here", "Allow", "What does it read?"],
  ["Capture a LinkedIn profile into Scouty", "Connect to Scouty", null],
  ["Connecting to Scouty…", null, "Cancel"],
  ["Open a LinkedIn profile", "Open Scouty", null],
  ["Before your first capture", "I understand, capture", "Cancel"],
  ["Capture this profile", "Capture to Scouty", null],
  ["Captured 3 days ago", "Open in Scouty", "Capture again"],
  ["Reading posts", "Stop", null],
  ["Sending to Scouty…", null, null],
  ["Captured", "Open analysis in Scouty", "Done"],
  ["Captured part of this profile", "Open analysis in Scouty", "Capture again"],
  ["Sign in to LinkedIn first", "Capture again", null],
  ["LinkedIn wants to verify something", "OK", null],
  ["This profile can't be read", "OK", null],
  ["LinkedIn shows this person at a different address", "Capture this page", null],
  ["You're offline", "Try now", null],
  ["Connect to Scouty again", "Connect to Scouty", null],
  ["That's all for today", "Open Scouty", null],
  ["Update the Scouty extension", "Open the store page", null],
  ["Not available yet", "Open Scouty", null],
  ["This profile can't be captured", "OK", null],
  ["Scouty couldn't receive this capture", "Capture again", null],
  ["A capture is in progress", "Show it", null],
  ["Settings", null, "Disconnect"],
  ["This capture stopped", "OK", "Capture here"],
  ["Scouty isn't answering right now", "Try now", null],
];
const ERRORS = new Set(["linkedinSignIn", "verification", "unavailable", "addressChanged", "offline", "connectionEnded", "limit", "outdated", "notAvailable", "suppressed", "failed", "busy", "takenOver", "notAnswering"]);

let root: Root | null = null;
let container: HTMLElement | null = null;
function mount(state: UiState, options: { theme?: "light" | "dark"; reducedMotion?: boolean; onAction?: (a: UiAction) => void } = {}): HTMLElement {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = document.createElement("div");
  container.setAttribute("data-theme", options.theme ?? "light");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<PopupView view={viewFor(state)} onAction={options.onAction ?? (() => undefined)} reducedMotion={options.reducedMotion} />));
  return container;
}
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.querySelectorAll(HOST_TAG).forEach((el) => el.remove());
  root = null;
});

// jsdom has no layout, so colour contrast is measured in the gallery check (real Chromium) instead.
const audit = async (node: Element): Promise<string[]> =>
  (await axe.run(node, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`);

describe("the 26 screens", () => {
  it("there is one sample per screen, in the plan's order", () => {
    expect(SAMPLES.map((s) => s.kind)).toEqual(UI_KINDS);
    expect(SAMPLES).toHaveLength(26);
    expect(SAMPLES.map((s) => viewFor(s).n)).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
  });

  describe.each(["light", "dark"] as const)("%s theme", (theme) => {
    it.each(SAMPLES.map((state, i) => [i + 1, state.kind, state] as const))("%i %s: title, text, actions, roles, no axe violations", async (n, kind, state) => {
      const node = mount(state, { theme });
      const [title, primary, secondary] = EXPECTED[n - 1]!;
      expect(node.querySelector("h1")!.textContent).toBe(title);
      expect(node.querySelector("[data-primary]")?.textContent ?? null).toBe(primary);
      expect(node.querySelectorAll("[data-primary]").length).toBeLessThanOrEqual(1);
      if (secondary) expect([...node.querySelectorAll("[data-slot='actions'] button:not([data-primary])")].map((b) => b.textContent)).toContain(secondary);
      const message = node.querySelector("[data-slot='message']")!;
      expect(message.getAttribute("role")).toBe(ERRORS.has(kind) ? "alert" : "status");
      if (!ERRORS.has(kind)) expect(message.getAttribute("aria-live")).toBe("polite");
      expect(message.contains(node.querySelector("h1"))).toBe(true);
      // Icons are decorative: hidden from assistive technology, with text beside them.
      for (const svg of node.querySelectorAll("svg")) expect(svg.getAttribute("aria-hidden")).toBe("true");
      for (const button of node.querySelectorAll("button")) expect((button.textContent || button.getAttribute("aria-label") || "").length).toBeGreaterThan(0);
      // Every screen has a way out, except the brief "sending" one.
      if (kind !== "sending") expect(node.querySelectorAll("main button").length).toBeGreaterThan(0);
      // No jargon in what the user reads.
      expect(node.textContent).not.toMatch(/token|manifest|payload|!/i);
      expect(await audit(node)).toEqual([]);
    });
  });

  it("the exact copy of the screens with fixed text", () => {
    const text = (i: number): string => mount(SAMPLES[i]!).querySelector("main")!.textContent!;
    expect(text(0)).toContain("Scouty needs your permission to read LinkedIn profile pages you choose to capture, and to send them to your Scouty workspace.");
    expect(text(1)).toContain("This extension only reads, and only when you press Capture.");
    expect(text(3)).toContain("Go to someone's profile on LinkedIn (linkedin.com/in/…), then click this icon.");
    expect(text(3)).toContain("Connected to Example Workspace");
    expect(text(4)).toContain("It only reads. It never clicks Follow, Like, Connect or Message, never posts, and never reads your LinkedIn password, cookies or messages.");
    expect(text(4)).toContain("Tools like this are against LinkedIn's terms and LinkedIn may restrict your account.");
    expect(text(5)).toContain("synthetic-person-one → Example Workspace");
    expect(text(5)).toContain("38 captures left today");
    expect(text(7)).toContain("23 of up to 50");
    expect(text(7)).toContain("About 1 minute left");
    expect(text(8)).toContain("Still sending. Your connection seems slow.");
    expect(text(9)).toContain("Profile, 42 posts, 12 comments, 50 reactions.");
    expect(text(10)).toContain("Posts: 23 read, then stopped.");
    expect(text(10)).toContain("Reactions: not read.");
    expect(text(10)).toContain("Scouty will work with what it has and tell you what's missing.");
    expect(text(11)).toContain("Nothing was sent.");
    expect(text(14)).toContain("https://www.linkedin.com/in/synthetic-person-renamed/. Capture from that page instead.");
    expect(text(16)).toContain("Connect within a few minutes to finish sending this capture.");
    expect(text(20)).toContain("Scouty doesn't keep information about this person.");
    expect(text(21)).toContain("Nothing was saved. Press Capture again.");
    expect(text(23)).toContain("Synthetic Tester · tester@example.invalid");
    expect(text(24)).toContain("It was started again from another browser or device, or removed in Scouty. Nothing more from this capture will be sent.");
    expect(text(24)).toContain("To read this profile again from here, press Capture here.");
    expect(text(25)).toContain("Your capture is kept in this browser. Scouty will keep trying to send it while this browser is open.");
    expect(text(25)).toContain(`The next try is at about ${new Date("2026-11-23T10:42:00.000Z").toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
  });

  it("26 \"Scouty isn't answering\" is not 16 \"You're offline\": its own copy, the same Try now", () => {
    const busy = viewFor({ kind: "notAnswering", retryAt: null, sending: true, workspace: "W" });
    const offline = viewFor({ kind: "offline", workspace: "W" });
    expect(busy.n).toBe(26);
    expect(offline.n).toBe(16);
    expect(busy.title).toBe("Scouty isn't answering right now");
    expect(busy.title).not.toBe(offline.title);
    expect(busy.body.join(" ")).not.toMatch(/offline|online|connection/i);
    // Without a rate limit there is no time, only that it keeps trying.
    expect(busy.body).toEqual(["Your capture is kept in this browser. Scouty will keep trying to send it while this browser is open."]);
    expect([busy.primary, busy.secondary, busy.links]).toEqual([offline.primary, offline.secondary, offline.links]);
    expect(busy.primary).toMatchObject({ id: "retryNow", label: "Try now" });
    expect(busy.tone).toBe("alert");
    // With a rate limit it says roughly when.
    const limited = viewFor({ kind: "notAnswering", retryAt: "2026-11-23T10:42:00.000Z", sending: true, workspace: "W" });
    expect(limited.body).toHaveLength(2);
    expect(limited.body[1]).toBe(`Scouty asked to wait a little. The next try is at about ${new Date("2026-11-23T10:42:00.000Z").toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
  });

  it.each(["light", "dark"] as const)("26 at create (%s): nothing kept, Try now starts the capture again; roles and axe", async (theme) => {
    const view = viewFor({ kind: "notAnswering", retryAt: null, sending: false, workspace: "W" });
    expect(view.n).toBe(26);
    expect(view.title).toBe("Scouty isn't answering right now");
    expect(view.body).toEqual(["This capture didn't start. Nothing was read or sent.", "Try again in a moment."]);
    expect(view.primary).toMatchObject({ id: "capture", label: "Try now" });
    expect(view.body.join(" ")).not.toMatch(/offline|kept|keep trying/i);
    const limited = viewFor({ kind: "notAnswering", retryAt: "2026-11-23T10:42:00.000Z", sending: false, workspace: "W" });
    expect(limited.body[1]).toBe(`Scouty asked to wait a little. Try again after about ${new Date("2026-11-23T10:42:00.000Z").toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
    const node = mount({ kind: "notAnswering", retryAt: null, sending: false, workspace: "W" }, { theme });
    expect(node.querySelector("h1")!.textContent).toBe("Scouty isn't answering right now");
    expect(node.querySelector("[data-primary]")!.textContent).toBe("Try now");
    expect(node.querySelector("[data-slot='message']")!.getAttribute("role")).toBe("alert");
    expect(await audit(node)).toEqual([]);
  });

  it("the primary action is the first control after the title, and Enter activates it", () => {
    const onAction = vi.fn();
    const node = mount(SAMPLES[5]!, { onAction });
    const title = node.querySelector("h1")!;
    const after = [...node.querySelectorAll("button")].filter((b) => title.compareDocumentPosition(b) & 4);
    expect(after[0]!.hasAttribute("data-primary")).toBe(true);
    act(() => { title.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(onAction).toHaveBeenCalledWith("capture");
    act(() => { (node.querySelector("[data-primary]") as HTMLButtonElement).click(); });
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("moves focus to the title when the screen changes", () => {
    const node = mount(SAMPLES[5]!);
    expect(document.activeElement).toBe(node.querySelector("h1"));
    (node.querySelector("[data-primary]") as HTMLElement).focus();
    act(() => root!.render(<PopupView view={viewFor(SAMPLES[7]!)} onAction={() => undefined} />));
    expect(document.activeElement).toBe(node.querySelector("h1"));
    expect(node.querySelector("h1")!.textContent).toBe("Reading posts");
    // Progress updates within the same screen do not steal focus.
    (node.querySelector("[data-primary]") as HTMLElement).focus();
    act(() => root!.render(<PopupView view={viewFor({ ...(SAMPLES[7] as Extract<UiState, { kind: "capturing" }>), count: 24 })} onAction={() => undefined} />));
    expect(document.activeElement).toBe(node.querySelector("[data-primary]"));
  });

  it("progress has progressbar semantics with the count as its value text", () => {
    const bar = mount(SAMPLES[7]!).querySelector("[role='progressbar']")!;
    expect(bar.getAttribute("aria-valuenow")).toBe("23");
    expect(bar.getAttribute("aria-valuemax")).toBe("50");
    expect(bar.getAttribute("aria-valuetext")).toBe("23 of up to 50 posts");
    expect((bar.querySelector("[data-slot='bar']") as HTMLElement).style.width).toBe("46%");
    expect([...document.querySelectorAll("[data-slot='steps'] li")].map((li) => li.getAttribute("aria-label"))).toEqual([
      "Profile, done", "Experience, done", "Skills, done", "Posts, in progress", "Comments, waiting", "Reactions, waiting",
    ]);
  });

  it("a loading page shows an indeterminate shimmer without a value", () => {
    const node = mount(OVERLAY_SAMPLES[1]!);
    const bar = node.querySelector("[role='progressbar']")!;
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);
    expect(bar.querySelector("[data-slot='shimmer']")).not.toBeNull();
    expect(node.textContent).toContain("Opening the page…");
  });

  it("reduced motion replaces the shimmer and the spinner with a static label", () => {
    let node = mount(OVERLAY_SAMPLES[1]!, { reducedMotion: true });
    expect(node.querySelector("[data-slot='shimmer']")).toBeNull();
    expect(node.querySelector("[data-slot='progress-text']")!.textContent).toBe("Working…");
    act(() => root!.unmount());
    node = mount(SAMPLES[8]!, { reducedMotion: true });
    expect(node.querySelector(".animate-spin")).toBeNull();
    expect(node.querySelector("[data-slot='working-label']")!.textContent).toBe("Working…");
    act(() => root!.unmount());
    node = mount(SAMPLES[8]!, { reducedMotion: false });
    expect(node.querySelector(".animate-spin")).not.toBeNull();
    // Animations in the stylesheets exist only under "no-preference" or are switched off under "reduce".
    const overlayCss = readFileSync(path.join(process.cwd(), "src/overlay/overlay.css"), "utf8");
    const outside = overlayCss.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/g, "");
    expect(outside).not.toMatch(/animation|transition/);
  });

  it("settings shows the account, the workspace, the version and Disconnect in secondary style", () => {
    const node = mount(SAMPLES[23]!);
    expect(node.querySelector("[data-action='disconnect']")!.getAttribute("data-variant")).toBe("outline");
    expect(node.querySelector("[data-primary]")).toBeNull();
    expect([...node.querySelectorAll("main button")].map((b) => b.textContent)).toEqual(["Switch workspace", "What Scouty reads", "Disconnect"]);
    expect(node.querySelector("[data-action='closeSettings']")!.textContent).toBe("Back");
    expect(node.querySelector("[data-action='openSettings']")).toBeNull();
  });

  it("the settings button is offered once connected, with an accessible name", () => {
    expect(mount(SAMPLES[5]!).querySelector("[data-action='openSettings']")!.getAttribute("aria-label")).toBe("Settings");
    act(() => root!.unmount());
    expect(mount(SAMPLES[1]!).querySelector("[data-action='openSettings']")).toBeNull();
  });
});

describe("view model", () => {
  it("view.ts holds no user-visible sentence: every string comes from messages.json", () => {
    const source = readFileSync(path.join(process.cwd(), "src/ui/view.ts"), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const literals = [...source.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]!);
    const templates = [...source.matchAll(/`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1]!.replace(/\$\{[^}]*\}/g, ""));
    expect(literals.length).toBeGreaterThan(100);
    for (const literal of [...literals, ...templates]) expect(literal, literal).toMatch(/^([A-Za-z0-9_./-]*|[^A-Za-z]*)$/);
  });

  it("every message key that view.ts and the renderers name exists, and every message is used", () => {
    const messages = JSON.parse(readFileSync(path.join(process.cwd(), "_locales/en/messages.json"), "utf8")) as Record<string, { message: string }>;
    const sources = ["src/ui/view.ts", "src/popup/PopupView.tsx", "src/popup/popup.tsx", "src/overlay/overlay.ts"].map((f) => readFileSync(path.join(process.cwd(), f), "utf8")).join("\n");
    const named = new Set([...sources.matchAll(/"([a-z][A-Za-z0-9]+)"/g)].map((m) => m[1]!));
    for (const key of Object.keys(messages)) expect(named.has(key) || key === "extName" || key === "extDescription", key).toBe(true);
    for (const call of sources.matchAll(/\bt\("([A-Za-z0-9]+)"/g)) expect(messages[call[1]!], call[1]).toBeDefined();
    for (const value of Object.values(messages)) expect(value.message.trim().length).toBeGreaterThan(0);
  });

  it("counts, days and time are worded without special cases leaking", () => {
    const done = viewFor({ kind: "doneComplete", counts: { profileSections: 0, posts: 1, comments: 1, reactions: 1 }, workspace: "W" });
    expect(done.body).toEqual(["1 post, 1 comment, 1 reaction."]);
    const recent = (finalizedAt: string): string => viewFor({ kind: "recent", finalizedAt, now: "2026-11-23T10:00:00.000Z", workspace: "W" }).title;
    expect(recent("2026-11-23T09:00:00.000Z")).toBe("Captured today");
    expect(recent("2026-11-22T09:00:00.000Z")).toBe("Captured yesterday");
    expect(recent("2026-11-17T09:00:00.000Z")).toBe("Captured 6 days ago");
    expect(viewFor({ kind: "ready", slug: "s", workspace: "W", capturesLeft: 1 }).footer).toBe("1 capture left today");
    expect(viewFor({ kind: "ready", slug: "s", workspace: "W", capturesLeft: null }).footer).toBeNull();
    expect(viewFor({ kind: "limit", resetAt: "2026-11-24T08:00:00.000Z", workspace: "W" }).body[0]).toMatch(/^Your workspace has used today's captures\. More are available after .+\.$/);
    expect(viewFor({ ...(SAMPLES[10] as Extract<UiState, { kind: "donePartial" }>), notExpanded: true }).body).toHaveLength(2);
    expect(viewFor({ kind: "doneComplete", counts: { profileSections: 1, posts: 0, comments: 0, reactions: 0 }, workspace: "W", clickLog: [] }).notes).toEqual(["Development build: nothing was pressed on LinkedIn."]);
  });
});

describe("in-page overlay", () => {
  it("lives in a closed shadow root on one host element and adds no style to the host document", () => {
    const sheets = document.styleSheets.length;
    const styles = document.querySelectorAll("style, link[rel='stylesheet']").length;
    const attach = vi.spyOn(Element.prototype, "attachShadow");
    const overlay = mountOverlay(document, () => undefined);
    overlay.update(OVERLAY_SAMPLES[0]!);
    expect(attach).toHaveBeenCalledWith({ mode: "closed" });
    expect(overlay.host.shadowRoot).toBeNull(); // closed: the page cannot reach in
    expect(overlay.host.parentElement).toBe(document.documentElement);
    expect(document.querySelectorAll(HOST_TAG)).toHaveLength(1);
    expect(overlay.host.childNodes).toHaveLength(0);
    expect(overlay.host.getAttribute("style")).toBeNull();
    expect(overlay.host.getAttribute("role")).toBe("region");
    expect(overlay.host.getAttribute("aria-label")).toBe("Scouty capture");
    expect(document.styleSheets.length).toBe(sheets);
    expect(document.querySelectorAll("style, link[rel='stylesheet']").length).toBe(styles);
    expect(document.body.textContent).not.toContain("Scouty is reading this page");
    overlay.remove();
    expect(document.querySelectorAll(HOST_TAG)).toHaveLength(0);
    attach.mockRestore();
  });

  it("its stylesheet starts from `all: initial`, holds the tokens, and has no Tailwind in it", () => {
    const css = readFileSync(path.join(process.cwd(), "src/overlay/overlay.css"), "utf8");
    expect(css).toMatch(/:host \{\s*all: initial;/);
    expect(css).toContain("left: 16px");
    expect(css).toContain("bottom: 16px");
    expect(css).toContain("width: 320px");
    expect(css).not.toMatch(/@tailwind|@import|@apply|--tw-/);
    const source = readFileSync(path.join(process.cwd(), "src/overlay/overlay.ts"), "utf8");
    expect(source).not.toMatch(/from "react|\.tsx"/);
  });

  it.each(OVERLAY_SAMPLES.map((s, i) => [i, s.kind, s] as const))("%i %s: says what it is, shows the state, passes axe", async (_i, kind, state) => {
    const onAction = vi.fn();
    const card = renderOverlay(viewFor(state), onAction);
    document.body.append(card);
    expect(card.querySelector(".header")!.textContent).toBe("SScouty");
    expect(card.querySelector(".fixed-line")!.textContent).toBe("Scouty is reading this page. It won't click or post anything.");
    expect(card.querySelector(".title")!.textContent).toBe(viewFor(state).title);
    if (kind === "capturing") {
      const stop = card.querySelector("[data-action='stop']") as HTMLButtonElement;
      expect(stop.textContent).toBe("Stop");
      stop.click();
      expect(onAction).toHaveBeenCalledWith("stop");
      expect(card.querySelector("[role='progressbar']")).not.toBeNull();
    }
    // Only text nodes and buttons: nothing that can navigate or submit.
    expect(card.querySelectorAll("a, form, input, iframe, img, script").length).toBe(0);
    expect(await audit(card)).toEqual([]);
    card.remove();
  });

  it("shows the capturing count and the steps", () => {
    const card = renderOverlay(viewFor(OVERLAY_SAMPLES[0]!), () => undefined);
    const bar = card.querySelector("[role='progressbar']")!;
    expect(bar.getAttribute("aria-valuetext")).toBe("23 of up to 50 posts");
    expect(card.textContent).toContain("23 of up to 50");
    expect([...card.querySelectorAll(".steps li")].map((li) => li.textContent)).toEqual(["Profile", "Experience", "Skills", "Posts", "Comments", "Reactions"]);
  });
});
