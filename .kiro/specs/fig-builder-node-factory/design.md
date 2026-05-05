# Fig Builder Node Factory Design

## Scope

This spec maps directly to
`packages/@higma-document-io/fig/src/node-ops/node-factory.ts`.
Every declaration in that file is part of the node factory contract.

## Design

`createTransform` creates affine transforms. `DEFAULT_SHAPE_FILL`,
`DEFAULT_TEXT_FILL`, and `DEFAULT_FRAME_FILL` retain explicit node factory fill
constants. `CreateNodeFromSpecOptions` provides the explicit state and node
spec. `createNodeFromSpec` uses the supplied state, `assertCreateNodeOptions`
rejects missing required input, and `applyTypeSpecificFields` applies node
kind-specific data after identifier allocation.

## Drift Gate

`indexion spec align status .kiro/specs/fig-builder-node-factory/requirements.md packages/@higma-document-io/fig/src/node-ops/node-factory.ts --threshold 0.3 --fail-on any`
