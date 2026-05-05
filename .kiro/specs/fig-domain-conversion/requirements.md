### Requirement 1: resolveSymbolIdForDomain

`resolveSymbolIdForDomain` shall resolve the effective symbol identifier for
domain conversion without relying on document IO.

#### 1.1: Symbol identifier resolution

WHEN fig node conversion handles an instance node, THEN
`resolveSymbolIdForDomain` SHALL convert the effective symbol identifier into
a domain node identifier.

### Requirement 2: CLIPPING_NODE_TYPES

`CLIPPING_NODE_TYPES` shall list fig node types that clip content by default
for domain conversion.

#### 2.1: Clipping node types

WHEN domain conversion resolves clipping behavior, THEN `CLIPPING_NODE_TYPES`
SHALL provide the node type set that clips content by default.

### Requirement 3: resolveClipsContentForDomain

`resolveClipsContentForDomain` shall normalize Kiwi clipping fields into the
domain `clipsContent` value.

#### 3.1: Clipping normalization

WHEN domain conversion reads raw Kiwi node data, THEN
`resolveClipsContentForDomain` SHALL produce the authoritative domain
`clipsContent` value.

### Requirement 4: IDENTITY_MATRIX

`IDENTITY_MATRIX` shall provide the explicit identity transform for domain
conversion.

#### 4.1: Identity transform

WHEN domain conversion needs an identity transform, THEN `IDENTITY_MATRIX`
SHALL provide it explicitly.

### Requirement 5: DEFAULT_SIZE

`DEFAULT_SIZE` shall provide the explicit size used by domain conversion when
the raw node carries the schema-defined zero size.

#### 5.1: Default size

WHEN domain conversion needs the schema-defined default size, THEN
`DEFAULT_SIZE` SHALL provide it explicitly.

### Requirement 6: isFigVector

`isFigVector` shall identify fig vector-like node payloads during domain
conversion.

#### 6.1: Vector predicate

WHEN domain conversion handles raw node payloads, THEN `isFigVector` SHALL
return whether the payload is a fig vector-like payload.
