# Component / Component Set — disk SoT reference

> Empirically verified against real Figma binaries and confirmed by opening
> generated fixtures in Figma. Each statement here is a load-bearing
> invariant for any code that reads or writes `.fig` files in this repo.

This document records the **disk Source of Truth** for the Figma UI
concepts "Component", "Component Set" / "Variant Set", and the
INSTANCE-side variant switch. Code that contradicts what is written here
will produce `.fig` files that Figma rejects, silently corrupts, or
opens but renders incorrectly.

## NodeType inventory

The Kiwi `NodeType` enum declared in `figma-schema.json` (and embedded
in every real `.fig` file) does **not** define `COMPONENT` or
`COMPONENT_SET`. The relevant entries are:

| `name`           | `value` | Meaning |
|------------------|---------|---------|
| `FRAME`          | 4       | Generic frame. Becomes a Variant Set when carrying variant metadata. |
| `SYMBOL`         | 15      | The on-disk encoding of the UI concept "Component". |
| `INSTANCE`       | 16      | Reference to a SYMBOL. |
| `CODE_COMPONENT` | 40      | Unrelated; belongs to Code Connect, not user-facing components. |

Figma's import validator **rejects unknown NodeType values**. Writing a
node with `type.name === "COMPONENT"` and a synthesised numeric value
produces "Internal error during import" / validation failure even if the
embedded schema declares the new enum entry. The schema is enforced
strictly against Figma's own NodeType set.

## "Component"

The Figma UI concept "Component" is encoded on disk as a single `SYMBOL`
node (NodeType value 15). There is no distinct on-disk type. Whether a
SYMBOL is "publishable as a library component" is conveyed by
`isPublishable`, `isSymbolPublishable`, and the `sharedSymbolVersion`
metadata — not by a different NodeType.

## "Component Set" / "Variant Set"

The Figma UI concept "Component Set" is encoded on disk as a `FRAME`
that carries the following four fields when emitted by Figma's
exporter:

```ts
{
  type: { value: 4, name: "FRAME" },
  isStateGroup: true,
  isPublishable: true,
  componentPropDefs: [
    {
      id: <FigGuid>,
      name: <string>,                            // e.g. "Variant", "Shape"
      type: { value: 4, name: "VARIANT" },       // VARIANT-typed propDef
      initialValue: {},
      sortPosition: <fractional-index string>,
      preferredValues: {},
      varValue: {
        value: { textValue: "" },
        dataType: { value: 2, name: "STRING" },
        resolvedDataType: { value: 2, name: "STRING" },
      },
    },
    // … additional VARIANT propDefs (multi-dimensional variants)
    // … additional non-VARIANT propDefs (TEXT, BOOL, …) are component
    //   properties exposed on the instance, not variant axes.
  ],
  stateGroupPropertyValueOrders: [
    { property: "<propDef.name>", values: ["Solid", "Outline", …] },
    // one entry per VARIANT propDef, in display order.
  ],
}
```

Each direct child is a `SYMBOL` carrying:

```ts
{
  type: { value: 15, name: "SYMBOL" },
  variantPropSpecs: [
    { propDefId: <parent FRAME's componentPropDefs[].id>, value: "Solid" },
    // one entry per VARIANT axis on the parent.
  ],
  // … plus the symbol's own contents (geometry, layout, etc.)
}
```

### Which of the four fields are load-bearing for detection

Of the four fields above, only **`isStateGroup: true`** and a
VARIANT-typed entry in **`componentPropDefs`** are required to
classify a FRAME as a Variant Set. `isPublishable` and
`stateGroupPropertyValueOrders` are emitted by Figma for round-trip
fidelity and UI label reconstruction, respectively, but neither is
consulted by the disk-side detector — a Variant Set still functions
correctly without either, and an attacker-controlled FRAME that sets
both without `isStateGroup` is not a Variant Set.

### What is decorative

- The `Prop=Value` naming convention on the child SYMBOLs (e.g.
  `"Shape=Light"`) is decorative. It is a side effect of how Figma's
  UI labels variants — Figma reconstructs the displayed labels from
  `stateGroupPropertyValueOrders` and `variantPropSpecs`, not from the
  name. A FRAME-plus-`Prop=Value`-named-siblings structure **without**
  the disk metadata above is recognised as neither a Variant Set nor
  renderable content.

### What detection should look like

```ts
function isVariantSetFrame(node: FigNode): boolean {
  if (node.type?.name !== "FRAME") return false;
  if (node.isStateGroup !== true) return false;
  return (node.componentPropDefs ?? []).some(
    (d) => d.type?.name === "VARIANT",
  );
}
```

This is the SoT-aligned condition. Detection by child-name regex is
unreliable: a hand-authored FRAME with `Prop=Value`-named SYMBOL
children but no propDefs is not a Variant Set, and a propDef-bearing
FRAME whose children happen to be misnamed is still a Variant Set.

## INSTANCE referencing a variant

An INSTANCE that targets a specific variant uses the standard SYMBOL
reference path:

```ts
{
  type: { value: 16, name: "INSTANCE" },
  symbolData: {
    symbolID: <variant child SYMBOL's FigGuid>,   // points directly at the variant, not the parent
    symbolOverrides: [
      { guidPath: { guids: [<same guid>] }, size: { x, y }, … },
      // … further per-descendant overrides
    ],
    uniformScaleFactor: 1,
  },
}
```

No `componentPropAssignments` field is required for variant switching.
Figma derives the dropdown options from the parent FRAME's
`componentPropDefs` + `stateGroupPropertyValueOrders`. The act of
"switching variants" rewrites `symbolData.symbolID` to a sibling
SYMBOL's GUID. `componentPropAssignments` is only used to override
non-VARIANT propDefs (e.g. text content).

## Hidden CANVAS for component definitions

Real Figma exports place component / variant-set definitions on a
CANVAS named `"Internal Only Canvas"` that has both:

```ts
{ visible: false, internalOnly: true }
```

Setting only `visible: false` is **not** sufficient — the CANVAS still
appears in the Pages list. `internalOnly: true` is the SoT flag that
hides the canvas from the Pages UI.

## Code-side consequences

The references to `"COMPONENT"` / `"COMPONENT_SET"` string literals
scattered across the codebase fall into three categories. Treatment
for each:

| Category | Treatment |
|---|---|
| Disk write paths (e.g. `MAKE_COMPONENT_FROM_SELECTION` reducer; `node-factory.ts` `applyTypeSpecificFields`) | Write `SYMBOL` (`type.value === 15`). Container-like field behaviour (`clipsContent`, `autoLayout`, `children`) belongs in the SYMBOL case, not in a phantom `COMPONENT` case. UI-side labels such as "Component" / "Make Component" are presentation, not disk type. |
| Variant Set detection (e.g. `findVariantContainer`, `hasVariantSiblings`, `ComponentSetVariantsSection` UI guards) | Use the SoT condition: `parent.type === "FRAME" && parent.isStateGroup === true && parent.componentPropDefs.some(d => d.type.name === "VARIANT")`. Replace `Prop=Value` name regex matching. |
| Dead branches (renderer / emitter switch cases for `"COMPONENT" \| "COMPONENT_SET"`) | Remove. Real `.fig` input never reaches these branches; they document an SoT-incorrect architectural belief. |

The `FIG_NODE_TYPE` constants `COMPONENT` and `COMPONENT_SET` must be
removed from `packages/@higma-document-models/fig/src/types.ts`. Their
presence widens the `FigNodeType` union with values that the canonical
schema cannot encode.

A "Variant Set" written by this repo is a FRAME with the four metadata
fields above plus children with `variantPropSpecs`. A "Component" is a
SYMBOL. There is no third node type to introduce, and no fallback or
migration path should be added that pretends otherwise — Figma rejects
such files on import.

## Verification provenance

The investigation log, intermediate fixtures, builders, and probes are
under `docs/refactor/disk-sot-verification/`. The decisive evidence:

- `docs/refactor/disk-sot-verification/artifacts/A-with-component-types.fig` —
  schema-extended file with synthesised `COMPONENT=61` /
  `COMPONENT_SET=62`. Figma: validation error.
- `docs/refactor/disk-sot-verification/artifacts/G5-radio-icon-with-instance.fig` —
  Variant Set (real Figma data) + switchable INSTANCE. Figma: opens,
  renders, the variant dropdown works, switching visibly changes the
  rendered shape.
- `docs/refactor/disk-sot-verification/probes/simple-design-system.ts` against a
  9586-node Community export: 0 `COMPONENT` / `COMPONENT_SET` nodes,
  109 `FRAME`s carrying VARIANT-typed `componentPropDefs`, 100 %
  correlation between propDef presence and `Prop=Value` child naming.
