import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { domReach, tidy, visibleText } from "../../src/reader/visible-text";

const dom = (html: string): Element => new JSDOM(`<main>${html}</main>`).window.document.querySelector("main")!;
const opts = { isVisible: (el: Element) => !el.hasAttribute("data-test-invisible"), skip: [".skipme"], duplicates: [".visually-hidden"] };

describe("visibleText", () => {
  it("breaks lines at block elements and collapses whitespace", () => {
    expect(visibleText(dom("<p>One   two</p><div>Three<br>Four</div><span>five</span> <span>six</span>"), opts)).toBe("One two\nThree\nFour\nfive six");
  });

  it("skips script, style, aria-hidden, hidden, and the hidden-duplicate classes", () => {
    const el = dom(`<p>Seen</p><script>var x = "NOPE1"</script><style>.a{content:"NOPE2"}</style>
      <i><span aria-hidden="true">NOPE3</span></i><span hidden>NOPE4</span><b><span class="visually-hidden">NOPE5</span></b><template>NOPE6</template>`);
    expect(visibleText(el, opts)).toBe("Seen");
  });

  it("skips text the injected visibility check rejects, with its subtree", () => {
    expect(visibleText(dom(`<p>Seen</p><div data-test-invisible><p>NOPE <b>deep</b></p></div><p>Also seen</p>`), opts)).toBe("Seen\nAlso seen");
  });

  it("reads the visible twin of a screen-reader duplicate once, and skips other aria-hidden content", () => {
    expect(visibleText(dom(`<h2><span aria-hidden="true">About</span><span class="visually-hidden">About</span></h2><p>Text<span aria-hidden="true">ICON</span></p><p class="skipme">no</p>`), opts)).toBe("About\nText");
  });

  it("keeps right-to-left text and emoji intact", () => {
    expect(visibleText(dom(`<p dir="rtl">قيد الاختبار 🙂</p><p>שלום 👩‍💻</p>`), opts)).toBe("قيد الاختبار 🙂\nשלום 👩‍💻");
  });

  it("tidy drops empty lines", () => {
    expect(tidy("a\n\n\n\nb  \n   c\n\n")).toBe("a\nb\nc");
  });
});

describe("domReach", () => {
  it("is near within one viewport height of the viewport, ahead below that, behind above it", () => {
    const win = new JSDOM("<main><button>x</button></main>").window;
    Object.defineProperty(win, "innerHeight", { value: 800, configurable: true });
    const el = win.document.querySelector("button")!;
    const at = (top: number): string => {
      el.getBoundingClientRect = () => ({ top, bottom: top + 20, left: 0, right: 10, width: 10, height: 20, x: 0, y: top, toJSON: () => ({}) });
      return domReach(el);
    };
    expect(at(100)).toBe("near");
    expect(at(1500)).toBe("near");
    expect(at(-700)).toBe("near");
    expect(at(1700)).toBe("ahead");
    expect(at(-900)).toBe("behind");
  });
});
