// A mock LinkedIn: a small local server that serves the SYNTHETIC fixtures at the real paths
// (/in/<slug>/, /in/<slug>/details/experience/, /in/<slug>/recent-activity/all/, …).
// The slug chooses the behaviour. It records every request it receives, so a test can prove the
// extension only ever navigated (GET) to the pages it is meant to read.
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFile(path.join(here, "..", "fixtures", "synthetic", `${name}.html`), "utf8");

// The SDUI fixtures (LinkedIn's server-driven markup, selectors version 2).
const SECTIONS = {
  "": "sdui-profile",
  "details/experience/": "sdui-details-experience",
  "details/skills/": "sdui-details-skills",
  "recent-activity/all/": "sdui-activity-posts",
  "recent-activity/comments/": "sdui-activity-comments",
  "recent-activity/reactions/": "sdui-activity-reactions",
};

/** The screen LinkedIn names on each page; a fixture served at another path is given that page's screen. */
const SCREENS = {
  "": "com.linkedin.sdui.flagshipnav.profile.Profile",
  "details/experience/": "com.linkedin.sdui.flagshipnav.profile.ProfileExperienceDetails",
  "details/skills/": "com.linkedin.sdui.flagshipnav.profile.ProfileSkillDetails",
  "recent-activity/all/": "com.linkedin.sdui.flagshipnav.profile.ProfileRecentActivityAll",
  "recent-activity/comments/": "com.linkedin.sdui.flagshipnav.profile.ProfileRecentActivityComments",
  "recent-activity/reactions/": "com.linkedin.sdui.flagshipnav.profile.ProfileRecentActivityReactions",
};

/** Behaviour switches, by slug. */
export const SLUGS = {
  "synthetic-person-one": {},
  // LinkedIn shows the signed-out, reduced profile.
  "signed-out-person": { all: "reduced-profile" },
  // A security check appears after two scroll steps on the posts page.
  "checkpoint-person": { body: { "recent-activity/all/": 'data-checkpoint-after="2"' } },
  // LinkedIn answers with another slug.
  "redirect-person": { redirect: "renamed-person" },
  "renamed-person": {},
  // More posts than the cap, loaded as the page scrolls.
  "many-posts-person": { body: { "recent-activity/all/": 'data-lazy-total="14" data-lazy-step="3"' } },
  // A long list, slow enough for the user to press Stop.
  "slow-person": { body: { "recent-activity/all/": 'data-lazy-total="60" data-lazy-step="1"' } },
  // No activity at all.
  "no-activity-person": { pages: { "recent-activity/all/": "sdui-activity-empty", "recent-activity/comments/": "sdui-activity-empty", "recent-activity/reactions/": "sdui-activity-empty" } },
};

function page(html, slug, bodyAttributes, screen) {
  return (screen ? html.replace(/data-sdui-screen="[^"]*"/, `data-sdui-screen="${screen}"`) : html)
    .split("synthetic-person-one").join(slug)
    // Tall enough to scroll, as a real profile is.
    .replace("</head>", "<style>body{min-height:30000px;font-family:sans-serif}[hidden]{display:none}</style></head>")
    .replace("<body>", `<body${bodyAttributes ? ` ${bodyAttributes}` : ""}>`);
}

export function createMockLinkedin() {
  /** @type {{ method: string, path: string }[]} */
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://linkedin.test");
    requests.push({ method: req.method ?? "GET", path: url.pathname + url.search });
    const send = (status, type, body, headers = {}) => {
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...headers });
      res.end(body);
    };
    try {
      if (req.method !== "GET") return send(405, "text/plain", "The mock accepts GET only.");
      if (url.pathname === "/static/behaviour.js") return send(200, "text/javascript", await readFile(path.join(here, "mock-assets", "behaviour.js")));
      if (url.pathname === "/favicon.ico") return send(204, "image/x-icon", "");
      const match = /^\/in\/([^/]+)\/(.*)$/.exec(url.pathname);
      if (!match) return send(200, "text/html", await fixture("unrelated"));
      const [, slug, rest] = match;
      const config = SLUGS[slug];
      if (!config || !(rest in SECTIONS)) return send(404, "text/html", page(await fixture("not-found"), slug, ""));
      if (config.redirect) return send(302, "text/plain", "", { Location: `/in/${config.redirect}/${rest}` });
      const name = config.all ?? config.pages?.[rest] ?? SECTIONS[rest];
      return send(200, "text/html; charset=utf-8", page(await fixture(name), slug, config.body?.[rest] ?? "", config.pages?.[rest] ? SCREENS[rest] : null));
    } catch (error) {
      return send(500, "text/plain", String(error));
    }
  });
  return {
    requests,
    listen: (port = 0) => new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server))),
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
    port: () => server.address().port,
    /** The six pages of a profile, as paths. */
    pagesOf: (slug) => Object.keys(SECTIONS).map((rest) => `/in/${slug}/${rest}`),
  };
}
