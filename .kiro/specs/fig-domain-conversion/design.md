# Fig Domain Conversion Design

## Scope

This spec maps directly to
`packages/@higma-document-models/fig/src/domain/conversion/fig-node-conversion.ts`.
The conversion source of truth lives in the fig document model domain so both
document IO and rendering can depend on it without horizontal dependency.

## Design

`resolveSymbolIdForDomain` resolves instance symbol identifiers.
`CLIPPING_NODE_TYPES` and `resolveClipsContentForDomain` define clipping
conversion. `IDENTITY_MATRIX` and `DEFAULT_SIZE` are explicit conversion
constants. `isFigVector` identifies vector-like raw payloads.

## Drift Gate

`indexion spec align status .kiro/specs/fig-domain-conversion/requirements.md packages/@higma-document-models/fig/src/domain/conversion/fig-node-conversion.ts --threshold 0.3 --fail-on any`
