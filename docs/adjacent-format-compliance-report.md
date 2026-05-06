# Adjacent Format Compliance Report

## Scope

This report records the implementation compliance status for the fig-adjacent
format separation work covering fig, deck, buzz, and site package boundaries.
It deliberately avoids local sample file paths, local sample names, and sample
payload contents. It reports only generic format and package responsibilities.

## Responsibility Separation

The workspace separates responsibilities by package scope instead of placing
format, renderer, editor, UI, and primitive code under one flat package family.

- `@higma-primitives/*` owns primitive operations such as buffers, trees, and
  zip.
- `@higma-codecs/*` owns file codecs such as compression, kiwi, and png.
- `@higma-figma-schema/*` owns schema and profile definitions.
- `@higma-figma-containers/*` owns container-level canvas and package parsing.
- `@higma-figma-runtime/*` owns reusable runtime extraction from figma canvas
  data.
- `@higma-figma-analysis/*` owns product-free analysis such as document facts,
  format insights, schema diff, and render outline.
- `@higma-document-models/*` owns product-specific document models for fig,
  deck, buzz, and site.
- `@higma-document-io/*` owns product-specific document loading.
- `@higma-document-renderers/*` owns product-specific render planning and
  rendering.
- `@higma-document-editors/*` owns product-specific editor assembly.
- `@higma-editor-kernel/*` and `@higma-editor-surfaces/*` own product-free
  editor logic and UI surfaces.

## Implemented Guarantees

### Renderer Units

The deck, buzz, and site renderer packages expose product-specific render units
instead of metadata-only render plans.

| Format | Renderer package | Product render unit scope |
| --- | --- | --- |
| deck | `@higma-document-renderers/deck` | presentation units |
| buzz | `@higma-document-renderers/buzz` | template units |
| site | `@higma-document-renderers/site` | layout units |

The renderers produce explicit render unit arrays from the product-free render
outline analysis. Empty domain render units fail fast by throwing.

### Editor Units

The deck, buzz, and site editor packages expose product-specific editable units
instead of only wrapping load sessions.

| Format | Editor package | Editable unit operation target |
| --- | --- | --- |
| deck | `@higma-document-editors/deck` | presentation structure |
| buzz | `@higma-document-editors/buzz` | template structure |
| site | `@higma-document-editors/site` | site layout structure |

The editor converters preserve render unit identity, role, label, hierarchy,
product scope, and operation target.

### Boundary Enforcement

Package boundary enforcement is defined through package metadata and ESLint
rules. The configured rules reject sibling imports, upward layer imports,
cross-product imports, cross-package re-export bypasses, and subpath bypasses.

No line-level ESLint disable directive is present in the checked package,
configuration, or SDD scope.

## SDD Coverage

The following SDD specs have all task items marked complete after verification:

- `adjacent-renderer-plans`
- `adjacent-editor-workspaces`
- `adjacent-completion-gates`
- `fig-builder-id-state`
- `fig-builder-node-factory`
- `fig-builder-page-ops`
- `fig-domain-conversion`
- `fig-family-render-outline`
- `fig-parser-decompression`
- `fig-parser-fig-image`
- `fig-parser-normalize`
- `fig-renderer-svg-normalization`
- `fig-validator-binary-comparator`
- `fig-validator-message-analyzer`
- `fig-validator-structure`

## Verification Summary

The implementation was verified with:

- SDD requirements-to-design alignment for adjacent renderer, adjacent editor,
  and completion gate specs.
- SDD requirements-to-implementation alignment for deck, buzz, and site
  renderers.
- SDD requirements-to-implementation alignment for deck, buzz, and site editors.
- SDD requirements-to-implementation alignment for fig parser, builder,
  validator, domain conversion, render outline, and SVG normalization specs.
- Root lint.
- Root typecheck.
- Root tests.
- Diff whitespace check.
- Repository scan for prohibited local references and disabled ESLint comments.

## Compliance Result

The implemented package separation, SDD task coverage, deck/buzz/site render
unit expansion, deck/buzz/site editable unit expansion, and boundary enforcement
requirements are satisfied by the current repository state.

This report does not claim visual pixel-diff parity for arbitrary local sample
documents. That is a separate rendering-quality gate and must be represented by
its own SDD spec and reproducible fixtures before it can be reported as
complete.
