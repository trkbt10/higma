### Requirement 1: getRootFrameOffset

`getRootFrameOffset` shall compute the minimum root node translation used by
fig SVG rendering without importing document IO.

#### 1.1: Root frame offset

WHEN SVG rendering normalizes root nodes, THEN `getRootFrameOffset` SHALL read
root node transforms and return the minimum x and y translation.

### Requirement 2: normalizeDesignNodeTransform

`normalizeDesignNodeTransform` shall remove the root offset from a fig design
node transform for SVG rendering.

#### 2.1: Transform normalization

WHEN SVG rendering emits normalized nodes, THEN
`normalizeDesignNodeTransform` SHALL subtract the root offset from the design
node transform and SHALL NOT depend on document IO.
