# Hypothesis check: Component / Component Set on disk SoT

Purpose: determine empirically what the Figma `.fig` (Kiwi binary) SoT
actually encodes for the "Component" / "Component Set" / "Variant Set"
concepts. Each `.fig` under `artifacts/` was opened in real Figma; the
observation tells us which structural elements are load-bearing and which
are decorative.

The repo-side refactor (removing the phantom `COMPONENT` / `COMPONENT_SET`
node types throughout 41 source files) is grounded in these observations.

## Layout

```
docs/refactor/disk-sot-verification/
├── README.md                # this file
├── artifacts/               # the .fig files opened in Figma
├── builders/                # build-…ts scripts that produce artifacts/*.fig
└── probes/                  # read-only scripts that inspect .fig structure
```

## Verified facts (final)

1. **No `COMPONENT` / `COMPONENT_SET` NodeType exists in `.fig`.** The
   Figma UI's "Component" concept is encoded on disk as a plain `SYMBOL`
   (NodeType value 15). The 7.9 MB / 9586-node Community example
   *Simple Design System.fig* contains 0 nodes of type `COMPONENT` /
   `COMPONENT_SET`, and its embedded schema does not declare either name.
2. **A Variant Set on disk is a `FRAME` carrying variant metadata.**
   The load-bearing fields, observed in real Figma exports and confirmed
   by build-and-open experiments:
   - `componentPropDefs: [{ id, name, type: { value: 4, name: "VARIANT" }, … }]`
   - `isStateGroup: true`
   - `isPublishable: true`
   - `stateGroupPropertyValueOrders: [{ property, values: [...] }]`
3. **Each variant child is a `SYMBOL` carrying** `variantPropSpecs:
   [{ propDefId, value }]` where `propDefId` references the
   `componentPropDefs[].id` on its parent FRAME. The child's `name` may
   take the `Prop=Value` form (e.g. `Shape=Light`), but the naming is
   decorative — file `B-naming-only.fig` proved that naming alone does
   not produce a Variant Set.
4. **An INSTANCE that points at a variant child is a normal INSTANCE
   whose `symbolData.symbolID` targets the variant SYMBOL's GUID
   directly.** No `componentPropAssignments` are required for variant
   switching; Figma derives the dropdown options from the parent
   FRAME's `componentPropDefs` + `stateGroupPropertyValueOrders`, and
   the switch operation rewrites the INSTANCE's `symbolData.symbolID`.
5. **An "Internal Only" hidden CANVAS uses `internalOnly: true`, not
   only `visible: false`.** Real Figma exports set both. In G5 we set
   only `visible: false` and Figma still showed the CANVAS in the
   Pages list; this is a Figma-UI concern, not a load-bearing SoT
   constraint.
6. **Figma rejects unknown NodeType enum values on import.** Adding
   `COMPONENT=61` / `COMPONENT_SET=62` to the embedded schema and
   writing a node with that value produces a validation error
   (`A-with-component-types.fig`). The schema is enforced strictly.

## Artifacts and observations

| File | What it tests | Result |
|---|---|---|
| `A-with-component-types.fig` | Schema augmented with `COMPONENT=61` / `COMPONENT_SET=62`, one SYMBOL rewritten to `COMPONENT`. | **Validation error during import**. Disk SoT does not accept unknown NodeType values. |
| `B-naming-only.fig` | Plain FRAME parent + two sibling SYMBOLs whose names are `Variant=Solid` / `Variant=Outline`. No other variant metadata. | Opens. FRAME not rendered. Not recognised as Variant Set. Confirms: naming convention alone is decorative. |
| `C-with-propdefs.fig` | Adds `componentPropDefs(VARIANT)`, `isStateGroup`, `isPublishable`, `stateGroupPropertyValueOrders` on parent FRAME, `variantPropSpecs` on each SYMBOL child. | Opens. FRAME still not rendered, but "2 Variants" label appears. Variant toggle exists but the other variant disappears when one is selected — the FRAME is the *definition* side, not a canvas render target. |
| `D-switchable.fig` | Same as C, plus child SYMBOL transforms re-laid in parent-local space, parent FRAME sized to contain them, plus one INSTANCE on the canvas pointing at `Variant=Solid`. | Both variants look identical (cloned), so the switch could not be visually verified. Recognition happened, rendering did not. |
| `E-minimal-distinct-variants.fig` | Two variants synthesised from scratch with deliberately distinct visuals (blue fill vs blue outline) plus a Demo INSTANCE. | Variant Set frame recognised (❖ icon in Layers). Demo INSTANCE recognised (◇ icon). Nothing renders on canvas — the synthesised ROUNDED_RECTANGLE/TEXT children miss a Kiwi-level invariant. Confirms: **recognition and rendering are decoupled**. |
| `F-real-subset.fig` | "Radio Icon" variant set extracted from Simple Design System.fig with external refs stripped, written into a standalone .fig. | **Internal error during import.** Caused by using the giant donor as the *host* `loaded` object — its schema/metadata/blob graph couldn't be sliced safely. (`G4` proves the subtree itself is fine if injected into a smaller, healthy host.) |
| `G1-passthrough-components.fig` | components.fig → loadFigFile → saveFigFile, no edits. | Opens. Save pipeline is healthy. |
| `G2-empty-canvas.fig` | components.fig with `nodeChanges` reduced to DOCUMENT + 1 CANVAS. | Opens. Node deletion alone is safe. |
| `G3-two-canvases.fig` | G2 + a second `visible:false` CANVAS. | Opens. Multi-canvas (incl. hidden) is safe. |
| `G4-radio-icon-injected.fig` | G3 + Radio Icon Variant Set subtree injected under the hidden CANVAS, with blob references remapped into the host's blob array. | Opens. Subtree injection is safe. |
| `G5-radio-icon-with-instance.fig` | G4 + a Demo INSTANCE on the visible CANVAS pointing at `Shape=Light`. | **Final positive case.** Opens. INSTANCE renders (Radio Light shape). Properties panel shows a `Shape` dropdown with Light/Dark/Mid. Switching the dropdown changes the rendered shape. Hidden CANVAS appears in Pages list (because we only set `visible:false`, not `internalOnly:true`). |

## Reproducing

Each builder is standalone:

```sh
bun docs/refactor/disk-sot-verification/builders/G5-radio-icon-with-instance.ts
```

Each probe takes the .fig path as `process.argv[2]` (most have a sensible
default):

```sh
bun docs/refactor/disk-sot-verification/probes/parent-index.ts \
    docs/refactor/disk-sot-verification/artifacts/G5-radio-icon-with-instance.fig
```

## Implications for the repo-side refactor

The 116 references to `"COMPONENT"` / `"COMPONENT_SET"` string literals
across 41 files in this codebase fall into three categories:

1. **Disk write paths** (e.g. `MAKE_COMPONENT_FROM_SELECTION` reducer,
   `node-factory.ts`): must produce `SYMBOL` on disk. If a UI affordance
   names the operation "Make Component", that's a presentation concern;
   the on-disk node type is `SYMBOL`.
2. **Variant-set detection** (e.g. `findVariantContainer`,
   `hasVariantSiblings`): naming `/^[^=]+=[^=]+/` should be replaced by
   the SoT condition `parent.isStateGroup === true && componentPropDefs
   contains a VARIANT-typed entry`. Naming becomes the secondary
   fallback (or is dropped entirely).
3. **Cosmetic / dead branches** (e.g. switch cases for `"COMPONENT" |
   "COMPONENT_SET"` in renderers and emitters): the cases never fire on
   real `.fig` input. They should be removed; SYMBOL is the only real
   case.

A "Variant Set" written by this repo must be a FRAME with the four
metadata fields listed above; a "Component" written by this repo is a
SYMBOL. There is no third node type to introduce.
