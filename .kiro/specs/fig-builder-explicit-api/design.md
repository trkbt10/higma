# Fig Builder Explicit API Design

## Scope

This feature makes fig builder construction explicit. It targets public node
and page creation APIs under `@higma-document-io/fig`. Builder code remains in
document IO because it constructs file-oriented fig documents and exportable
payloads.

## State Ownership

Builder callers must provide explicit construction state. The API should use a
small builder state object or identifier allocator that is passed to each
public creation function. Required construction data must be present in
arguments or in that explicit state. Missing data is an error.

Hidden module-level counters, implicit defaults, and compatibility wrappers
are not allowed. Tests should verify that repeated independent builder states
produce deterministic identifiers and that missing required values fail fast.

## Dependency Rule

Builder implementation may depend on lower layers needed for file
construction: primitives, codecs, figma schema, figma containers, figma runtime,
figma analysis, and fig document models. It may not import renderer, editor,
editor surface, or UI packages.

## Implementation Plan

1. Inventory node and page creation functions and identify hidden construction
   state.
2. Introduce an explicit builder state or identifier allocator type in the IO
   builder area.
3. Update public creation functions to require the explicit state.
4. Remove old implicit-state wrapper exports.
5. Update call sites and tests to pass explicit state.
6. Add tests for deterministic allocation and missing-input errors.
7. Run typecheck, package tests, boundary lint, and indexion drift gates.

## Drift Gates

- `indexion spec align diff .kiro/specs/fig-builder-explicit-api/requirements.md packages/@higma-document-io/fig/src/node-ops packages/@higma-document-io/fig/src/page-ops packages/@higma-document-io/fig/src/types --format markdown --threshold 0.3`
- `indexion spec align status .kiro/specs/fig-builder-explicit-api/requirements.md packages/@higma-document-io/fig/src/node-ops packages/@higma-document-io/fig/src/page-ops packages/@higma-document-io/fig/src/types --threshold 0.3 --fail-on any`
- No inline ESLint suppression comment may be introduced.
