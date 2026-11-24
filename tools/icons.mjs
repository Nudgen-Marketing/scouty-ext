// Writes the toolbar icons icons/16.png, 32.png, 48.png and 128.png: the Scouty app icon (the app's
// src/app/icon.svg: a #18181b rounded square with the white mark), rasterized at each exact size by
// Playwright's bundled Chromium (already a dev dependency) with a transparent background.
// The committed PNGs are the source of truth; re-run after `npm run brand` changes the mark.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ICON_SIZES = [16, 32, 48, 128];

/** The mark's path data, read from src/ui/brand.ts (the copy of the app's brand-mark.ts). */
export function markPaths(brandSource) {
  const match = brandSource.match(/^export const BRAND_MARK_PATHS = (\[.*\]);$/m);
  if (!match) throw new Error("BRAND_MARK_PATHS not found in src/ui/brand.ts");
  return JSON.parse(match[1]);
}

/** The app icon, character for character the app's src/app/icon.svg. */
export function iconSvg(marks) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="#18181b"/><g transform="translate(4 4)" fill="white">${marks.map((d) => `<path d="${d}"/>`).join("")}</g></svg>`;
}

/** PNG bytes of the icon at each size, rendered at device scale 1 so a 16 px icon is 16 × 16 pixels. */
export async function renderIcons(svg, sizes = ICON_SIZES) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    const out = new Map();
    for (const size of sizes) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
      out.set(size, await page.locator("svg").screenshot({ omitBackground: true, animations: "disabled", caret: "initial" }));
    }
    return out;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const svg = iconSvg(markPaths(await readFile(path.join(root, "src/ui/brand.ts"), "utf8")));
  const pngs = await renderIcons(svg);
  await mkdir(path.join(root, "icons"), { recursive: true });
  for (const [size, png] of pngs) await writeFile(path.join(root, "icons", `${size}.png`), png);
  console.log(`wrote icons/${ICON_SIZES.join(".png, ")}.png`);
}
