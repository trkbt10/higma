# Fig Builder ID State Design

## Scope

This spec maps directly to `packages/@higma-document-io/fig/src/types/node-id.ts`.
Every declaration in that file is part of the explicit fig builder identifier
state contract.

## Design

`IdCounter` and `CreateIdCounterOptions` represent explicit counter state.
`FigBuilderState`, `CreateFigBuilderStateOptions`, and
`CreateFigBuilderStateFromDocumentOptions` describe explicit builder state
input.

`assertNonNegativeInteger` validates session identifiers and
`assertPositiveInteger` validates local identifiers. `createIdCounter`
constructs an `IdCounter`. `createFigBuilderState` constructs
`FigBuilderState` from caller-provided counters.

`createFigBuilderStateFromDocument` derives explicit state from an existing
document by scanning pages and child nodes for matching sessions.

## Drift Gate

`indexion spec align status .kiro/specs/fig-builder-id-state/requirements.md packages/@higma-document-io/fig/src/types/node-id.ts --threshold 0.3 --fail-on any`
