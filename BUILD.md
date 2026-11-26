# Building Scouty B2B Prospector from source

These are the exact steps that produce the published packages. The background script, the reader
and the overlay are bundled but not minified; the popup script (which contains React) and the popup
stylesheet (compiled by Tailwind CSS) are bundled and minified. All tools are pinned in
`package-lock.json`. No step downloads code at build time other than `npm ci`.

## Requirements

- Node.js 24 (the version in `.nvmrc`; `nvm use` selects it) with the npm it ships.
- macOS, Linux or Windows. No other tool is needed. Git is optional (see step 4).

## Steps

```sh
nvm use            # Node 24
npm ci             # installs exactly the lockfile
npm run build      # writes dist/chrome, dist/edge, dist/firefox
npm run package    # writes release/scouty-ext-<version>-{chrome,edge,firefox}.zip and -source.zip
```

1. `npm ci` installs the pinned tools: esbuild (bundler), the Tailwind CSS command-line tool
   (stylesheet), TypeScript (type checking only), and the test tools.
2. `npm run build` runs `build.mjs`. For each target it bundles four entry points with esbuild
   (`src/background/index.ts`, `src/reader/index.ts`, `src/overlay/overlay.ts`,
   `src/popup/popup.tsx`), compiles `src/popup/popup.css` with the Tailwind CLI, copies
   `popup.html`, `_locales/`, `icons/` and `THIRD_PARTY.md`, and writes `manifest.json` by merging
   `manifest.base.json` with `manifest.<target>.json`. The store build always uses the API origin
   `https://scouty.to`; it reads no environment variable and no `.env` file.
3. `npm run package` rebuilds, then zips each `dist/<target>/` with a deterministic archive writer
   (`tools/zip.mjs`: sorted entries, a fixed timestamp), so the same source gives the same bytes.
   In a git checkout it refuses to run while `git status --porcelain` lists anything, so the zips and
   the source archive come from the same files; `npm run package -- --allow-dirty` overrides that for
   a local try only.
4. The source archive holds the files tracked by git. Without git (for example when working from
   the source archive itself) it holds every file except `node_modules/`, `dist/` and `release/`.

The Firefox package is `release/scouty-ext-<version>-firefox.zip`; its contents equal `dist/firefox/`.
Its add-on id (`browser_specific_settings.gecko.id` in `manifest.firefox.json`) is
`prospector@scouty.to`. The id is permanent once the add-on is published, and Firefox derives the
OAuth redirect URL from it, so the app's `scouty-ext-firefox` client entry must list the redirect of
this id (validation/FIREFOX-SMOKE.md, step 7). It was `linkedin-capture@scouty.to` before
2026-11-26 (docs/DEVIATIONS.md, 24); hashes recorded before that date are of the old manifest.

## Checking that the build is reproducible

```sh
node tools/repro-check.mjs   # builds twice and compares the hash of every output file
shasum -a 256 release/*.zip  # compare with the hashes published with the release
```

## Environment the steps were verified on

| | |
| --- | --- |
| Date | 2026-11-26 |
| OS | macOS (Darwin 27.2, arm64) |
| Node / npm | v24.0.2 / 11.3.0 (the pinned major) |
| Result | Two fresh folders: A from a git clone, B from A's `scouty-ext-0.1.0-source.zip` only (no git). `npm ci && npm run package` in each gave byte-identical `chrome`, `edge`, `firefox` and `source` zips, and `node tools/repro-check.mjs` passed in B |

Note: the first try of this check found that the overlay bundle embedded the absolute path of the
build folder (the `inline-css` esbuild plugin passed it as the module path), so a build in any other
folder differed. `build.mjs` now uses a project-relative path, and `test:static` fails if any built
file contains the folder it was built in. It was a clean folder on the same machine, not a separate
machine; repeating it on another machine before submission is still advised.

## Other builds (not for stores)

- `npm run build:dev`: the same three targets against a local or test app. The API origin comes
  from `SCOUTY_API_ORIGIN` in the environment or in the untracked `.env.local` (default
  `http://localhost:3000`); the click log is switched on. It is never shown on a capture screen:
  each finished capture prints one line (`Scouty dev: 54 clicks, all expand controls`, plus any
  click that is not an allowed control) to the background console, and the popup's Settings →
  **Developer** disclosure (collapsed; development builds only) lists the last 10 captures and the
  OAuth redirect URL, with **Copy**. Store builds contain none of this (checked by `test:static`).
- `npm run build:e2e`: `dist/e2e`, used only by the automated browser tests. It is never packaged.
