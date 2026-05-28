/**
 * @file Shared types for the JSX emitter.
 */
import type { FigNode } from "@higma-document-models/fig/types";

/** A single React component to be written to disk. */
export type EmitFile = {
  /** Path relative to the output root (e.g. `pages/design/home.tsx`). */
  readonly path: string;
  /** File contents — generated TSX source. */
  readonly contents: string;
};

/** A target frame discovered under the chosen CANVAS. */
export type FrameTarget = {
  readonly node: FigNode;
  /** PascalCase React component identifier. */
  readonly componentName: string;
  /** Path relative to the output root. */
  readonly filePath: string;
  /** kebab-case slug used in the file path. */
  readonly slug: string;
  /** kebab-case slug for the source canvas (used as a folder layer). */
  readonly canvasSlug: string;
};

/**
 * A typed component property derived from a node's `componentPropDefs`.
 *
 * `kind` mirrors Figma's `ComponentPropertyType` enum but with TypeScript
 * names — `bool` becomes `boolean`, `text` becomes `string`, etc. The
 * variant kind is special: its `values` array holds the union of
 * variant values declared by sibling SYMBOLs, so the generated prop
 * type is `"On" | "Off"` rather than a generic `string`.
 */
export type ComponentPropDecl =
  | { readonly kind: "variant"; readonly name: string; readonly defId: string; readonly values: readonly string[]; readonly defaultValue: string }
  | { readonly kind: "boolean"; readonly name: string; readonly defId: string; readonly defaultValue?: boolean }
  | { readonly kind: "string"; readonly name: string; readonly defId: string; readonly defaultValue?: string }
  | { readonly kind: "number"; readonly name: string; readonly defId: string; readonly defaultValue?: number }
  | { readonly kind: "node"; readonly name: string; readonly defId: string };

/**
 * One component file generated for a referenced SYMBOL or for a
 * "Variant Set" — the parent FRAME bearing `isStateGroup` +
 * VARIANT-typed `componentPropDefs` that groups multiple variant
 * SYMBOLs together. The canonical schema has no COMPONENT_SET
 * NodeType — see `docs/refactor/component-type-cleanup.md`.
 *
 * `variants.size > 0` means the generator should emit a discriminated
 * component switching on the declared variant prop.
 */
export type ComponentTarget = {
  readonly node: FigNode;
  readonly componentName: string;
  readonly filePath: string;
  readonly slug: string;
  /** kebab-case slug for the source canvas (used as a folder layer). */
  readonly canvasSlug: string;
  /**
   * For a variant set: variant value → variant SYMBOL child keyed by
   * `variantPropSpecs[0].value`. Empty when the target is a plain
   * SYMBOL (no variants).
   */
  readonly variants: ReadonlyMap<string, FigNode>;
  /**
   * Typed prop declarations derived from the target's `componentPropDefs`.
   * For a variant set, the variant axis appears here as a `kind:"variant"`
   * entry whose `values` reflect the keys of `variants`.
   */
  readonly props: readonly ComponentPropDecl[];
};

/**
 * Registry mapping fig node ids → the file/component they emit into.
 * Built once at the start of emission so JSX for an INSTANCE can
 * reference its target component by import path even when the SYMBOL
 * is processed after the page that uses it.
 */
export type EmitRegistry = {
  readonly frames: ReadonlyMap<string, FrameTarget>;
  /**
   * Indexed by the node id of the symbol / component / variant-set
   * FRAME that authored the component. INSTANCE nodes look up by
   * resolving their `symbolID` then walking up to the variant set.
   */
  readonly components: ReadonlyMap<string, ComponentTarget>;
  /**
   * Set of descendant guids that some call site in the document
   * overrides with an IMAGE fillPaint. When emitting a SYMBOL body
   * that contains such a descendant, the emitter swaps the literal
   * solid `background` for `background-image: var(--bg-<guid>,
   * <default>)` so the inner div can pick up an image URL passed in
   * via the wrapper's CSS variable. Empty when no IMAGE fill
   * overrides exist anywhere.
   */
  readonly imageFillOverrideTargets: ReadonlySet<string>;
  /**
   * Set of TEXT-node guids that some INSTANCE call site in the
   * document overrides with a `fontSize` field. When emitting a
   * SYMBOL body that owns the TEXT, the emitter writes its
   * `font-size` as `var(--fs-<guid>, <default>)` so a call-site
   * wrapper can inject the actually-rasterised size. Without this
   * hop the SYMBOL's authored 32 px renders even at instance call
   * sites where Figma's export shows 42 px (the breakpoint scaling
   * case — `derivedTextData.glyphs[*].fontSize` differs from the
   * SYMBOL author's stored value on the INSTANCE's resolved tree
   * but not on the SYMBOL itself).
   */
  readonly fontSizeOverrideTargets: ReadonlySet<string>;
};
