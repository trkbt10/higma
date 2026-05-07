# higma-vsc-plugin

VS Code extension that opens Figma `.fig` files in a custom editor backed by the
Higma renderer. The extension contributes one custom editor (`higma.figViewer`)
that claims `*.fig`, decodes the file in a webview, and renders pages via
`@higma-figma-runtime/react-renderer`.

```
src/
├── extension/                 # Node side — runs in the VS Code extension host
│   ├── index.ts               # activate(): registers the customEditor
│   ├── fig-viewer-provider.ts # CustomReadonlyEditorProvider + webview HTML/CSP
│   └── output-channel.ts      # "Higma Fig Viewer" Output panel channel
├── webview/                   # Browser side — runs inside the webview iframe
│   ├── index.tsx              # Entry: posts webview/ready, mounts FigViewer
│   ├── FigViewer.tsx          # Toolbar, page select, zoom, stage
│   └── vscode-api.ts          # acquireVsCodeApi() wrapper
└── shared/protocol.ts         # ExtensionToWebview / WebviewToExtension messages
```

## Develop

Two entry points, picked by what you are iterating on:

| You are iterating on…                       | Use            | Why                                                                                                  |
| ------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| The webview UI (toolbar, stage, renderer)   | `bun run dev:ui` | Loads the same `webview/index.tsx` in a normal browser via Vite. No VS Code launch, full HMR.         |
| The extension host (custom editor wiring)   | `bun run dev`    | Builds the bundle and launches an isolated VS Code profile so the customEditor association can run. |

`dev:ui` covers the bulk of UI work — fixture switching, theme verification,
arbitrary `.fig` files, error UI. Reach for `dev` only when you need to
exercise the extension-host side (file resolution, CSP, Output channel,
custom-editor registration).

### Browser playground (`bun run dev:ui`)

Serves `dev/index.html` via Vite at <http://localhost:5194> and mounts the
real `src/webview/index.tsx` with `acquireVsCodeApi` stubbed. The page seeds
`--vscode-*` CSS variables that match VS Code's Dark+ / Light+ themes so the
viewer paints the same as it does inside the editor.

```bash
cd packages/higma-vsc-plugin
bun run dev:ui                          # opens the browser
bun run dev:ui -- --port 5300            # override the port if 5194 is taken
```

The dev toolbar at the top of the page lets you:

- toggle **Dark / Light** to verify theme adaptation
- swap between fixtures (`small`, `large`, `garbage`) to exercise the happy
  path, the heavy real-world Figma export, and the error UI
- **Open .fig…** or drag-and-drop any local `.fig` to load it through the
  same `fig/loaded` channel the extension uses

Vite HMR reloads the page on edits to `src/webview/**` or any workspace
`@higma-*` source dependency — no manual rebuild step.

What `dev:ui` does **not** cover (use `bun run dev` for these):

- the production CSP (including `'unsafe-eval'` for `opentype.js`) — the
  browser has no CSP. The `bundle-smoke.e2e.ts` spec asserts the shipped CSP.
- the bundled `dist/webview.js` — `dev:ui` runs source files directly, so
  bun-bundler-specific failures (CJS hoisting, `--minify` rename bugs) only
  surface in `bun run e2e` and inside a real VS Code launch.
- the customEditor registration / `editorAssociations` plumbing.

### VS Code launch (`bun run dev`)

Builds the bundle, spins up an **isolated VS Code profile** under
`/tmp/higma-vsc-plugin-{user,exts}`, starts incremental watchers for both the
extension and the webview, and opens a sample `.fig` so the viewer renders
straight away. The user’s real VS Code installation is not touched: the
temporary profile has no installed extensions and no sign-in prompts.

```bash
cd packages/higma-vsc-plugin

bun run dev                            # opens spec/e2e/fixtures/sample.fig
bun run dev /path/to/your.fig          # opens any .fig
bun run dev --no-watch                 # one-shot launch, no watchers
```

While `dev` is running, edit any source file and the watchers regenerate
`dist/`. Pick up the change inside the launched VS Code with:

| You edited                                     | How to reload                                      |
| ---------------------------------------------- | -------------------------------------------------- |
| `src/webview/**` or any renderer dependency    | ⌘⇧P → **Developer: Reload Webviews**              |
| `src/extension/**`                             | ⌘R (Reload Window). The dev profile is preserved. |

Quitting the launched VS Code (⌘Q) terminates the watchers via the script's
`trap`. There is no extra cleanup step.

## Verify the viewer is alive

The extension publishes a dedicated **"Higma Fig Viewer"** channel in the VS
Code Output panel. A successful boot looks like:

```
[activate] higma-vsc-plugin loaded from <package path> — registering customEditor higma.figViewer
[resolveCustomEditor] opening file:///… in webview higma.figViewer
[resolveCustomEditor] webview html assigned, waiting for webview/ready…
[info] [bootstrap] inline script ran
[webview→ext] webview/ready received → posting fig/loaded
[ext→webview] sending fig/loaded fileName=<name>.fig bytes=<size>
```

Each line is a checkpoint that maps to a concrete failure mode:

| Last line you see                          | What that means                                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `[activate] … — registering customEditor`  | VS Code never tried to open the `.fig` (custom editor association lost; check `editorAssociations`).      |
| `webview html assigned, waiting…`          | The webview HTML reached the iframe but the bundle did not execute. Likely a CSP violation or bundler bug. |
| `[bootstrap] inline script ran` only       | The `<script type="module">` failed to load or threw during parse / module init.                           |
| `[bootstrap] module script never executed` | Same as above, surfaced by the 3-second timer in the bootstrap script.                                     |
| `[error] …` after that                     | A runtime exception was forwarded from the webview (`window.error`, `unhandledrejection`, or React).       |

A status-bar pill (`Higma Fig Viewer activated`) confirms `activate()` ran even
without opening the Output panel.

## Verify by tests

```bash
bun run typecheck
bun run lint
bun run test          # unit
bun run e2e           # Playwright
```

`bun run e2e` runs four specs:

| Spec                                               | What it guards                                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `viewer.e2e.ts › small fixture`                    | The webview boots and renders a synthetic fixture without diagnostics.                                     |
| `viewer.e2e.ts › large real-world fixture`         | A real Figma export (`@higma-document-io/fig/samples/sample-file.fig`) renders, no fatal `webview/log`s.   |
| `viewer.e2e.ts › garbage bytes`                    | Bad `fig/loaded` payloads surface the error UI **and** forward `webview/log error` to the host.            |
| `bundle-smoke.e2e.ts › bundled dist/webview.js …`  | The actual bun-built bundle executes under a VS Code-style CSP and posts `webview/ready` synchronously.    |

The first three exercise source files via Vite aliasing. The last loads
`dist/webview.js` directly and applies the production CSP, so it catches
failures specific to bun's bundler output that the source-aliased harness
cannot — the kind that previously only showed up in a manual VS Code launch:

* `ReferenceError: module_<name> is not defined` (CJS-shaped dependency hoisting)
* `ReferenceError: <minified-name> is not defined` (bun `--minify` rename bug)
* a new dependency that requires `'unsafe-eval'` in CSP

## Constraints worth knowing

* **`'unsafe-eval'` is required in the webview CSP.** `opentype.js` (pulled in
  via `@higma-document-renderers/fig`) compiles glyph parsers with
  `new Function(...)`. Removing it from `script-src` immediately breaks text
  rendering. The `bundle-smoke` spec asserts the CSP we ship is
  self-consistent.
* **Bundles are not minified.** `bun build --minify` produces a broken
  `dist/webview.js` (`ReferenceError: Im is not defined`) on this dependency
  graph. There is no `package:*` script — the unminified `build` is the only
  shippable output. Bundle size is ~6.8 MB; the webview loads it from the
  extension's own `dist/` so latency is negligible.
* **Dynamic import for `zstd-codec`.** Static `import { ZstdCodec } from "zstd-codec"`
  triggers a bun bundler miscompile (`module_zstd_codec is not defined`). The
  workspace package `@higma-codecs/compression` loads it via
  `await import("zstd-codec")` inside `createZstdCompressor`. Do not collapse
  it back to a static import.
* **Webview posts `webview/ready` synchronously at module evaluation time,**
  not in a `useEffect`. If React mount fails for any reason the extension
  still receives `ready` and the failure is visible in the Output channel.
  Keep this invariant — moving the post inside React lifecycle re-introduces
  the silent-blank-screen failure mode.
* **F5 / Run-and-Debug is intentionally unsupported.** `bun run dev` is the
  only working entry. It bypasses VS Code's debug launch (which loads the
  user's installed extensions and races with custom editor priority) and
  guarantees a clean, reproducible host. There is no `.vscode/launch.json` for
  this reason.
