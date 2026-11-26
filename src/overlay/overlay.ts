// The in-page overlay: progress and Stop while a capture runs, because the popup closes as soon as
// the page is clicked or navigates. Injected only into the capture tab, only during a capture.
//
// Framework-free on purpose: this runs inside the LinkedIn page. One host element appended to
// <html>, a CLOSED shadow root, a small static stylesheet built from the same tokens as the popup,
// and only text nodes, buttons and the Scouty mark (SVG) created with DOM APIs (no HTML strings). It reads nothing from
// the page, touches no storage and makes no request.
import { cutOff, ext } from "../ext";
import { BRAND_MARK_PATHS } from "../ui/brand";
import type { Message, UiAction } from "../messages";
import { t } from "../ui/i18n";
import type { UiState } from "../ui/state";
import tokensCss from "../ui/tokens.css?inline";
import { viewFor, type View } from "../ui/view";
import overlayCss from "./overlay.css?inline";

export const HOST_TAG = "scouty-capture-overlay";

type Child = Node | string | null | false;
/** The element helper: tag, attributes, children. Text is always a text node. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  for (const child of children) if (child) node.append(child);
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** The Scouty mark, decorative (the "Scouty" text next to it names the panel), in the text colour. */
function markSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [name, value] of Object.entries({ class: "mark", viewBox: "0 0 40 40", fill: "currentColor", "aria-hidden": "true", focusable: "false" })) svg.setAttribute(name, value);
  for (const d of BRAND_MARK_PATHS) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

export function renderOverlay(view: View, onAction: (action: UiAction) => void): HTMLElement {
  const message = el("div", { class: "message", role: view.tone === "alert" ? "alert" : "status", "aria-live": view.tone === "alert" ? "assertive" : "polite" },
    el("p", { class: "title" }, view.title),
    view.bullets.length > 0 && el("ul", { class: "lines" }, ...view.bullets.map((line) => el("li", {}, line))),
    ...view.body.map((line) => el("p", { class: "text" }, line)),
  );
  if (view.progress) {
    const p = view.progress;
    const attrs: Record<string, string> = { class: "progress", role: "progressbar", "aria-label": view.title, "aria-valuemin": "0", "aria-valuemax": String(p.max), "aria-valuetext": p.valueText };
    if (!p.indeterminate) attrs["aria-valuenow"] = String(p.value);
    const bar = el("div", { class: p.indeterminate ? "shimmer" : "bar" });
    if (!p.indeterminate) bar.style.width = `${p.max > 0 ? Math.round((Math.min(p.value, p.max) / p.max) * 100) : 0}%`;
    message.append(el("div", attrs, bar));
    // The count and the time left on one line, under the bar.
    const row = el("div", { class: "progress-row" }, el("span", {}, p.text), view.estimate && el("span", {}, view.estimate));
    message.append(row);
    if (p.indeterminate) message.append(el("p", { class: "text working-label" }, t("working")));
  } else if (view.working) {
    message.append(el("div", { class: "progress", "aria-hidden": "true" }, el("div", { class: "shimmer" })), el("p", { class: "text working-label" }, t("working")));
  }
  const buttons = [view.primary, view.secondary].filter((a) => a !== null).map((a) => {
    const attrs: Record<string, string> = { type: "button", class: a.variant === "primary" ? "btn" : "btn btn--outline", "data-action": a.id };
    if (a.disabled) Object.assign(attrs, { disabled: "", "aria-describedby": "action-hint" });
    const button = el("button", attrs, a.label);
    if (!a.disabled) button.addEventListener("click", () => onAction(a.id));
    return button;
  });
  return el("div", { class: "card", "data-view": view.kind },
    // The Scouty mark and name, so the panel is never mistaken for part of LinkedIn.
    el("div", { class: "header" }, markSvg(), el("span", {}, t("brand"))),
    message,
    buttons.length > 0 && el("div", { class: "actions" }, ...buttons),
    view.hint !== null && el("p", { class: "text", id: "action-hint" }, view.hint),
  );
}

export type Overlay = { host: HTMLElement; update(state: UiState): void; remove(): void };

/** Mounts the overlay: one host on <html>, a closed shadow root, all styles inside it. */
export function mountOverlay(doc: Document, onAction: (action: UiAction) => void, theme?: "light" | "dark"): Overlay {
  // One overlay per page: one left by an earlier copy of the extension (reloaded or updated) goes.
  for (const stale of doc.querySelectorAll(HOST_TAG)) stale.remove();
  const host = doc.createElement(HOST_TAG);
  host.setAttribute("role", "region");
  host.setAttribute("aria-label", t("overlayRegion"));
  if (theme) host.setAttribute("data-theme", theme);
  const root = host.attachShadow({ mode: "closed" });
  const style = doc.createElement("style");
  style.textContent = `${tokensCss}\n${overlayCss}`;
  const slot = doc.createElement("div");
  root.append(style, slot);
  doc.documentElement.append(host);
  return {
    host,
    update(state) {
      slot.replaceChildren(renderOverlay(viewFor(state), onAction));
    },
    remove() {
      host.remove();
    },
  };
}

/**
 * How often the overlay asks for the state again while it shows "You're offline", or "Scouty isn't
 * answering" while sending (deviation 8).
 */
export const OFFLINE_RECHECK_MS = 15_000;

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void };
const realTimers: Timers = { set: (fn, ms) => setInterval(fn, ms), clear: (id) => clearInterval(id as ReturnType<typeof setInterval>) };

/**
 * While the overlay shows "You're offline", or "Scouty isn't answering" while sending, asks for the
 * state every OFFLINE_RECHECK_MS: each ask wakes the background and lets it try sending again once
 * its wait is over (retryIfDue). Any other state (the create form of "Scouty isn't answering"
 * included: nothing waits to be sent), or none, stops asking. Returns the function to call with
 * every state shown.
 */
export function offlineRecheck(ask: () => void, timers: Timers = realTimers): (state: UiState | null) => void {
  let timer: unknown = null;
  return (state) => {
    const offline = state?.kind === "offline" || (state?.kind === "notAnswering" && state.sending);
    if (offline && timer === null) timer = timers.set(ask, OFFLINE_RECHECK_MS);
    if (!offline && timer !== null) {
      timers.clear(timer);
      timer = null;
    }
  };
}

/**
 * Starts the overlay in this document: asks the background for its screen and redraws on every
 * message. An answer of null to overlay:hello (the first ask or a recheck) means the background no
 * longer shows a capture screen in this tab, for example after it restarted with nothing to show
 * here: the overlay removes itself instead of keeping a stale screen whose buttons would do nothing
 * (deviation 28). A failed ask (no answer at all) leaves the screen as it is.
 */
export function startOverlay(doc: Document = document, timers: Timers = realTimers): void {
  const scope = globalThis as unknown as { __scoutyOverlay?: boolean };
  if (scope.__scoutyOverlay) return;
  scope.__scoutyOverlay = true;
  let overlay: Overlay | null = null;
  let orphaned = false;
  // After the extension is reloaded or updated this script is cut off: sendMessage then throws at
  // once ("Extension context invalidated") instead of rejecting. The overlay leaves the page quietly;
  // the new copy of the extension shows its own.
  const leave = (): undefined => {
    orphaned = true;
    recheck(null);
    overlay?.remove();
    overlay = null;
    return undefined;
  };
  /** The background's answer, or undefined when the ask failed (no answer). */
  const send = (message: Message): Promise<unknown> => {
    if (orphaned) return Promise.resolve(undefined);
    try {
      return ext.runtime.sendMessage(message).catch((error: unknown) => (cutOff(error) ? leave() : undefined));
    } catch (error) {
      return Promise.resolve(cutOff(error) ? leave() : undefined);
    }
  };
  const onAction = (action: UiAction): void => void send({ type: "ui:action", action, tabId: null });
  const hello = (): void => void send({ type: "overlay:hello" }).then((answer) => {
    if (answer !== undefined && !orphaned) show((answer as UiState | null) ?? null);
  });
  const recheck = offlineRecheck(hello, timers);
  const show = (state: UiState | null): void => {
    recheck(state);
    if (!state) {
      overlay?.remove();
      overlay = null;
      return;
    }
    overlay ??= mountOverlay(doc, onAction);
    overlay.update(state);
  };
  ext.runtime.onMessage.addListener((message: Message) => {
    if (orphaned) return undefined;
    if (message?.type === "overlay:state") show(message.state as UiState);
    if (message?.type === "overlay:remove") show(null);
    return undefined;
  });
  hello();
}

if (__SCOUTY_ENTRY__) startOverlay();
