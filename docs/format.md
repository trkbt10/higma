## .fig File Format

A `.fig` file is a **ZIP archive** containing:

| File | Required | Description |
|------|----------|-------------|
| `canvas.fig` | Yes | Main data (fig-kiwi format) |
| `meta.json` | Yes | Metadata (filename, background color, etc.) |
| `thumbnail.png` | Yes | Thumbnail image |
| `images/*` | No | Embedded images |

`canvas.fig` contains Deflate/Zstd compressed data encoded in Kiwi schema format. See [@higma-document-models/fig README](packages/@higma-document-models/fig/README.md) for details.

Figma-adjacent packages such as `.deck`, `.buzz`, and `.site` reuse the same ZIP shape and raw canvas chunk layout while changing the `canvas.fig` magic and domain schema usage. See [Fig-Adjacent Formats](fig-adjacent-formats.md) for the observed differences and package boundary notes.

### Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (ES Modules)
- **UI**: React 19
- **Test**: Vitest
- **Lint**: ESLint
