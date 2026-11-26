import { beforeEach, describe, expect, it, vi } from "vitest";
import { CAPTURE_TAB_KEY, captureTab, setCaptureTab } from "../../src/background/capture-tab";
import { createGate, OVERLAY_ACTIONS, type GateDeps, type Sender } from "../../src/background/gate";
import type { CaptureState } from "../../src/background/session";
import type { Message, UiAction } from "../../src/messages";
import { fake } from "../helpers/fake-ext";

const ID = "fake-extension-id";
const POPUP: Sender = { id: ID, url: `chrome-extension://${ID}/popup.html` };
const CAPTURE_TAB = 11;
const tabSender = (tabId: number, id = ID): Sender => ({ id, url: "https://www.linkedin.com/in/synthetic-person-one/", tab: { id: tabId } });
const running = { phase: "running", tabId: CAPTURE_TAB } as unknown as CaptureState;

let deps: GateDeps & { acts: [UiAction, number | null][] };
let handle: ReturnType<typeof createGate>;

beforeEach(() => {
  const acts: [UiAction, number | null][] = [];
  deps = {
    acts,
    controller: {
      current: vi.fn(async () => running),
      retryIfDue: vi.fn(async () => undefined),
      readerHello: vi.fn(async () => ({ args: null })),
      readerProgress: vi.fn(async () => ({ stop: false })),
      readerResult: vi.fn(async () => undefined),
    },
    captureTab: async () => CAPTURE_TAB,
    overlayState: vi.fn(async () => ({ kind: "reading" }) as never),
    popupState: vi.fn(async (tabId: number | null) => ({ kind: "ready", tabId })),
    act: vi.fn(async (action: UiAction, tabId: number | null) => { acts.push([action, tabId]); }),
  };
  handle = createGate(deps);
});

describe("background message gate", () => {
  it("refuses every message from another extension or page (a foreign sender.id)", async () => {
    const messages: Message[] = [
      { type: "ui:getState", tabId: 1, settings: false }, { type: "ui:action", action: "disconnect", tabId: 1 },
      { type: "overlay:hello" }, { type: "reader:hello" },
    ];
    for (const message of messages) {
      expect(await handle(message, { ...POPUP, id: "other-extension" }), message.type).toBeNull();
      expect(await handle(message, tabSender(CAPTURE_TAB, "other-extension")), message.type).toBeNull();
      expect(await handle(message, { url: POPUP.url }), message.type).toBeNull();
    }
    expect(deps.popupState).not.toHaveBeenCalled();
    expect(deps.controller.readerHello).not.toHaveBeenCalled();
    expect(deps.controller.retryIfDue).not.toHaveBeenCalled();
    expect(deps.acts).toEqual([]);
  });

  it("refuses an overlay action from a tab that is not the capture tab", async () => {
    expect(await handle({ type: "ui:action", action: "stop", tabId: null }, tabSender(12))).toBeNull();
    expect(await handle({ type: "ui:action", action: "stop", tabId: CAPTURE_TAB }, { id: ID, url: "https://www.linkedin.com/feed/" })).toBeNull();
    expect(await handle({ type: "overlay:hello" }, tabSender(12))).toBeNull();
    expect(deps.overlayState).not.toHaveBeenCalled();
    expect(deps.acts).toEqual([]);
    // The capture tab itself is heard, and the action runs in the sender's tab, not the one it names.
    await handle({ type: "ui:action", action: "stop", tabId: 99 }, tabSender(CAPTURE_TAB));
    expect(deps.acts).toEqual([["stop", CAPTURE_TAB]]);
  });

  it("refuses an overlay action outside OVERLAY_ACTIONS, even from the capture tab", async () => {
    const popupOnly: UiAction[] = ["disconnect", "acceptConsent", "switchWorkspace", "signUp", "cancelConnect", "whatItReads", "showCapture"];
    for (const action of popupOnly) {
      expect(OVERLAY_ACTIONS).not.toContain(action);
      expect(await handle({ type: "ui:action", action, tabId: CAPTURE_TAB }, tabSender(CAPTURE_TAB)), action).toBeNull();
    }
    expect(deps.acts).toEqual([]);
  });

  it("refuses reader:* messages from the popup (an extension page)", async () => {
    expect(await handle({ type: "reader:hello" }, POPUP)).toBeNull();
    expect(await handle({ type: "reader:progress", section: "posts", count: 3, step: 1 }, POPUP)).toBeNull();
    expect(await handle({ type: "reader:result", section: "posts", seq: 1, result: { kind: "failed" } as never }, POPUP)).toBeNull();
    expect(deps.controller.readerHello).not.toHaveBeenCalled();
    expect(deps.controller.readerProgress).not.toHaveBeenCalled();
    expect(deps.controller.readerResult).not.toHaveBeenCalled();
    // The same messages from a content script in a tab reach the controller with that tab.
    await handle({ type: "reader:hello" }, tabSender(CAPTURE_TAB));
    expect(deps.controller.readerHello).toHaveBeenCalledWith(CAPTURE_TAB);
  });

  it("answers the popup's ui:getState, and tries a due capture again", async () => {
    expect(await handle({ type: "ui:getState", tabId: 5, settings: false }, POPUP)).toEqual({ kind: "ready", tabId: 5 });
    expect(deps.popupState).toHaveBeenCalledWith(5, false);
    expect(deps.controller.retryIfDue).toHaveBeenCalledTimes(1);
    // A content script may not ask for the popup's state.
    expect(await handle({ type: "ui:getState", tabId: 5, settings: false }, tabSender(CAPTURE_TAB))).toBeNull();
    // A popup action runs for the tab the popup names.
    await handle({ type: "ui:action", action: "disconnect", tabId: 5 }, POPUP);
    expect(deps.acts).toEqual([["disconnect", 5]]);
  });

  describe("after the background restarted while an idle notice was shown (deviation 28)", () => {
    const expired = { phase: "idle", notice: { kind: "expired" } } as CaptureState;

    /** A fresh gate, as a restarted background builds it: nothing in memory, the capture tab from storage.session. */
    function restarted(): GateDeps & { acts: [UiAction, number | null][] } {
      const acts: [UiAction, number | null][] = [];
      return {
        ...deps, acts,
        controller: { ...deps.controller, current: vi.fn(async () => expired) },
        captureTab,
        act: vi.fn(async (action: UiAction, tabId: number | null) => { acts.push([action, tabId]); }),
      };
    }

    it("still hears the capture tab's overlay: its hello is answered and its buttons work", async () => {
      // Before the restart: the broadcast of the running capture kept its tab.
      await setCaptureTab(CAPTURE_TAB);
      expect(fake.session.data.get(CAPTURE_TAB_KEY)).toBe(CAPTURE_TAB);
      const after = restarted();
      const gate = createGate(after);
      expect(await gate({ type: "overlay:hello" }, tabSender(CAPTURE_TAB))).toEqual({ kind: "reading" });
      expect(after.overlayState).toHaveBeenCalledWith(expired, CAPTURE_TAB);
      await gate({ type: "ui:action", action: "dismiss", tabId: null }, tabSender(CAPTURE_TAB));
      expect(after.acts).toEqual([["dismiss", CAPTURE_TAB]]);
    });

    it("refuses every other tab, and the capture tab once the notice moved on (a recent notice forgets it)", async () => {
      await setCaptureTab(CAPTURE_TAB);
      const after = restarted();
      const gate = createGate(after);
      expect(await gate({ type: "overlay:hello" }, tabSender(12))).toBeNull();
      expect(await gate({ type: "ui:action", action: "dismiss", tabId: null }, tabSender(12))).toBeNull();
      expect(await gate({ type: "ui:action", action: "disconnect", tabId: null }, tabSender(CAPTURE_TAB))).toBeNull();
      await setCaptureTab(null);
      expect(fake.session.data.has(CAPTURE_TAB_KEY)).toBe(false);
      // With no capture tab left the overlay's hello answers null, and the overlay removes itself.
      expect(await createGate(restarted())({ type: "overlay:hello" }, tabSender(CAPTURE_TAB))).toBeNull();
      expect(after.acts).toEqual([]);
    });
  });
});
