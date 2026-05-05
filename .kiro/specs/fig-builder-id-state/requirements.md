### Requirement 1: IdCounter

`IdCounter` shall represent explicit fig builder identifier counter state with
a session identifier and next local identifier.

#### 1.1: IdCounter fields

WHEN builder identifier allocation needs state, THEN `IdCounter` SHALL carry
the session identifier and next local identifier explicitly.

### Requirement 2: CreateIdCounterOptions

`CreateIdCounterOptions` shall provide explicit counter construction input.

#### 2.1: CreateIdCounterOptions fields

WHEN a caller constructs an `IdCounter`, THEN `CreateIdCounterOptions` SHALL
provide the session identifier and next local identifier without hidden
defaults.

### Requirement 3: FigBuilderState

`FigBuilderState` shall combine explicit node and page identifier counters.

#### 3.1: FigBuilderState fields

WHEN builder APIs allocate identifiers, THEN `FigBuilderState` SHALL contain
node and page `IdCounter` values.

### Requirement 4: CreateFigBuilderStateOptions

`CreateFigBuilderStateOptions` shall provide explicit node and page counter
construction options.

#### 4.1: CreateFigBuilderStateOptions fields

WHEN a caller creates fig builder state, THEN
`CreateFigBuilderStateOptions` SHALL provide explicit options for the node
counter and page counter.

### Requirement 5: CreateFigBuilderStateFromDocumentOptions

`CreateFigBuilderStateFromDocumentOptions` shall provide all inputs required
to derive explicit builder state from an existing document.

#### 5.1: Document-derived fields

WHEN deriving builder state from a document, THEN
`CreateFigBuilderStateFromDocumentOptions` SHALL provide the document, node
session, page session, minimum node local identifier, and minimum page local
identifier.

### Requirement 6: assertNonNegativeInteger

`assertNonNegativeInteger` shall reject invalid session identifier input.

#### 6.1: Non-negative integer validation

WHEN session identifier input is not a non-negative integer, THEN
`assertNonNegativeInteger` SHALL throw a specific error.

### Requirement 7: assertPositiveInteger

`assertPositiveInteger` shall reject invalid local identifier input.

#### 7.1: Positive integer validation

WHEN local identifier input is not a positive integer, THEN
`assertPositiveInteger` SHALL throw a specific error.

### Requirement 8: createIdCounter

`createIdCounter` shall construct an explicit `IdCounter` from
`CreateIdCounterOptions`.

#### 8.1: Counter construction

WHEN `createIdCounter` receives `CreateIdCounterOptions`, THEN it SHALL return
an `IdCounter` and SHALL NOT use hidden defaults.

### Requirement 9: createFigBuilderState

`createFigBuilderState` shall construct explicit fig builder state from
caller-provided node and page counters.

#### 9.1: Builder state construction

WHEN `createFigBuilderState` receives `CreateFigBuilderStateOptions`, THEN it
SHALL return `FigBuilderState` with explicit node and page counters.

### Requirement 10: createFigBuilderStateFromDocument

`createFigBuilderStateFromDocument` shall derive explicit fig builder state by
scanning an existing document.

#### 10.1: Document scan construction

WHEN `createFigBuilderStateFromDocument` receives explicit document-derived
options, THEN it SHALL scan document pages and nodes and return
`FigBuilderState`.
