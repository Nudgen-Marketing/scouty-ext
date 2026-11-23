# Building Scouty LinkedIn Capture from source

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
4. The source archive holds the files tracked by git. Without git (for example when working from
   the source archive itself) it holds every file except `node_modules/`, `dist/` and `release/`.

The Firefox package is `release/scouty-ext-<version>-firefox.zip`; its contents equal `dist/firefox/`.

## Checking that the build is reproducible

```sh
node tools/repro-check.mjs   # builds twice and compares the hash of every output file
shasum -a 256 release/*.zip  # compare with the hashes published with the release
```

## Environment the steps were verified on

| | |
| --- | --- |
| Date | 2026-11-23 |
| OS | macOS (Darwin 27.2, arm64) |
| Node / npm | v26.12.1 / 11.20.0 (see the note below) |
| Result | `node tools/repro-check.mjs` reported identical files across two builds |

Note: the machine used had Node 26, not the pinned Node 24. Before the first store submission the
build must be repeated on Node 24 on a clean machine and this table updated (release gate 8).

## Other builds (not for stores)

- `npm run build:dev`: the same three targets against a local or test app. The API origin comes
  from `SCOUTY_API_ORIGIN` in the environment or in the untracked `.env.local` (default
  `http://localhost:3000`); the click log is switched on.
- `npm run build:e2e`: `dist/e2e`, used only by the automated browser tests. It is never packaged.
