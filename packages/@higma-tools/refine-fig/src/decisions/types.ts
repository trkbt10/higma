/**
 * @file `Decisions` — the agent-authored JSON that drives the plan
 * layer.
 *
 * The skill's contract is: inventory describes facts, decisions
 * describe choices, plan is the deterministic combiner. Naming and
 * "is this worth promoting" judgements live here.
 *
 * The CLI scaffolds an empty Decisions file from an Inventory; the
 * agent edits it. Empty / blank fields mean "do nothing for this
 * entry". There is no implicit naming, no fallback proxy creation —
 * silence is honest.
 *
 * Shape:
 *
 *   - `clusters[clusterId]`     — what to do with a duplicate-subtree
 *                                  cluster (give it a name, optionally
 *                                  promote it to a SYMBOL).
 *
 *   - `palette[colorKey]`       — give a colour an authored name.
 *                                  When `name` is set we will create
 *                                  a fill-style proxy (or reuse the
 *                                  existing one) and bind every
 *                                  bind-eligible usage. When `name`
 *                                  is empty we do nothing.
 *
 *   - `typography[styleKey]`    — same shape, for text styles.
 *
 *   - `variantGroups[groupId]`  — the agent groups COMPONENT clusters
 *                                  into a COMPONENT_SET with explicit
 *                                  variant axes.
 */

export type ClusterDecision = {
  /** Authored name. Empty → no action for this cluster. */
  readonly name: string;
  /** When true, also promote the cluster's exemplar into a SYMBOL and
   *  rewrite every other clone into an INSTANCE referencing it. */
  readonly promoteToSymbol?: boolean;
  /** GUID of the member to use as the SYMBOL exemplar. When omitted
   *  the plan layer picks the first eligible member deterministically. */
  readonly exemplarGuid?: string;
  /** Per-member name overrides — rare, but supported. */
  readonly memberOverrides?: Readonly<Record<string, string>>;
};

export type PaletteDecision = {
  /** Authored name. Empty → no action for this colour. */
  readonly name: string;
};

export type TypographyDecision = {
  /** Authored name. Empty → no action for this descriptor. */
  readonly name: string;
};

export type VariantGroupDecision = {
  /** COMPONENT_SET name as it should appear in the document. */
  readonly name: string;
  /** Each entry is one cluster contributing one COMPONENT to the set. */
  readonly members: readonly {
    readonly clusterId: string;
    readonly variantValues: Readonly<Record<string, string>>;
  }[];
};

export type Decisions = {
  readonly clusters: Readonly<Record<string, ClusterDecision>>;
  readonly palette: Readonly<Record<string, PaletteDecision>>;
  readonly typography: Readonly<Record<string, TypographyDecision>>;
  readonly variantGroups: Readonly<Record<string, VariantGroupDecision>>;
};
