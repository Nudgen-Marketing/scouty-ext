// Allow-list sanitizer for saved LinkedIn pages (owner task E0). This repository is public, so the
// output keeps PAGE STRUCTURE ONLY: tag names, class names, roles, and the names of aria-* and
// data-* attributes. Every text, link, image, id, title, label and script is dropped or replaced.
//
//   npm run sanitize -- saved.html fixtures/sanitized/<name>.html
//
// After running it, still open the output and search it for names and words you remember.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const DROP_ELEMENTS = new Set(["script", "style", "code", "noscript", "template", "meta", "link", "base", "iframe", "object", "embed"]);
const EMPTY_ELEMENTS = new Set(["svg", "img", "picture", "video", "audio", "canvas", "source", "track"]);
const VOID_ELEMENTS = new Set(["area", "br", "col", "hr", "img", "input", "source", "track", "wbr"]);
/** Attributes whose value is kept. */
const KEEP_VALUE = new Set(["role", "dir", "lang", "type"]); // and "class", handled on its own
/** aria-* attributes whose true/false value is kept; every other aria-* and data-* keeps its name only. */
const KEEP_BOOLEAN = new Set(["aria-hidden", "aria-pressed", "aria-expanded"]);
/** Attributes kept as a bare name, because the reader's rules depend on their presence. */
const KEEP_NAME = new Set(["hidden", "disabled", "href"]);
/** The few ids the page-state selectors depend on. Every other id is dropped. */
export const KEEP_IDS = new Set(["global-nav", "captcha-internal"]);
/** Interface labels the reader depends on. A text node is kept only when it is exactly one of these. */
export const KEEP_LABELS = new Set([
  "…see more", "see more", "...see more", "show more results", "about", "experience", "education", "skills", "languages", "featured",
  "recommendations", "licenses & certifications", "contact info", "xem thêm", "…xem thêm", "hiển thị thêm kết quả",
]);
const URN = /^urn:li:activity:(\d{6,25})$/;
const FIXED_TIME = "2020-01-01T00:00:00.000Z";

/** Replaces every character with a placeholder of the same script; spaces stay. Length is kept. */
export function placeholderText(text) {
  let out = "";
  for (const ch of text) {
    if (/\s/u.test(ch)) out += ch === "\n" ? "\n" : " ";
    else if (/\p{Nd}/u.test(ch)) out += "0";
    else if (/\p{Script=Latin}/u.test(ch)) out += "x";
    else if (/\p{Script=Cyrillic}/u.test(ch)) out += "ж";
    else if (/\p{Script=Arabic}/u.test(ch)) out += "ب";
    else if (/\p{Script=Hebrew}/u.test(ch)) out += "א";
    else if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(ch)) out += "字";
    else if (/\p{Script=Hangul}/u.test(ch)) out += "가";
    else if (/\p{L}/u.test(ch)) out += "x";
    else out += "·";
  }
  return out;
}

const escapeText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s) => escapeText(s).replace(/"/g, "&quot;");

export function sanitizeHtml(html) {
  const doc = new JSDOM(html).window.document;
  let urns = 0;
  const attributes = (el) => {
    const out = [];
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (!/^[a-z][a-z0-9-]*$/.test(name)) continue;
      const value = attr.value.trim();
      if (URN.test(value) && (name.startsWith("data-") || name === "id")) {
        if (name === "id") continue;
        urns += 1;
        const digits = URN.exec(value)[1].length;
        out.push(`${name}="urn:li:activity:${("7" + String(urns).padStart(digits - 1, "0")).slice(0, digits)}"`);
      } else if (name === "datetime") out.push(`datetime="${FIXED_TIME}"`);
      else if (name === "class") {
        const classes = value.split(/\s+/).filter((c) => /^[A-Za-z_-][A-Za-z0-9_-]*$/.test(c));
        if (classes.length) out.push(`class="${escapeAttr(classes.join(" "))}"`);
      } else if (KEEP_VALUE.has(name)) {
        if (/^[A-Za-z-]{1,20}$/.test(value)) out.push(`${name}="${value}"`);
      } else if (name === "id") {
        if (KEEP_IDS.has(value)) out.push(`id="${value}"`);
      } else if (KEEP_BOOLEAN.has(name)) out.push(value === "true" || value === "false" ? `${name}="${value}"` : name);
      else if (name.startsWith("aria-") || name.startsWith("data-") || KEEP_NAME.has(name)) out.push(name);
    }
    return out.length ? ` ${out.join(" ")}` : "";
  };
  const walk = (node) => {
    if (node.nodeType === 3) {
      const text = node.nodeValue ?? "";
      const trimmed = text.trim().toLowerCase();
      if (!trimmed) return /\n/.test(text) ? "\n" : text ? " " : "";
      return KEEP_LABELS.has(trimmed) ? escapeText(text.replace(/\s+/g, " ")) : escapeText(placeholderText(text.replace(/\s+/g, " ")));
    }
    if (node.nodeType !== 1) return ""; // comments, processing instructions, CDATA
    const tag = node.tagName.toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(tag) || DROP_ELEMENTS.has(tag)) return "";
    const open = `<${tag}${attributes(node)}>`;
    if (VOID_ELEMENTS.has(tag)) return open;
    if (EMPTY_ELEMENTS.has(tag)) return `${open}</${tag}>`;
    return `${open}${Array.from(node.childNodes).map(walk).join("")}</${tag}>`;
  };
  const lang = doc.documentElement.getAttribute("lang");
  const body = doc.body ? walk(doc.body) : "<body></body>";
  return [
    "<!-- SANITIZED by tools/sanitize.mjs: page structure only. No text, link, image, id, name or script of the saved page remains. -->",
    "<!doctype html>",
    `<html${lang && /^[A-Za-z-]{1,20}$/.test(lang) ? ` lang="${lang}"` : ""}>`,
    "<head><meta charset=\"utf-8\"><title>Sanitized fixture</title></head>",
    body,
    "</html>",
    "",
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("usage: npm run sanitize -- <saved.html> <out.html>");
    process.exit(2);
  }
  await writeFile(output, sanitizeHtml(await readFile(input, "utf8")));
  console.log(`wrote ${output}. Now open it and search for names and words you remember: nothing may be found.`);
}
