// The state gallery: every screen of plan 12.4 in light and dark at the real popup width, plus
// the in-page overlay, drawn by the same viewFor() and the same renderers the extension uses,
// from fixed sample data. For design review and for the automated accessibility and size checks.
import { createRoot } from "react-dom/client";
import messages from "../_locales/en/messages.json";
import { renderOverlay } from "../src/overlay/overlay";
import overlayCss from "../src/overlay/overlay.css?inline";
import { PopupView } from "../src/popup/PopupView";
import { useMessages } from "../src/ui/i18n";
import tokensCss from "../src/ui/tokens.css?inline";
import { viewFor } from "../src/ui/view";
import { OVERLAY_SAMPLES, SAMPLES } from "./samples";

useMessages(messages);
const THEMES = ["light", "dark"] as const;

function Gallery() {
  return (
    <div className="grid gap-10">
      <header className="grid gap-1">
        <h1 className="text-xl font-semibold">Scouty LinkedIn Capture: state gallery</h1>
        <p className="text-sm text-muted-foreground">All 26 popup states and the in-page overlay, in light and dark, from fixed sample data. Sample names are invented.</p>
      </header>
      <section aria-label="Popup states" className="grid gap-8">
        {SAMPLES.map((state, i) => (
          <figure key={state.kind} className="m-0 grid gap-2">
            <figcaption className="text-sm font-medium">{i + 1}. {state.kind}</figcaption>
            <div className="flex flex-wrap items-start gap-6">
              {THEMES.map((theme) => (
                <div key={theme} data-theme={theme} data-frame="popup" data-state={state.kind} className="w-[360px] overflow-hidden rounded-lg border border-border bg-background text-foreground">
                  <PopupView view={viewFor(state)} onAction={() => undefined} />
                </div>
              ))}
            </div>
          </figure>
        ))}
      </section>
      <section aria-label="In-page overlay" className="grid gap-8">
        <h2 className="text-lg font-semibold">In-page overlay (320 px, bottom-left of the LinkedIn tab)</h2>
        {OVERLAY_SAMPLES.map((state, i) => (
          <figure key={i} className="m-0 grid gap-2">
            <figcaption className="text-sm font-medium">Overlay {i + 1}. {state.kind}</figcaption>
            <div className="flex flex-wrap items-start gap-6">
              {THEMES.map((theme) => <div key={theme} data-overlay-slot={i} data-overlay-theme={theme} data-state={state.kind} />)}
            </div>
          </figure>
        ))}
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Gallery />);

// The overlay is plain DOM, not React. Here its shadow root is OPEN so the checks can look inside;
// in the extension it is closed (test/ui asserts that). The frame stands in for the browser
// viewport: a transformed box is the containing block of the card's fixed position.
function mountOverlays(): void {
  const slots = document.querySelectorAll<HTMLElement>("[data-overlay-slot]");
  if (slots.length === 0) return void requestAnimationFrame(mountOverlays);
  for (const slot of slots) {
    const state = OVERLAY_SAMPLES[Number(slot.dataset.overlaySlot)]!;
    slot.setAttribute("data-frame", "overlay");
    slot.className = "gallery-viewport";
    const host = document.createElement("scouty-capture-overlay");
    host.setAttribute("data-theme", slot.dataset.overlayTheme!);
    host.setAttribute("role", "region");
    host.setAttribute("aria-label", `${messages.overlayRegion.message} ${slot.dataset.overlaySlot} ${slot.dataset.overlayTheme}`);
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `${tokensCss}\n${overlayCss}`;
    root.append(style, renderOverlay(viewFor(state), () => undefined));
    slot.append(host);
  }
  document.body.setAttribute("data-ready", "true");
}
mountOverlays();
