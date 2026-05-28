/**
 * @file Source of truth for the per-node "display fields" Figma's
 * exporter always emits — primarily `visible` and `opacity`.
 *
 * Both the spec types (compile-time contract on builder input) and the
 * lint rules (post-construction contract on serialised output) reference
 * this list, so a future addition / removal stays in lockstep. Keeping
 * the names here as a `readonly` tuple lets TypeScript infer the union
 * for the lint rule's iteration AND lets the spec types pick from a
 * single named source instead of two open-coded fields.
 *
 * Why these fields are load-bearing: Kiwi binary encodes the `visible`
 * and `opacity` fields with implicit zero defaults. When a generator
 * omits them, the produced .fig opens in Figma's editor with every
 * layer hidden / fully transparent (the renderers in this repo treat
 * `undefined` as "visible / opaque", which masks the bug until a human
 * tries to open the file). Real Figma exports always write `visible:
 * true, opacity: 1` on every non-DOCUMENT node — this constant pins
 * the same contract on builder output.
 */

import type { FigNode } from "@higma-document-models/fig/types";

/**
 * Required display fields with a type-safe accessor per field.
 *
 * Both the spec types (compile-time contract on builder input) and the
 * `fig.shape.display-fields` lint rule (runtime contract on serialised
 * output) reference this list. Each entry's `read` directly returns the
 * declared `FigNode` field so the indexing is type-checked — the
 * project forbids `as unknown` / `as any` casts that would otherwise be
 * required when indexing FigNode by a string literal.
 *
 * Adding a new required display field means adding a new entry here AND
 * a new `readonly <name>: T` declaration to `BaseNodeSpec`. The TS
 * union here keeps the two halves in sync — `BaseNodeSpec` references
 * the same field names, so a typo in one shows up as a TS error in the
 * other.
 */
export const DISPLAY_FIELD_CHECKS = [
  {
    name: "visible",
    read: (node: FigNode): boolean | undefined => node.visible,
    remediation: "Set visible: true (or false for an intentionally hidden layer)",
  },
  {
    name: "opacity",
    read: (node: FigNode): number | undefined => node.opacity,
    remediation: "Set opacity: 1 (or a 0..1 value for partial transparency)",
  },
] as const;

export type RequiredNodeDisplayField = (typeof DISPLAY_FIELD_CHECKS)[number]["name"];

/**
 * Names tuple derived from `DISPLAY_FIELD_CHECKS` — convenient for
 * callers that only care about the field names (e.g. documentation
 * generators or schema validators) and don't need the accessors.
 */
export const REQUIRED_NODE_DISPLAY_FIELDS: readonly RequiredNodeDisplayField[] = DISPLAY_FIELD_CHECKS.map(
  (check) => check.name,
);

/**
 * Node types that do NOT need to carry display fields. Real Figma
 * exports omit `visible` / `opacity` on:
 *
 *   - `DOCUMENT` — the root, which has no visual representation.
 *   - `VARIABLE_SET` / `VARIABLE` — design-token nodes that live in
 *     the Internal Only Canvas. They describe styles, not layers, so
 *     opacity / visibility don't apply.
 *
 * Verified empirically across the shipped fixtures (`inherit.fig`,
 * `section.fig`, `components.fig`, `shapes.fig`, `image-fill.fig`):
 * every other type carries both fields explicitly. Adding a type
 * here narrows the contract — keep the comment in sync with the
 * fixtures that justify each entry.
 */
const DISPLAY_FIELDS_EXEMPT_TYPES: ReadonlySet<string> = new Set([
  "DOCUMENT",
  "VARIABLE_SET",
  "VARIABLE",
]);

/**
 * Returns `true` when the node is one of the types Figma's exporter
 * always writes `visible` and `opacity` on (FRAME / CANVAS / shape /
 * TEXT / SYMBOL / INSTANCE / etc.). Returns `false` for nodes whose
 * Kiwi schema omits the display fields entirely (DOCUMENT root and
 * the design-token VARIABLE / VARIABLE_SET nodes). The lint rule and
 * future spec-validation paths both call this so they exempt the
 * same set of node types.
 */
export function nodeRequiresDisplayFields(node: FigNode): boolean {
  const typeName = node.type?.name;
  if (typeof typeName !== "string") {
    return false;
  }
  return !DISPLAY_FIELDS_EXEMPT_TYPES.has(typeName);
}

/**
 * The expected runtime value for each required display field. Spec
 * authors typically want `visible: true, opacity: 1` — these match
 * Figma's defaults and what its exporter writes when nothing is
 * authored. Provided as a const helper so generators can spread it
 * (`{ ...DEFAULT_DISPLAY_FIELDS, … }`) instead of restating the pair.
 */
export const DEFAULT_DISPLAY_FIELDS: { readonly visible: true; readonly opacity: 1 } = {
  visible: true,
  opacity: 1,
};
