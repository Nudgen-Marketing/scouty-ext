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
import { BRAND_LOGO_WIDTH, BRAND_MARK_PATHS, BRAND_WORD_PATHS } from "../../src/ui/brand";
import { UI_KINDS, type UiState } from "../../src/ui/state";
import { viewFor } from "../../src/ui/view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Title, primary and secondary action of every screen (short, plain copy: owner feedback 2026-11-24). */
const EXPECTED: [string, string | null, string | null][] = [
  ["Allow access", "Allow", "What Scouty reads"],
  ["Get started with Scouty", "Sign in", "Create account"],
  ["Connecting…", null, "Cancel"],
  ["Open a lead's profile", "Open Scouty", null],
  ["Before you start", "Got it, capture", "Cancel"],
  ["Capture this profile", "Capture", null],
  ["Captured 3 days ago", "Open in Scouty", "Capture again"],
  ["Reading posts…", "Stop", null],
  ["Sending to Scouty…", null, null],
  ["Done", "Open in Scouty", "Close"],
  ["Partly done", "Open in Scouty", "Capture again"],
  ["Sign in to this site", "Try again", null],
  ["This site wants to check it's you", "OK", null],
  ["Can't read this profile", "OK", null],
  ["This profile has moved", "Capture this page", null],
  ["You're offline", "Try now", null],
  ["Connect to Scouty again", "Connect", null],
  ["That's all for today", "Open Scouty", null],
  ["Update Scouty", "Update", null],
  ["Not available yet", "Open Scouty", null],
  ["Can't capture this profile", "OK", null],
  ["Something went wrong", "Try again", null],
  ["Already capturing", "Show it", null],
  ["Settings", null, "Disconnect"],
  ["This capture stopped", "OK", "Capture here"],
  ["Scouty isn't responding", "Try now", null],
  ["This capture timed out", "Capture", "OK"],
];
const JARGON = /token|manifest|payload|section|upload|http|status code|selector|element|capture api|api\b|!/i;
const ERRORS = new Set(["linkedinSignIn", "verification", "unavailable", "addressChanged", "offline", "connectionEnded", "limit", "outdated", "notAvailable", "suppressed", "failed", "busy", "takenOver", "notAnswering", "expired"]);

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

describe("the 27 screens", () => {
  it("there is one sample per screen, in the plan's order", () => {
    expect(SAMPLES.map((s) => s.kind)).toEqual(UI_KINDS);
    expect(SAMPLES).toHaveLength(27);
    expect(SAMPLES.map((s) => viewFor(s).n)).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
  });

  describe.each(["light", "dark"] as const)("%s theme", (theme) => {
    it.each(SAMPLES.map((state, i) => [i + 1, state.kind, state] as const))("%i %s: title, text, actions, roles, no axe violations", async (n, kind, state) => {
      const node = mount(state, { theme });
      const [title, primary, secondary] = EXPECTED[n - 1]!;
      expect(node.querySelector("h1")!.textContent).toBe(title);
      expect(node.querySelector("[data-primary]")?.textContent ?? null).toBe(primary);
      expect(node.querySelectorAll("[data-primary]").length).toBeLessThanOrEqual(1);
      if (secondary) expect([...node.querySelectorAll("main button:not([data-primary])")].map((b) => b.textContent)).toContain(secondary);
      const message = node.querySelector("[data-slot='message']")!;
      expect(message.getAttribute("role")).toBe(ERRORS.has(kind) ? "alert" : "status");
      if (!ERRORS.has(kind)) expect(message.getAttribute("aria-live")).toBe("polite");
      expect(message.contains(node.querySelector("h1"))).toBe(true);
      // The header shows the Scouty logo, named once for assistive technology.
      const logo = node.querySelector("header svg[data-slot='logo']")!;
      expect(logo.getAttribute("role")).toBe("img");
      expect(logo.getAttribute("aria-label")).toBe("Scouty");
      expect(node.querySelector("header")!.textContent).not.toContain("Scouty");
      // Icons are decorative: hidden from assistive technology, with text beside them.
      for (const svg of node.querySelectorAll("svg:not([data-slot='logo'])")) expect(svg.getAttribute("aria-hidden")).toBe("true");
      for (const button of node.querySelectorAll("button")) expect((button.textContent || button.getAttribute("aria-label") || "").length).toBeGreaterThan(0);
      // Every screen has a way out, except the brief "sending" one.
      if (kind !== "sending") expect(node.querySelectorAll("main button").length).toBeGreaterThan(0);
      // No jargon in what the user reads or hears.
      const heard = [...node.querySelectorAll("[aria-label], [aria-valuetext]")].map((el) => `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("aria-valuetext") ?? ""}`).join(" ");
      expect(`${node.textContent} ${heard}`).not.toMatch(JARGON);
      // Short: at most one sentence of body (a finished capture adds its counts line), one primary action.
      const view = viewFor(state);
      expect(view.body.length, kind).toBeLessThanOrEqual(kind === "donePartial" ? 2 : 1);
      for (const line of view.body) expect(line.split(/[.?]\s/).length, line).toBe(1);
      expect(await audit(node)).toEqual([]);
    });
  });

  it("the exact copy of the screens with fixed text", () => {
    const text = (i: number): string => mount(SAMPLES[i]!).querySelector("main")!.textContent!;
    expect(text(0)).toContain("Scouty only reads the profiles you choose.");
    expect(text(1)).toContain("Sign in, or create an account, to capture profiles.");
    expect(text(3)).toContain("Then click the Scouty icon again.");
    expect(text(4)).toContain("It never clicks, likes, connects, messages or posts for you.");
    expect(text(4)).toContain("This site may not allow tools like this and may limit your account.");
    expect(text(4)).toContain("The person may see that you viewed their profile.");
    expect(text(5)).toContain("38 captures left today");
    expect(text(7)).toContain("Scouty never clicks or posts for you.");
    expect(text(7)).toContain("23 of 50");
    expect(text(7)).toContain("About 1 min left");
    expect(text(8)).toContain("Still sending, so keep this browser open.");
    expect(text(9)).toContain("Profile · 42 posts · 12 comments · 50 reactions");
    expect(text(10)).toContain("Profile · 23 posts");
    expect(text(10)).toContain("You stopped early, so some parts are missing.");
    expect(text(11)).toContain("Sign in on this site, then try again.");
    expect(text(14)).toContain("Capture it from its new page.");
    expect(text(16)).toContain("Do it in the next few minutes to save what was already read.");
    expect(text(20)).toContain("Scouty doesn't keep data about this person.");
    expect(text(21)).toContain("Nothing was saved.");
    expect(text(23)).toContain("Synthetic Tester · tester@example.invalid");
    expect(text(24)).toContain("It was restarted elsewhere or removed in Scouty.");
    expect(text(25)).toContain(`Scouty will try again at ${new Date("2026-11-23T10:42:00.000Z").toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
    expect(text(26)).toContain("It took too long, so nothing was saved.");
    // The trust message is shown once, where Scouty is on the page: not on every screen.
    for (const [i, state] of SAMPLES.entries()) if (state.kind !== "capturing") expect(text(i), state.kind).not.toContain("never clicks or posts for you");
    // The workspace is in the header, not repeated in the text; the profile address is not shown.
    expect(text(3)).not.toContain("Example Workspace");
    expect(text(5)).not.toContain("synthetic-person-one");
    expect(text(14)).not.toContain("https://");
  });

  it.each(["light", "dark"] as const)("27 \"This capture timed out\" (%s): its own copy, not 22's; Capture starts again, OK dismisses; roles and axe", async (theme) => {
    const view = viewFor({ kind: "expired", workspace: "W" });
    const failed = viewFor({ kind: "failed", workspace: "W" });
    expect(view.n).toBe(27);
    expect(view.title).toBe("This capture timed out");
    expect(view.title).not.toBe(failed.title);
    expect(view.body).toEqual(["It took too long, so nothing was saved."]);
    expect(view.primary).toMatchObject({ id: "captureAgain", label: "Capture", variant: "primary" });
    expect(view.secondary).toMatchObject({ id: "dismiss", label: "OK" });
    // The same start-again action as 25's Capture here.
    expect(view.primary!.id).toBe(viewFor({ kind: "takenOver", workspace: "W" }).secondary!.id);
    expect(view.tone).toBe("alert");
    const onAction = vi.fn();
    const node = mount({ kind: "expired", workspace: "W" }, { theme, onAction });
    expect(node.querySelector("h1")!.textContent).toBe("This capture timed out");
    expect(node.querySelector("[data-slot='message']")!.getAttribute("role")).toBe("alert");
    const primary = node.querySelector<HTMLButtonElement>("[data-primary]")!;
    expect(primary.textContent).toBe("Capture");
    act(() => primary.click());
    const ok = [...node.querySelectorAll<HTMLButtonElement>("[data-slot='actions'] button:not([data-primary])")].find((b) => b.textContent === "OK")!;
    act(() => ok.click());
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(["captureAgain", "dismiss"]);
    expect(await audit(node)).toEqual([]);
  });

  // No dead ends: every screen with a Capture action. On a profile it is enabled and sends its
  // action; off a profile it is disabled and says what to do, so pressing it never silently fails.
  const CAPTURE_SCREENS: [UiState, string, UiAction][] = [
    [{ kind: "expired", workspace: "W" }, "Capture", "captureAgain"],
    [{ kind: "takenOver", workspace: "W" }, "Capture here", "captureAgain"],
    [{ kind: "failed", workspace: "W" }, "Try again", "captureAgain"],
    [SAMPLES[6]!, "Capture again", "captureAgain"],
    [SAMPLES[10]!, "Capture again", "captureAgain"],
    [{ kind: "linkedinSignIn", workspace: "W" }, "Try again", "captureAgain"],
    [SAMPLES[14]!, "Capture this page", "capture"],
    [{ kind: "notAnswering", retryAt: null, sending: false, workspace: "W" }, "Try now", "capture"],
  ];
  const HINT = "Open a lead's profile in this tab first.";

  describe.each(["light", "dark"] as const)("capture actions (%s)", (theme) => {
    it.each(CAPTURE_SCREENS.map(([state, label, id]) => [state.kind, label, id, state] as const))("%s on a profile: %s is enabled and sends %s; axe", async (_kind, label, id, state) => {
      const onAction = vi.fn();
      const node = mount({ ...state, onProfile: true }, { theme, onAction });
      const button = node.querySelector<HTMLButtonElement>(`[data-action='${id}']`)!;
      expect(button.textContent).toBe(label);
      expect(button.disabled).toBe(false);
      expect(button.hasAttribute("aria-describedby")).toBe(false);
      expect(node.querySelector("[data-slot='hint']")).toBeNull();
      act(() => button.click());
      expect(onAction).toHaveBeenCalledWith(id);
      expect(await audit(node)).toEqual([]);
    });

    it.each(CAPTURE_SCREENS.map(([state, label, id]) => [state.kind, label, id, state] as const))("%s off a profile: %s is disabled with the explanation; axe", async (_kind, label, id, state) => {
      const onAction = vi.fn();
      const node = mount({ ...state, onProfile: false }, { theme, onAction });
      const button = node.querySelector<HTMLButtonElement>(`[data-action='${id}']`)!;
      expect(button.textContent).toBe(label);
      expect(button.disabled).toBe(true);
      const hint = node.querySelector("[data-slot='hint']")!;
      expect(hint.textContent).toBe(HINT);
      expect(button.getAttribute("aria-describedby")).toBe(hint.id);
      act(() => button.click());
      act(() => { node.querySelector("h1")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
      expect(onAction).not.toHaveBeenCalledWith(id);
      // The other actions stay usable.
      for (const other of node.querySelectorAll<HTMLButtonElement>("[data-slot='actions'] button")) if (other !== button) expect(other.disabled).toBe(false);
      expect(await audit(node)).toEqual([]);
    });
  });

  it("off a profile, only capture actions are disabled: other screens are unchanged", () => {
    for (const state of SAMPLES) {
      const view = viewFor({ ...state, onProfile: false });
      const capture = [view.primary, view.secondary].some((a) => a && (a.id === "capture" || a.id === "captureAgain"));
      if (!capture) expect(view).toEqual(viewFor(state));
      else expect(view.hint).toBe(HINT);
    }
    // Without the field (the overlay's tab, or a sample), nothing is disabled.
    expect(viewFor({ kind: "expired", workspace: "W" }).primary!.disabled).toBeUndefined();
    expect(viewFor({ kind: "expired", workspace: "W" }).hint).toBeNull();
  });

  it("the overlay shows the same disabled action and explanation off a profile; axe", async () => {
    const onAction = vi.fn();
    const card = renderOverlay(viewFor({ kind: "expired", workspace: "W", onProfile: false }), onAction);
    document.body.append(card);
    const button = card.querySelector<HTMLButtonElement>("[data-action='captureAgain']")!;
    expect(button.disabled).toBe(true);
    expect(card.querySelector(`#${button.getAttribute("aria-describedby")}`)!.textContent).toBe(HINT);
    button.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(await audit(card)).toEqual([]);
    card.remove();
  });

  it("26 \"Scouty isn't responding\" is not 16 \"You're offline\": its own copy, the same Try now", () => {
    const busy = viewFor({ kind: "notAnswering", retryAt: null, sending: true, workspace: "W" });
    const offline = viewFor({ kind: "offline", workspace: "W" });
    expect(busy.n).toBe(26);
    expect(offline.n).toBe(16);
    expect(busy.title).toBe("Scouty isn't responding");
    expect(busy.title).not.toBe(offline.title);
    expect(busy.body.join(" ")).not.toMatch(/offline|online|connection/i);
    // Without a rate limit there is no time, only that it keeps trying.
    expect(busy.body).toEqual(["Scouty will keep trying to send your capture."]);
    expect([busy.primary, busy.secondary, busy.links]).toEqual([offline.primary, offline.secondary, offline.links]);
    expect(busy.primary).toMatchObject({ id: "retryNow", label: "Try now" });
    expect(busy.tone).toBe("alert");
    // With a rate limit it says roughly when.
    const limited = viewFor({ kind: "notAnswering", retryAt: "2026-11-23T10:42:00.000Z", sending: true, workspace: "W" });
    expect(limited.body).toHaveLength(1);
    expect(limited.body[0]).toBe(`Scouty will try again at ${new Date("2026-11-23T10:42:00.000Z").toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
  });

  it.each(["light", "dark"] as const)("26 at create (%s): nothing kept, Try now starts the capture again; roles and axe", async (theme) => {
    const view = viewFor({ kind: "notAnswering", retryAt: null, sending: false, workspace: "W" });
    expect(view.n).toBe(26);
    expect(view.title).toBe("Scouty isn't responding");
    expect(view.body).toEqual(["Please try again in a moment."]);
    expect(view.primary).toMatchObject({ id: "capture", label: "Try now" });
    expect(view.body.join(" ")).not.toMatch(/offline|kept|keep trying/i);
    const limited = viewFor({ kind: "notAnswering", retryAt: "2026-11-23T10:42:00.000Z", sending: false, workspace: "W" });
    expect(limited.body[0]).toBe(`Please try again after ${new Date("2026-11-23T10:42:00.000Z").toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
    const node = mount({ kind: "notAnswering", retryAt: null, sending: false, workspace: "W" }, { theme });
    expect(node.querySelector("h1")!.textContent).toBe("Scouty isn't responding");
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
    expect(node.querySelector("h1")!.textContent).toBe("Reading posts…");
    // Progress updates within the same screen do not steal focus.
    (node.querySelector("[data-primary]") as HTMLElement).focus();
    act(() => root!.render(<PopupView view={viewFor({ ...(SAMPLES[7] as Extract<UiState, { kind: "capturing" }>), count: 24 })} onAction={() => undefined} />));
    expect(document.activeElement).toBe(node.querySelector("[data-primary]"));
  });

  it("progress has progressbar semantics with the count as its value text, and one compact line under it", () => {
    const node = mount(SAMPLES[7]!);
    const bar = node.querySelector("[role='progressbar']")!;
    expect(bar.getAttribute("aria-valuenow")).toBe("23");
    expect(bar.getAttribute("aria-valuemax")).toBe("50");
    expect(bar.getAttribute("aria-valuetext")).toBe("23 of 50 posts");
    expect(bar.getAttribute("aria-label")).toBe("Reading posts…");
    expect((bar.querySelector("[data-slot='bar']") as HTMLElement).style.width).toBe("46%");
    expect(node.querySelector("[data-slot='progress-text']")!.textContent).toBe("23 of 50");
    expect(node.querySelector("[data-slot='estimate']")!.textContent).toBe("About 1 min left");
    // No list of steps: the title says the current one in plain words.
    expect(node.querySelector("[data-slot='steps'], ol")).toBeNull();
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

  it("the header logo is the app's: mark and outlined wordmark in the text colour, then the workspace", () => {
    const node = mount(SAMPLES[5]!);
    const logo = node.querySelector("header svg[data-slot='logo']")!;
    expect(logo.getAttribute("viewBox")).toBe(`0 0 ${BRAND_LOGO_WIDTH} 60`);
    expect(logo.getAttribute("fill")).toBe("currentColor");
    expect(logo.getAttribute("class")).toContain("text-foreground");
    expect([...logo.querySelectorAll("g[transform='translate(2 7)'] path")].map((p) => p.getAttribute("d"))).toEqual(BRAND_MARK_PATHS);
    expect([...logo.querySelectorAll(":scope > path")].map((p) => p.getAttribute("d"))).toEqual(BRAND_WORD_PATHS);
    expect(logo.nextElementSibling!.getAttribute("data-slot")).toBe("workspace");
    expect(node.querySelector("[data-slot='mark']")).toBeNull();
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
    for (const key of Object.keys(messages)) expect(named.has(key) || ["extName", "extShortName", "extTitle", "extDescription"].includes(key), key).toBe(true);
    for (const call of sources.matchAll(/\bt\("([A-Za-z0-9]+)"/g)) expect(messages[call[1]!], call[1]).toBeDefined();
    for (const value of Object.values(messages)) expect(value.message.trim().length).toBeGreaterThan(0);
  });

  it("counts, days and time are worded without special cases leaking", () => {
    const done = viewFor({ kind: "doneComplete", counts: { profileSections: 0, posts: 1, comments: 1, reactions: 1 }, workspace: "W" });
    expect(done.body).toEqual(["1 post · 1 comment · 1 reaction"]);
    const recent = (finalizedAt: string): string => viewFor({ kind: "recent", finalizedAt, now: "2026-11-23T10:00:00.000Z", workspace: "W" }).title;
    expect(recent("2026-11-23T09:00:00.000Z")).toBe("Captured today");
    expect(recent("2026-11-22T09:00:00.000Z")).toBe("Captured yesterday");
    expect(recent("2026-11-17T09:00:00.000Z")).toBe("Captured 6 days ago");
    expect(viewFor({ kind: "ready", slug: "s", workspace: "W", capturesLeft: 1 }).footer).toBe("1 capture left today");
    expect(viewFor({ kind: "ready", slug: "s", workspace: "W", capturesLeft: null }).footer).toBeNull();
    expect(viewFor({ kind: "limit", resetAt: "2026-11-24T08:00:00.000Z", workspace: "W" }).body[0]).toMatch(/^More captures after .+\.$/);
    // A partial capture: what was read, then one line on why it is partial.
    const partial = SAMPLES[10] as Extract<UiState, { kind: "donePartial" }>;
    expect(viewFor({ ...partial, notExpanded: true }).body).toEqual(["Profile · 23 posts", "You stopped early, so some parts are missing."]);
    const timedOut = partial.sections.map((line) => (line.state === "skipped" ? { ...line, reason: "timeout" as const } : line.state === "partial" ? { ...line, reason: "timeout" as const } : line));
    expect(viewFor({ ...partial, sections: timedOut }).body[1]).toBe("Some parts couldn't be read.");
    // Signed out mid-capture: reconnecting saved what was read; the line says why the rest is missing.
    const signedOut = partial.sections.map((line) => (line.state === "skipped" || line.state === "partial" ? { ...line, reason: "signed_out_of_scouty" as const } : line));
    expect(viewFor({ ...partial, sections: signedOut }).body[1]).toBe("The connection ended, so some parts are missing.");
    const whole = partial.sections.map((line) => ({ ...line, state: "complete" as const, reason: null, count: line.count ?? 3 }));
    expect(viewFor({ ...partial, sections: whole, notExpanded: true }).body).toEqual(["Profile · 23 posts · 3 comments · 3 reactions", "Some long posts weren't opened in full."]);
    // The development click log is never part of a screen, in any build (it lives in the background console and Settings → Developer).
    for (const state of [...SAMPLES, ...OVERLAY_SAMPLES]) expect(JSON.stringify(viewFor(state))).not.toMatch(/Development|controls pressed|selector|expandText|data-testid/);
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
    expect(document.body.textContent).not.toContain("Scouty never clicks or posts for you");
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
    expect(card.querySelector(".header")!.textContent).toBe("Scouty");
    const mark = card.querySelector(".header svg.mark")!;
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(mark.getAttribute("fill")).toBe("currentColor");
    expect([...mark.querySelectorAll("path")].map((p) => p.getAttribute("d"))).toEqual(BRAND_MARK_PATHS);
    expect(card.querySelector(".fixed-line")).toBeNull();
    expect(card.querySelector(".title")!.textContent).toBe(viewFor(state).title);
    // No jargon, and no more than the title, one line (two for a partial capture), the progress and the actions.
    expect(card.textContent).not.toMatch(JARGON);
    expect(card.querySelectorAll(".message > .text:not(.working-label)").length).toBeLessThanOrEqual(kind === "donePartial" ? 2 : 1);
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

  it("while reading: the step in plain words, the trust message once, a bar, the count and time left, Stop", () => {
    const card = renderOverlay(viewFor(OVERLAY_SAMPLES[0]!), () => undefined);
    expect(card.querySelector(".title")!.textContent).toBe("Reading posts…");
    expect([...card.querySelectorAll(".message > .text")].map((p) => p.textContent)).toEqual(["Scouty never clicks or posts for you."]);
    const bar = card.querySelector("[role='progressbar']")!;
    expect(bar.getAttribute("aria-valuetext")).toBe("23 of 50 posts");
    expect(card.querySelector(".progress-row")!.textContent).toBe("23 of 50About 1 min left");
    expect(card.querySelector(".steps, ol")).toBeNull();
    expect([...card.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Stop"]);
  });

  it("when done: \"Done\", the counts line, Open in Scouty and Close, nothing else", () => {
    const onAction = vi.fn();
    const card = renderOverlay(viewFor(OVERLAY_SAMPLES[3]!), onAction);
    expect(card.querySelector(".title")!.textContent).toBe("Done");
    expect([...card.querySelectorAll(".message > .text")].map((p) => p.textContent)).toEqual(["Profile · 42 posts · 12 comments · 50 reactions"]);
    const buttons = [...card.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Open in Scouty", "Close"]);
    expect(buttons[0]!.className).toBe("btn");
    for (const b of buttons) b.click();
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(["openAnalysis", "dismiss"]);
    expect(card.textContent).toBe("ScoutyDoneProfile · 42 posts · 12 comments · 50 reactionsOpen in ScoutyClose");
  });
});
