# Fig Builder Page Ops Design

## Scope

This spec maps directly to
`packages/@higma-document-io/fig/src/page-ops/page-manager.ts`. Every
declaration in that file is part of the page operation contract.

## Design

`AddPageOptions` and `addPage` create pages with explicit builder state.
`removePage`, `reorderPage`, and `renamePage` remain explicit document
operations; `reorderPage` moves a page within the document without allocating
identifiers. `DuplicatePageOptions`, `duplicatePage`, and `deepCloneNodes`
duplicate pages and children with explicit builder state. `assertBuilderState`
and `assertNonEmptyString` fail fast on missing required input.

## Drift Gate

`indexion spec align status .kiro/specs/fig-builder-page-ops/requirements.md packages/@higma-document-io/fig/src/page-ops/page-manager.ts --threshold 0.3 --fail-on any`
