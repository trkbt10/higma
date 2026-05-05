### Requirement 1: Builder APIs require explicit construction state

The fig document builder APIs shall not rely on module-level mutable state,
implicit node identifier counters, or hidden defaults for required document
construction data.

#### 1.1: Explicit builder state

WHEN a caller creates nodes or pages through builder APIs, THEN the caller
SHALL provide an explicit builder state or explicit identifier allocation
strategy.

#### 1.2: No hidden counters

WHEN builder source files are inspected, THEN public creation APIs SHALL NOT
depend on a hidden module-level counter for node identifiers.

#### 1.3: Missing required input

WHEN required builder inputs are missing, THEN the builder SHALL throw a
specific error rather than constructing a partial node with guessed values.

### Requirement 2: Builder ownership remains in document IO

Fig file construction and export orchestration shall remain document IO
responsibilities and shall not move into model, renderer, editor, or UI
packages.

#### 2.1: Builder package direction

WHEN builder code imports other packages, THEN it SHALL depend only on allowed
lower layers such as primitives, codecs, schema, container, runtime, analysis,
and document model packages.

#### 2.2: No renderer or editor dependency

WHEN builder source files are inspected, THEN they SHALL NOT import renderer,
editor, or UI packages.

#### 2.3: No compatibility escape

WHEN builder APIs change to require explicit state, THEN old implicit-state
wrappers SHALL NOT remain as compatibility aliases.

### Requirement 3: Drift gates cover explicit behavior

The explicit builder API behavior shall be verified by tests and spec
alignment.

#### 3.1: Unit tests

WHEN builder node creation tests run, THEN they SHALL assert explicit
identifier allocation and missing-input failures.

#### 3.2: Boundary lint

WHEN package boundary lint runs, THEN the builder implementation SHALL report
zero dependency direction or re-export violations.

#### 3.3: Spec alignment

WHEN indexion checks this requirement set against the builder implementation,
THEN there SHALL be no drifted, spec-only, shallow, or conflict items for this
feature.
