// The in-page overlay: progress and Stop while a capture runs, because the popup closes as soon as
// the page is clicked or navigates. Injected only into the capture tab, only during a capture.
//
// Framework-free on purpose: this runs inside the LinkedIn page. One host element appended to
// <html>, a CLOSED shadow root, a small static stylesheet built from the same tokens as the popup,
// and only text nodes, buttons and the Scouty mark (SVG) created with DOM APIs (no HTML strings). It reads nothing from
// the page, touches no storage and makes no request.
import { ext } from "../ext";
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
    message.append(el("div", attrs, bar), el("p", { class: "text" }, p.text));
    if (p.indeterminate) message.append(el("p", { class: "text working-label" }, t("working")));
  } else if (view.working) {
    message.append(el("div", { class: "progress", "aria-hidden": "true" }, el("div", { class: "shimmer" })), el("p", { class: "text working-label" }, t("working")));
  }
  const steps = view.steps.length > 0 && el("ol", { class: "steps" }, ...view.steps.map((step) => el("li", { "data-status": step.status, "aria-label": step.description }, step.label)));
  const buttons = [view.primary, view.secondary].filter((a) => a !== null).map((a) => {
    const attrs: Record<string, string> = { type: "button", class: a.variant === "primary" ? "btn" : "btn btn--outline", "data-action": a.id };
    if (a.disabled) Object.assign(attrs, { disabled: "", "aria-describedby": "action-hint" });
    const button = el("button", attrs, a.label);
    if (!a.disabled) button.addEventListener("click", () => onAction(a.id));
    return button;
  });
  return el("div", { class: "card", "data-view": view.kind },
    el("div", { class: "header" }, markSvg(), el("span", {}, t("brand"))),
    // Always shown, so the panel is never mistaken for part of LinkedIn.
    el("p", { class: "fixed-line" }, t("overlayFixedLine")),
    message,
    steps,
    view.estimate && el("p", { class: "text" }, view.estimate),
    buttons.length > 0 && el("div", { class: "actions" }, ...buttons),
    view.hint !== null && el("p", { class: "text", id: "action-hint" }, view.hint),
  );
}

export type Overlay = { host: HTMLElement; update(state: UiState): void; remove(): void };

/** Mounts the overlay: one host on <html>, a closed shadow root, all styles inside it. */
export function mountOverlay(doc: Document, onAction: (action: UiAction) => void, theme?: "light" | "dark"): Overlay {
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

function main(): void {
  const scope = globalThis as unknown as { __scoutyOverlay?: boolean };
  if (scope.__scoutyOverlay) return;
  scope.__scoutyOverlay = true;
  let overlay: Overlay | null = null;
  const send = (message: Message): Promise<unknown> => ext.runtime.sendMessage(message).catch(() => null);
  const onAction = (action: UiAction): void => void send({ type: "ui:action", action, tabId: null });
  const show = (state: UiState | null): void => {
    if (!state) {
      overlay?.remove();
      overlay = null;
      return;
    }
    overlay ??= mountOverlay(document, onAction);
    overlay.update(state);
  };
  ext.runtime.onMessage.addListener((message: Message) => {
    if (message?.type === "overlay:state") show(message.state as UiState);
    if (message?.type === "overlay:remove") show(null);
    return undefined;
  });
  void send({ type: "overlay:hello" }).then((state) => show((state as UiState | null) ?? null));
}

if (__SCOUTY_ENTRY__) main();
