### Requirement 1: Model package contains only fig document domain state

The `@higma-document-models/fig` package shall own fig domain types,
schema-neutral metadata, and pure value helpers, but shall not expose file
parsing, binary decoding, schema validation pipelines, or compatibility
facades for those operations.

#### 1.1: Public exports

WHEN a consumer imports `@higma-document-models/fig`, THEN parser and
validator entry points SHALL NOT be available from the model package exports.

#### 1.2: Domain-only imports

WHEN code under `@higma-document-models/fig` is inspected, THEN it SHALL NOT
import from document IO, rendering, editor, surface, or builder packages.

#### 1.3: No compatibility escape

WHEN parser or validator functionality is moved, THEN the old model package
paths SHALL NOT remain as re-export wrappers or compatibility aliases.

### Requirement 2: Fig parsing and validation are IO responsibilities

The `@higma-document-io/fig` package shall own fig file parsing and fig file
schema validation as document IO responsibilities.

#### 2.1: Parser entry point

WHEN a consumer needs to parse a fig file representation, THEN it SHALL import
the parser entry point from `@higma-document-io/fig`.

#### 2.2: Validator entry point

WHEN a consumer needs to validate a parsed fig document representation, THEN
it SHALL import the validator entry point from `@higma-document-io/fig`.

#### 2.3: Fail-fast behavior

WHEN parsing or validation input lacks required schema data, THEN the IO
implementation SHALL throw a specific error instead of guessing, defaulting,
or silently accepting an incomplete document.

### Requirement 3: Boundary gates prevent drift

The implementation shall make dependency boundary violations observable.

#### 3.1: Package boundary lint

WHEN lint runs with package boundary rules enabled, THEN no model-to-IO,
model-to-renderer, model-to-editor, same-scope package, or re-export boundary
violation SHALL be reported for fig parsing and validation.

#### 3.2: Spec alignment

WHEN indexion checks this requirement set against the affected implementation,
THEN there SHALL be no drifted, spec-only, shallow, or conflict items for this
feature.

#### 3.3: Regression tests

WHEN fig parser and validator tests run, THEN existing supported valid and
invalid fixture behavior SHALL remain covered by real assertions.
