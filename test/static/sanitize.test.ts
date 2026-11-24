import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { detectPageState } from "../../src/reader/page-state";
import { KEEP_LABELS, placeholderText, sanitizeHtml } from "../../tools/sanitize.mjs";

const SECRET = ["Realname", "Surname", "Realcompany", "secretword", "privatevalue", "hiddenmarker", "jsonisland", "commentleak", "scriptleak", "styleleak", "titleleak", "altleak", "arialeak", "dataleak", "hrefleak", "srcleak", "idleak", "templateleak", "Кириллица", "العربية", "漢字漢字", "Việtngữ"];
const page = `<!doctype html><html lang="en"><head><title>Realname Surname titleleak</title>
<meta name="description" content="Realname secretword"><link rel="canonical" href="https://www.linkedin.com/in/hrefleak/">
<style>.x::after{content:"styleleak"}</style><script>window.__data = {"name":"scriptleak Realname"}</script></head>
<body class="render-mode-BIGPIPE" data-secret="dataleak">
<!-- commentleak Realname Surname -->
<header id="global-nav" class="global-nav"><a href="https://www.linkedin.com/in/hrefleak/" title="titleleak" id="idleak">Realname Surname</a></header>
<code id="bpr-guid-1" style="display:none">{"data":{"firstName":"jsonisland","lastName":"Surname"}}</code>
<template><p>templateleak</p></template><noscript>Realname noscript secretword</noscript>
<main class="scaffold-layout__main" aria-label="arialeak Realname">
  <img src="https://media.example/srcleak.jpg" alt="altleak Realname" class="avatar">
  <svg viewBox="0 0 24 24"><title>titleleak</title><text>secretword</text><path d="M1 1"/></svg>
  <h1 class="text-heading-xlarge">Realname Surname</h1>
  <section class="artdeco-card"><h2><span aria-hidden="true">About</span></h2><div class="inline-show-more-text">secretword at Realcompany, Кириллица العربية 漢字漢字 Việtngữ 12345 🙂
    <button type="button" class="inline-show-more-text__button" aria-expanded="false" aria-label="arialeak">…see more</button></div></section>
  <div class="feed-shared-update-v2" data-urn="urn:li:activity:7130316800000000000" data-id="privatevalue" id="ember123">
    <time datetime="2023-11-14T22:13:20.000Z">2w</time><p>hiddenmarker post text by Realname</p>
    <button aria-pressed="false" aria-label="React Like to Realname's post" data-reaction-details="privatevalue">Like</button>
    <input type="text" value="privatevalue" placeholder="secretword"><span hidden>hiddenmarker</span>
  </div>
  <div id="captcha-internal" onclick="alert('scriptleak')" style="background:url(https://media.example/srcleak.png)"></div>
</main></body></html>`;

describe("sanitizer", () => {
  const out = sanitizeHtml(page);

  it("lets no secret through, in text, attributes, comments, scripts, styles or JSON islands", () => {
    for (const secret of SECRET) expect(out.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    expect(out).not.toMatch(/https?:|linkedin\.com|media\.example|7130316800000000000|2023-11-14|ember123|bpr-guid|onclick|style=|12345|🙂/);
  });

  it("no input string longer than three characters survives, apart from structure and the listed interface labels", () => {
    const allowed = new Set<string>();
    const dom = new JSDOM(page).window.document;
    for (const el of Array.from(dom.querySelectorAll("*"))) {
      allowed.add(el.tagName.toLowerCase());
      for (const attr of Array.from(el.attributes)) {
        for (const part of attr.name.split(/[^A-Za-z0-9]+/)) allowed.add(part.toLowerCase());
        if (["class", "role", "dir", "lang", "type"].includes(attr.name)) for (const part of attr.value.split(/[^A-Za-z0-9]+/)) allowed.add(part.toLowerCase());
      }
    }
    for (const label of KEEP_LABELS) for (const part of label.split(/[^\p{L}\p{N}]+/u)) allowed.add(part);
    for (const word of ["global", "captcha", "internal", "true", "false", "sanitized", "sanitize", "tools", "page", "structure", "only", "text", "link", "image", "name", "script", "saved", "remains", "doctype", "html", "head", "meta", "charset", "title", "fixture", "body", "activity", "urn", "000z"]) allowed.add(word);
    const tokens = new Set(page.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 3));
    const outTokens = new Set(out.split(/[^\p{L}\p{N}]+/u).map((token) => token.toLowerCase()));
    const leaked = [...tokens].filter((token) => outTokens.has(token.toLowerCase()) && !allowed.has(token.toLowerCase()));
    expect(leaked).toEqual([]);
  });

  it("keeps what the reader needs: structure, classes, roles, flags, a made-up URN and a fixed date", () => {
    const doc = new JSDOM(out).window.document;
    expect(out.startsWith("<!-- SANITIZED by tools/sanitize.mjs")).toBe(true);
    // The kept ids and classes still drive page-state detection.
    expect(detectPageState(doc, "profile")).toBe("checkpoint");
    doc.querySelector("#captcha-internal")!.remove();
    // Legacy markup is never "ok" any more (selectors version 2 needs the SDUI workspace and screen).
    expect(detectPageState(doc, "profile")).toBe("unknown");
    expect(doc.documentElement.getAttribute("lang")).toBe("en");
    const block = doc.querySelector(".feed-shared-update-v2")!;
    expect(block.getAttribute("data-urn")).toMatch(/^urn:li:activity:7\d{18}$/);
    expect(block.getAttribute("data-urn")).not.toContain("713031680");
    expect(block.getAttribute("data-id")).toBe("");
    expect(block.hasAttribute("id")).toBe(false);
    expect(doc.querySelector("time")!.getAttribute("datetime")).toBe("2020-01-01T00:00:00.000Z");
    const like = doc.querySelector("[aria-pressed]")!;
    expect(like.getAttribute("aria-pressed")).toBe("false");
    expect(like.getAttribute("aria-label")).toBe("");
    expect(like.hasAttribute("data-reaction-details")).toBe(true);
    const more = doc.querySelector("button.inline-show-more-text__button")!;
    expect(more.textContent).toBe("…see more");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(doc.querySelector("h2")!.textContent).toBe("About");
    expect(doc.querySelector("a")!.getAttribute("href")).toBe("");
    expect(doc.querySelector("svg")!.childNodes).toHaveLength(0);
    expect(doc.querySelector("img")!.attributes).toHaveLength(1);
    expect(doc.querySelector("input")!.hasAttribute("value")).toBe(false);
    expect(doc.querySelector("[hidden]")).not.toBeNull();
    expect(doc.querySelectorAll("script, style, code, template, noscript, link").length).toBe(0);
    expect(doc.querySelector("h1")!.textContent).toBe("xxxxxxxx xxxxxxx");
  });

  it("placeholders keep the script and the length, never the content", () => {
    expect(placeholderText("Hi Bob 42!")).toBe("xx xxx 00·");
    expect(placeholderText("Привет")).toBe("жжжжжж");
    expect(placeholderText("مرحبا")).toBe("ببببب");
    expect(placeholderText("漢字かな")).toBe("字字字字");
    expect(placeholderText("Tiếng Việt")).toBe("xxxxx xxxx");
  });
  it("keeps the SDUI hooks the reader needs, and nothing of the person: no slug, no URN, no text", () => {
    const sdui = `<!doctype html><html lang="en"><body><div data-sdui-screen="com.linkedin.sdui.flagshipnav.profile.ProfileExperienceDetails">
<main id="workspace" class="q1zx w8pv"><section componentkey="opaqueleak"><div id="com.linkedin.sdui.profile.card.refleak99Topcard"><h2>Realname Surname</h2></div></section>
<div data-testid="profile_ExperienceDetailsSection_hrefleak" data-component-type="LazyColumn"><div componentkey="opaqueleak2"><p>secretword at Realcompany</p>
<span data-testid="expandable-text-box" tabindex="-1">privatevalue<button type="button" aria-hidden="true" data-testid="expandable-text-button">… more</button></span>
<a href="https://www.linkedin.com/feed/update/urn:li:activity:7130316800000000000/">x</a><a href="/analytics/post-summary/urn:li:share:7122689536000000000/">y</a><a href="/in/hrefleak/">z</a>
<div data-testid="a1b2c3dataleak"></div><div data-sdui-screen="javascript:dataleak"></div></div></div></main></div></body></html>`;
    const out = sanitizeHtml(sdui);
    for (const secret of ["Realname", "Surname", "Realcompany", "secretword", "privatevalue", "hrefleak", "opaqueleak", "refleak99", "dataleak", "7130316800000000000", "7122689536000000000"]) {
      expect(out.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    }
    const doc = new JSDOM(out, { url: "https://www.linkedin.com/in/x/details/experience/" }).window.document;
    expect(detectPageState(doc, "experience")).toBe("ok");
    expect(doc.querySelector("[data-testid='profile_ExperienceDetailsSection_x']")).not.toBeNull();
    expect(doc.querySelector("[data-testid='expandable-text-box'] > button[data-testid='expandable-text-button'][aria-hidden='true']")!.textContent).toBe("… more");
    expect(doc.querySelector("[id='com.linkedin.sdui.profile.card.xTopcard']")).not.toBeNull();
    expect(Array.from(doc.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual([
      "/feed/update/urn:li:activity:7000000000000000001/", "/analytics/post-summary/urn:li:share:7000000000000000002/", "",
    ]);
    expect(doc.querySelectorAll("[componentkey]")).toHaveLength(2);
    expect(doc.querySelector("[componentkey]")!.getAttribute("componentkey")).toBe("");
  });
});
