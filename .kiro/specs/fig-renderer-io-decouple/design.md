# Fig Renderer IO Decouple Design

## Scope

This feature removes document IO dependencies from the fig renderer. Rendering
may consume fig domain data, fig runtime summaries, or renderer-owned adapters.
It must not rely on document IO conversion helpers or re-export paths.

## Conversion Ownership Rule

The existing conversion path must be classified before code is moved:

- Domain-neutral conversion belongs in a lower fig model or runtime package.
  Both IO and renderer may import that lower package.
- Renderer-specific conversion belongs in
  `@higma-document-renderers/fig`.
- Document IO may keep file loading, validation, and save/export orchestration,
  but it cannot be the renderer's source of truth for renderable node
  conversion.

No second implementation of the same conversion semantics may be introduced.
If IO and rendering both need the same conversion, extract the existing logic
once and update both callers.

## Implementation Plan

1. Locate every renderer import from `@higma-document-io/fig`.
2. Trace the imported conversion function and classify it as domain-neutral or
   renderer-specific.
3. Move the conversion source of truth to the correct lower or renderer-local
   package.
4. Update renderer imports so runtime rendering has no document IO dependency.
5. Update IO imports if the shared conversion moved to a lower package.
6. Run renderer tests, typecheck, package boundary lint, and indexion drift
   gates.

## Drift Gates

- `indexion spec align diff .kiro/specs/fig-renderer-io-decouple/requirements.md packages/@higma-document-renderers/fig --format markdown --threshold 0.3`
- `indexion spec align status .kiro/specs/fig-renderer-io-decouple/requirements.md packages/@higma-document-renderers/fig --threshold 0.3 --fail-on any`
- `rg '@higma-document-io/fig' packages/@higma-document-renderers/fig/src` must
  return no renderer runtime imports.
- No inline ESLint suppression comment may be introduced.
