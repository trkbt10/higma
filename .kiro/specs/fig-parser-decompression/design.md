# Fig Parser Decompression Design

## Scope

This spec maps directly to
`packages/@higma-document-io/fig/src/parser/decompress.ts`.

## Design

`decompressDeflate` handles zlib-wrapped deflate data. `decompressDeflateRaw`
handles raw fig-kiwi deflate data. `decompressZstd` handles Zstandard data.
All three functions belong to fig parser IO and fail with specific errors.

## Drift Gate

`indexion spec align status .kiro/specs/fig-parser-decompression/requirements.md packages/@higma-document-io/fig/src/parser/decompress.ts --threshold 0.3 --fail-on any`
