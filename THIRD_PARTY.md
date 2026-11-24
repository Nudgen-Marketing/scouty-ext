# Third-party notices

Scouty LinkedIn Capture ships third-party code only in the popup (`popup.js`, `popup.css`).
The background script, the reader and the in-page overlay contain none.

## React and React DOM (bundled in `popup.js`, with the `scheduler` package React DOM depends on)

MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Tailwind CSS (its base styles and generated utilities are in `popup.css`)

MIT License

Copyright (c) Tailwind Labs, Inc.

The MIT permission notice above applies in the same words.

## Lucide icons (six icons copied as path data in `src/ui/icons.ts`)

ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any purpose with or without
fee is hereby granted, provided that the above copyright notice and this permission notice appear
in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.

## Design tokens

`src/ui/tokens.json` holds colour and radius values copied from the Scouty app. They are Scouty's
own. No font file is included in this repository.

## Scouty brand

`src/ui/brand.ts` (the Scouty mark and outlined wordmark, as SVG path data) and the toolbar icons in
`icons/` are Scouty's own, copied from the Scouty app. The owner decided on 2026-11-24 that they
may be published here.

## Development tools

esbuild, TypeScript, Vitest, jsdom, axe-core, Playwright, ESLint, typescript-eslint, web-ext and
the Tailwind CLI are used to build and test. None of them is shipped.
