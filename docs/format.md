## .fig File Format

A `.fig` file is a **ZIP archive** containing:

| File | Required | Description |
|------|----------|-------------|
| `canvas.fig` | Yes | Main data (fig-kiwi format) |
| `meta.json` | Yes | Metadata (filename, background color, etc.) |
| `thumbnail.png` | Yes | Thumbnail image |
| `images/*` | No | Embedded images |

`canvas.fig` contains Deflate/Zstd compressed data encoded in Kiwi schema format. See [@higma/fig README](packages/@higma/fig/README.md) for details.

### Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (ES Modules)
- **UI**: React 19
- **Test**: Vitest
- **Lint**: ESLint
