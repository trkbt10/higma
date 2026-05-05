# Fig Parser FigImage Design

## Scope

This spec maps directly to
`packages/@higma-document-io/fig/src/parser/fig-file.ts` declarations exposed
by indexion.

## Design

`FigImage` represents image data extracted by fig parser IO.
`assertFigImage` validates image data extracted by fig parser IO and throws a
specific error for a missing image reference, missing image bytes, or missing
MIME type.

## Drift Gate

`indexion spec align status .kiro/specs/fig-parser-fig-image/requirements.md packages/@higma-document-io/fig/src/parser/fig-file.ts --threshold 0.3 --fail-on any`
