# Fig-Adjacent Formats

This note records format-level differences between normal `.fig` packages and
Figma-adjacent packages (`.deck`, `.buzz`, `.site`). The goal is to keep
file-format responsibility separate from Kiwi codec responsibility and from
product-domain rendering semantics.

## Shared Container

These formats use the same outer ZIP package shape:

| Entry | Role |
|---|---|
| `canvas.fig` | Raw fig canvas stream |
| `meta.json` | Export metadata and preview coordinates |
| `thumbnail.png` | Package thumbnail |
| `images/<hash>` | Embedded image payloads |

The `canvas.fig` stream keeps the same chunk layout across these formats:

```text
16 byte header
schema chunk
4 byte data chunk size
data chunk
```

The chunks are still decoded by the Kiwi codec after decompression. The file magic identifies the raw fig canvas container family; it is not a Kiwi concern.

## Format Profiles

| Extension | Canvas magic | Product domain |
|---|---|---|
| `.fig` | `fig-kiwi` | design |
| `.deck` | `fig-deck` | presentation |
| `.buzz` | `fig-buzz` | social/marketing |
| `.site` | `fig-site` | site/layout |

The raw canvas version, schema size, compression kind, node count, image count,
and blob count are properties of the specific file being decoded. They are not
part of the product profile and must not be hard-coded into product packages.

## Schema Differences

Compared with a plain design-focused `.fig` schema, adjacent schemas may add
definitions for presentation, site, tooling, source-control, effects, and
timeline data. Representative adjacent-only definitions include:

```text
Scene3d
Transform3d
TimelineData
TimelineAssignmentsMap
Tools
ToolId
CustomEffects
CustomEffectData
SourceControlConfig
GitRepoRef
SpecBlockType
StrokeData
GridAutoTracks
SceneGraphQueryMode
```

Representative adjacent-only `Message` field:

```text
sceneGraphQueryMode
```

Representative adjacent-only `NodeChange` fields include:

```text
scene3d
transform3d
timelineAssignments
timelineDefinitions
timelineDisabled
tools
customEffects
sourceControlConfig
strokeData
gridAutoTracks
presentationOutlines
specBlockContent
specBlockType
specWidth
specHeight
specImageHash
```

Representative adjacent-only `NodeType` enum values:

```text
CUSTOM_EFFECT_INSTANCE
NATIVE_CODE_LAYER_INSTANCE
SPEC_BLOCK
TOOL_INSTANCE
```

These are schema capabilities. A specific file may carry the schema without using every added field or node type.

## Domain Node Families

Deck-like documents may use presentation-oriented node families:

```text
SLIDE_GRID
SLIDE_ROW
SLIDE
INTERACTIVE_SLIDE_ELEMENT
```

Buzz-like documents may use slide or symbol wrappers with vector-heavy content:

```text
SLIDE_GRID
SLIDE_ROW
SYMBOL
BOOLEAN_OPERATION
VECTOR
```

Site-like documents may use site/layout-oriented node families:

```text
CMS_RICH_TEXT
REPEATER
RESPONSIVE_SET
SYMBOL
INSTANCE
```

Plain `.fig` design documents commonly use general design node families such as:

```text
BOOLEAN_OPERATION
ELLIPSE
GROUP
INSTANCE
RECTANGLE
REGULAR_POLYGON
SECTION
STAR
SYMBOL
```

These are content patterns, not exclusive capabilities. Any product package must
preserve unknown schema fields and node families that it does not interpret.

## Package Boundaries

Keep the package layout aligned to abstraction axes, not to the current `.fig`
implementation. `.deck`, `.buzz`, and `.site` must be added as peer document
products, not as special cases inside the fig packages.

The source of truth for dependency direction is each package's
`package.json:higma.boundary`. ESLint reads that metadata with
`custom/enforce-package-boundaries`; the rule is not a per-product allowlist.

| Layer | Scope | Responsibility |
|---:|---|---|
| 0 | `@higma-primitives/*` | Format-agnostic data structures and byte utilities: `buffer`, `zip`, `tree`. No codec, Figma file, document, renderer, or editor imports. |
| 0 | `@higma-editor-kernel/*` | Product-free editor state, geometry, history, and primitive UI packages. No document product imports. |
| 1 | `@higma-codecs/*` | Pure encoders/decoders such as `kiwi` and `png`. No `.fig`, `.deck`, `.buzz`, or `.site` policy. |
| 1 | `@higma-editor-surfaces/*` | Product-free editor surfaces such as controls and generic sessions. They consume editor kernel packages but not document products. |
| 2 | `@higma-figma-schema/*` | Figma file-family schema facts. `profiles` owns magic/profile facts; `node-types` owns product-adjacent node type groups. |
| 3 | `@higma-figma-containers/*` | Figma file-family container mechanics. `canvas` owns raw canvas headers; `package` owns package entries, metadata, thumbnails, and image payload slots. |
| 3 | `@higma-figma-runtime/*` | Product-free decoded fig-family runtime data. `kiwi-canvas` owns ZIP/raw canvas to decoded Kiwi message; `node-summary` owns schema-agnostic node/field summaries. |
| 4 | `@higma-figma-analysis/*` | Product-free schema/metadata analysis. `format-insights` consumes decoded runtime data and carries schema, metadata, and node-summary facts into product models; `schema-diff` compares Kiwi schema definitions. |
| 5 | `@higma-document-models/*` | Decoded product document models: `fig`, `deck`, `buzz`, `site`. Product models must not import each other. |
| 6 | `@higma-document-io/*` | Product parse/write/build/export adapters. Each product depends on its own model plus lower file/codec/primitive layers. |
| 6 | `@higma-document-renderers/*` | Product-specific model-to-rendering adapters. They consume their own product model and lower layers, not peer products. |
| 7 | `@higma-document-editors/*` | Product-specific editor integrations. They may consume their own product model and product-free editor packages. |

The enforced direction is:

```text
@higma-primitives
  -> @higma-codecs
  -> @higma-figma-schema
  -> @higma-figma-containers
  -> @higma-figma-runtime
  -> @higma-figma-analysis
  -> @higma-document-models
  -> @higma-document-io
  -> @higma-document-renderers
  -> @higma-document-editors

@higma-editor-kernel and @higma-editor-surfaces are product-free and can only be
consumed by editor-surface and document-editor packages.
```

The important rule for deck/buzz/site is product isolation: `fig` must not import
`deck`, `buzz`, or `site`; those product packages must not import `fig`. Shared
behavior moves down to `@higma-figma-schema`, `@higma-figma-containers`, `@higma-codecs`, `@higma-primitives`,
or product-free editor/rendering packages when those exist as real multi-package
scopes.

Imports and re-exports are both part of the boundary. A package must not import
from another package and then expose that imported symbol from its own entry
point as an indirect compatibility surface.

The `deck`, `buzz`, and `site` product models carry `insights` produced by
`@higma-figma-analysis/format-insights`. Product render plans and editor
sessions expose that same insights object, so schema and metadata differences
are available to renderer/editor integrations without importing peer products
or raw fig-specific packages.

The same document-product layer is also closed horizontally. For example,
`@higma-document-models/deck` must not import `@higma-document-models/fig`, and
`@higma-document-renderers/site` must not import
`@higma-document-renderers/deck`. Shared behavior must move to a lower,
product-free package instead of using a peer package as an implementation
shortcut.

Do not split a product package only because a magic exists. Split when there is
domain behavior that would otherwise leak into `@higma-document-models/fig`,
`@higma-document-io/fig`, or `@higma-document-renderers/fig`.

## Implementation Notes

Add support in this order:

1. Treat raw canvas magic as container detection in `@higma-figma-containers/canvas`, not in `@higma-codecs/kiwi`.
2. Decode raw/ZIP-wrapped fig-family files in `@higma-figma-runtime/kiwi-canvas`.
3. Keep the chunk splitter and Kiwi decoder shared across all known magic values.
4. Preserve schema and unknown fields for roundtrip before adding semantic conversion.
5. Add renderer support only for node semantics that affect visual output.
6. Introduce product-domain packages when the behavior is not generic raw fig parsing.

The immediate generic additions are:

```text
fig-site magic support
SLIDE_GRID / SLIDE_ROW / SLIDE frame-like rendering
INTERACTIVE_SLIDE_ELEMENT frame-like rendering
CMS_RICH_TEXT parse preservation
REPEATER and RESPONSIVE_SET parse preservation
```

The product-domain interpretation should remain outside `@higma-document-models/fig`.
