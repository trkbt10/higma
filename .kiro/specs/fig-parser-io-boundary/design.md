# Fig Parser IO Boundary Design

## Scope

This feature separates fig parsing and fig validation from the fig document
model. The model remains a domain package. Document IO owns file-oriented
parsing, schema validation, decoding orchestration, and the public entry
points used by readers, exporters, renderers, and editors.

## Package Boundary

- `@higma-document-models/fig` owns domain types, document metadata, raw value
  shapes, and pure helper functions that do not perform file parsing,
  validation, or decoding orchestration.
- `@higma-document-io/fig` owns parser and validator entry points, including
  error mapping and validation fail-fast behavior.
- No moved parser or validator path may remain in the model package as a
  compatibility re-export.
- Higher packages may depend on IO for loading or validation. The model package
  must not depend on IO, rendering, editor, surface, or builder packages.

## Implementation Plan

1. Identify the current parser and validator exports in
   `@higma-document-models/fig`.
2. Move parser and validator implementation files to
   `@higma-document-io/fig`, preserving tests as executable behavior rather
   than snapshot-only coverage.
3. Leave only genuinely pure domain helpers in the model package. If a helper
   is shared by parser and renderer, keep it domain-only and verify it has no
   IO dependency.
4. Update consumers to import parser and validator APIs from
   `@higma-document-io/fig`.
5. Remove old package exports and any re-export wrappers from the model
   package.
6. Run typecheck, package tests, ESLint boundary checks, and indexion spec
   alignment.

## Drift Gates

- `indexion spec align diff .kiro/specs/fig-parser-io-boundary/requirements.md packages --format markdown --threshold 0.3`
- `indexion spec align status .kiro/specs/fig-parser-io-boundary/requirements.md packages --threshold 0.3 --fail-on any`
- Boundary ESLint output must contain zero package-boundary violations.
- No inline ESLint suppression comment may be introduced.
