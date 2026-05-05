### Requirement 1: Renderer does not depend on document IO

The `@higma-document-renderers/fig` package shall render fig domain data
without importing `@higma-document-io/fig` at runtime or through indirect
re-export paths.

#### 1.1: Direct import boundary

WHEN renderer source files are inspected, THEN no source file SHALL import
from `@higma-document-io/fig`.

#### 1.2: Indirect re-export boundary

WHEN renderer source files import fig conversion helpers, THEN those helpers
SHALL be owned by a lower domain package or by the renderer package itself,
not re-exported through document IO.

#### 1.3: No duplicate conversion logic

WHEN fig node conversion is required by both IO and rendering, THEN the shared
conversion semantics SHALL have one source of truth rather than separate
copies with divergent behavior.

### Requirement 2: Conversion ownership is explicit

Fig node to renderable design node conversion shall have an explicit owner
that matches the dependency direction.

#### 2.1: Lower-layer conversion

IF conversion is domain-neutral, THEN it SHALL be placed in a lower fig model
or runtime package that document IO and renderer packages can both consume.

#### 2.2: Renderer-local conversion

IF conversion is renderer-specific, THEN it SHALL live in the fig renderer
package and document IO SHALL NOT import it.

#### 2.3: Fail-fast conversion

WHEN a required node field is missing during conversion, THEN conversion
SHALL throw a specific error instead of inventing fallback geometry, style,
or text data.

### Requirement 3: Rendering behavior remains covered

The renderer IO decoupling shall preserve existing render output behavior
while making dependency boundaries enforceable.

#### 3.1: Renderer tests

WHEN fig renderer tests run, THEN SVG and scene graph rendering behavior SHALL
remain covered by assertions.

#### 3.2: Boundary lint

WHEN package boundary lint runs, THEN the renderer package SHALL report zero
document IO dependency violations.

#### 3.3: Spec alignment

WHEN indexion checks this requirement set against the renderer implementation,
THEN there SHALL be no drifted, spec-only, shallow, or conflict items for this
feature.
