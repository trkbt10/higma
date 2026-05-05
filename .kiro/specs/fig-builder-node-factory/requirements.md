### Requirement 1: createTransform

`createTransform` shall create a 2x3 affine transform matrix from explicit
position and rotation input.

#### 1.1: Transform input

WHEN node geometry is created, THEN `createTransform` SHALL convert explicit
position and rotation input into the fig node transform.

### Requirement 2: DEFAULT_SHAPE_FILL

`DEFAULT_SHAPE_FILL` shall provide the explicit node factory fill constant for
shape nodes.

#### 2.1: Shape fill constant

WHEN shape nodes are created without caller-provided fills, THEN
`DEFAULT_SHAPE_FILL` SHALL provide the node factory fill constant.

### Requirement 3: DEFAULT_TEXT_FILL

`DEFAULT_TEXT_FILL` shall provide the explicit node factory fill constant for
text nodes.

#### 3.1: Text fill constant

WHEN text nodes are created without caller-provided fills, THEN
`DEFAULT_TEXT_FILL` SHALL provide the node factory fill constant.

### Requirement 4: DEFAULT_FRAME_FILL

`DEFAULT_FRAME_FILL` shall provide the explicit node factory fill constant for
frame nodes.

#### 4.1: Frame fill constant

WHEN frame nodes are created without caller-provided fills, THEN
`DEFAULT_FRAME_FILL` SHALL provide the node factory fill constant.

### Requirement 5: CreateNodeFromSpecOptions

`CreateNodeFromSpecOptions` shall contain explicit builder state and node spec
input for node creation.

#### 5.1: Node creation options

WHEN a caller invokes node creation, THEN `CreateNodeFromSpecOptions` SHALL
provide explicit builder state and node spec input.

### Requirement 6: createNodeFromSpec

`createNodeFromSpec` shall create a fig design node from explicit node factory
options.

#### 6.1: Node identifier allocation

WHEN `createNodeFromSpec` creates a node, THEN it SHALL allocate the node
identifier from the explicit builder state in `CreateNodeFromSpecOptions`.

### Requirement 7: assertCreateNodeOptions

`assertCreateNodeOptions` shall reject missing required node creation input.

#### 7.1: Node creation validation

WHEN node creation options are missing builder state or node spec input, THEN
`assertCreateNodeOptions` SHALL throw a specific error.

### Requirement 8: applyTypeSpecificFields

`applyTypeSpecificFields` shall apply node-kind-specific fields after explicit
identifier allocation.

#### 8.1: Type-specific node fields

WHEN a node kind requires specialized fields, THEN `applyTypeSpecificFields`
SHALL apply those fields after `createNodeFromSpec` allocates the node
identifier.
