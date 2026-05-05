# Fig Renderer SVG Normalization Design

## Scope

This spec maps directly to
`packages/@higma-document-renderers/fig/src/svg/renderer.ts` declarations that
indexion exposes for the renderer IO decoupling work.

## Design

`getRootFrameOffset` computes the minimum root translation for SVG rendering.
`normalizeDesignNodeTransform` subtracts that root offset from each fig design
node transform. Both functions use fig model/domain data and do not import
document IO.

## Drift Gate

`indexion spec align status .kiro/specs/fig-renderer-svg-normalization/requirements.md packages/@higma-document-renderers/fig/src/svg/renderer.ts --threshold 0.3 --fail-on any`
