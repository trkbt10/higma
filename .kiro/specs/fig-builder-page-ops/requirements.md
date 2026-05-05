### Requirement 1: AddPageOptions

`AddPageOptions` shall provide explicit builder state, document, and page name
input for page creation.

#### 1.1: AddPageOptions fields

WHEN a caller adds a page, THEN `AddPageOptions` SHALL carry explicit
builder state, document, and page name input.

### Requirement 2: addPage

`addPage` shall create a page with explicit builder state.

#### 2.1: Add page allocation

WHEN `addPage` creates a page, THEN it SHALL allocate the page identifier from
explicit builder state and require a page name.

### Requirement 3: removePage

`removePage` shall remove a page from explicit document and page identifier
input.

#### 3.1: Remove page operation

WHEN `removePage` removes a page, THEN it SHALL operate on the explicit
document and page identifier input.

### Requirement 4: reorderPage

`reorderPage` shall move a page within the explicit document input without
allocating identifiers.

#### 4.1: Reorder page operation

WHEN `reorderPage` changes page order, THEN it SHALL operate on explicit
document, page identifier, and target index input.

### Requirement 5: DuplicatePageOptions

`DuplicatePageOptions` shall provide explicit builder state, document, source
page identifier, and duplicate page name input.

#### 5.1: DuplicatePageOptions fields

WHEN a caller duplicates a page, THEN `DuplicatePageOptions` SHALL carry
explicit builder state, document, source page identifier, and duplicate page
name input.

### Requirement 6: duplicatePage

`duplicatePage` shall duplicate a page and allocate all new identifiers from
explicit builder state.

#### 6.1: Duplicate page allocation

WHEN `duplicatePage` duplicates a page, THEN it SHALL allocate the new page
identifier and cloned node identifiers from explicit builder state.

### Requirement 7: renamePage

`renamePage` shall rename a page from explicit document, page identifier, and
name input.

#### 7.1: Rename page operation

WHEN `renamePage` changes a page name, THEN it SHALL operate on the explicit
document, page identifier, and name input.

### Requirement 8: deepCloneNodes

`deepCloneNodes` shall clone child nodes with identifiers from explicit builder
state.

#### 8.1: Deep clone allocation

WHEN `deepCloneNodes` clones children, THEN it SHALL allocate each cloned node
identifier from explicit builder state.

### Requirement 9: assertBuilderState

`assertBuilderState` shall reject missing explicit builder state.

#### 9.1: Builder state assertion

WHEN required builder state is missing, THEN `assertBuilderState` SHALL throw
a specific error.

### Requirement 10: assertNonEmptyString

`assertNonEmptyString` shall reject missing required page name input.

#### 10.1: Non-empty string assertion

WHEN a required page name is missing, THEN `assertNonEmptyString` SHALL throw
a specific error.
