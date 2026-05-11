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
 * Note on "components": Figma's on-disk schema (the embedded Kiwi
 * schema in every `.fig` file as well as the bundled
 * `figma-schema.json`) declares only `SYMBOL` (value 15) and
 * `INSTANCE` (value 16) — there is no separate `COMPONENT` or
 * `COMPONENT_SET` node type. The user-facing "Component" concept is
 * just a SYMBOL. Variant grouping (Figma's "variant set" UI) does
 * not have a representation in this schema; promoting a cluster
 * yields a SYMBOL and INSTANCEs, full stop.
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
  /**
   * Optional: when set to another inventory `typography[key]`, the
   * plan layer redirects every `bind-text-style` action for this
   * descriptor to the merge target's proxy instead of creating its
   * own. The agent uses this to collapse near-duplicate descriptors
   * (e.g. a stray line-height typo) onto the real style. Empty when
   * the descriptor stands alone.
   *
   * The merge target must itself carry a non-empty `name` (or an
   * `existingProxyGuid` in the inventory). The plan layer throws when
   * the target is missing or also merged elsewhere — alias chains and
   * orphaned merges are caught at plan time so apply has nothing to
   * untangle.
   */
  readonly merge?: string;
};

/**
 * Group N promoted SYMBOL clusters under a Variant Set FRAME, encoding
 * the chosen property name and per-cluster value as a `Prop=Value`
 * sibling-naming convention. Figma's on-disk schema has no
 * COMPONENT_SET NodeType — see `docs/refactor/component-type-cleanup.md`
 * — so the variant-set is represented by a FRAME with `isStateGroup =
 * true` and a single VARIANT-typed `componentPropDefs[]` entry. Apply
 * moves every cluster's SYMBOL under the new FRAME and rewrites its
 * `name` to `<propertyName>=<value>`.
 *
 * Each cluster cited here must also carry `decisions.clusters[id] =
 * { promoteToSymbol: true, ... }` — only promoted SYMBOLs are
 * groupable. A cluster cannot appear in more than one variant set.
 * Both rules are enforced at plan time; apply only consumes the
 * resolved action.
 */
export type VariantSetDecision = {
  /** Display name of the Variant Set property (e.g. "Suit"). */
  readonly propertyName: string;
  /**
   * Map from the variant value (e.g. "Spades") to the inventory
   * cluster id whose promoted SYMBOL represents that variant.
   */
  readonly variants: Readonly<Record<string, string>>;
};

/**
 * Adopt an auto-layout hint that the analyser surfaced. The map key
 * is the FRAME's GUID string. Only `apply: true` opts the FRAME into
 * the `set-layout` plan action; omitting the entry (or `apply: false`)
 * leaves the FRAME's children at absolute positions. Apply uses the
 * hint values verbatim — there is no separate field override channel,
 * since by design the agent's review of the inventory is the
 * authoritative signal that the inferred values match intent.
 */
export type LayoutDecision = {
  readonly apply: boolean;
};

export type GeometryClusterDecision = {
  /** Authored name. Empty → no action. */
  readonly name: string;
};

export type Decisions = {
  readonly clusters: Readonly<Record<string, ClusterDecision>>;
  readonly palette: Readonly<Record<string, PaletteDecision>>;
  readonly typography: Readonly<Record<string, TypographyDecision>>;
  /**
   * Strict-byte VECTOR clusters: agent-authored names trigger
   * promotion into one SYMBOL + N INSTANCEs. Empty name = no action.
   */
  readonly geometryClusters?: Readonly<Record<string, GeometryClusterDecision>>;
  /**
   * Group N promoted SYMBOL clusters under a Variant Set FRAME. The
   * map key is the FRAME's name; the value declares which cluster
   * represents each variant value.
   */
  readonly variantSets?: Readonly<Record<string, VariantSetDecision>>;
  /**
   * Opt-in adoption of auto-layout hints from `inventory.layoutHints[]`.
   * Map key is the FRAME's GUID string (e.g. "1:42"). Absent keys mean
   * "do not apply"; the analyser never adopts a hint silently.
   */
  readonly layouts?: Readonly<Record<string, LayoutDecision>>;
};
