/**
 * @file `Inventory` data shape — strictly *facts* observed in the
 * source `.fig` file.
 *
 * Inventory makes no naming choices, applies no thresholds, and emits
 * no proposals. It walks the resolved hierarchy, groups what it sees by
 * canonical keys, and reports what is there. The agent reviews the
 * inventory through the workbench and authors a `Decisions` JSON
 * separately — that is where naming and "is this worth promoting"
 * judgement lives.
 *
 * Three sub-inventories:
 *
 *   - `palette[]`         — every visible SOLID paint, keyed by
 *                            quantised colour, with every usage site.
 *   - `typography[]`      — every distinct (family, style, fontSize,
 *                            lineHeight, letterSpacing) tuple seen on
 *                            a TEXT node, with every usage site.
 *   - `structureClusters[]` — every group of ≥ 2 visually-similar
 *                            structures the detector found. Members are
 *                            unsorted within a cluster; the agent
 *                            picks the exemplar.
 */

export type ColorRGBA = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
};

export type PaintRole = "fill" | "stroke" | "background";

export type PaintUsageRecord = {
  readonly nodeGuid: string;
  readonly nodeName: string;
  readonly nodeType: string;
  readonly role: PaintRole;
  readonly paintIndex: number;
  /**
   * Whether the analyser considers this node's paint stack safe to
   * rebind to a single-SOLID style styleDefinition. Multi-paint stacks
   * (image-over-solid etc.) are flagged false so the plan layer
   * never proposes a binding for them.
   */
  readonly bindEligible: boolean;
};

export type PaletteAliasRecord = {
  /** Fine-grain `colorKey` of the absorbed bucket. */
  readonly key: string;
  readonly color: ColorRGBA;
  readonly hex: string;
  /** Number of usages this absorbed bucket alone carried. */
  readonly usageCount: number;
};

export type PaletteEntry = {
  /**
   * Canonical key — the `colorKey()` of the representative bucket
   * (most-used colour in the merged group). Used as the record key in
   * `decisions.palette` and as the stable identifier across runs.
   */
  readonly key: string;
  /** Hex string, alpha included only when < 1. */
  readonly hex: string;
  readonly color: ColorRGBA;
  readonly usages: readonly PaintUsageRecord[];
  /**
   * Fine-grain buckets absorbed into this entry by the perceptual
   * merge pass. Empty when the entry represents a single bucket.
   */
  readonly aliases: readonly PaletteAliasRecord[];
  /** GUID of an existing FILL-style styleDefinition whose paint matches, if any. */
  readonly existingStyleDefinitionGuid: string | undefined;
  readonly existingStyleDefinitionName: string | undefined;
};

export type TypographyDescriptorRecord = {
  readonly fontFamily: string;
  readonly fontStyle: string;
  readonly fontWeight: number;
  readonly fontSize: number;
  /** Canonical line-height key (empty when not set). */
  readonly lineHeightKey: string;
  /** Canonical letter-spacing key (empty when not set). */
  readonly letterSpacingKey: string;
};

export type TypographyUsageRecord = {
  readonly nodeGuid: string;
  readonly nodeName: string;
  /** Trimmed, length-clamped sample of the rendered text. */
  readonly characters: string;
  readonly characterCount: number;
};

export type TypographyAliasRecord = {
  /** Stable key over the absorbed descriptor. */
  readonly key: string;
  readonly descriptor: TypographyDescriptorRecord;
  readonly usageCount: number;
  /**
   * Names of TypographyDescriptorRecord fields that differ from the
   * primary entry. Reading "lineHeightKey" or "letterSpacingKey" here
   * is the agent's cue that the alias is most likely a stray typo.
   */
  readonly differingFields: readonly string[];
};

export type TypographyEntry = {
  /** Stable key over the descriptor (joined with `|`). */
  readonly key: string;
  readonly descriptor: TypographyDescriptorRecord;
  readonly usages: readonly TypographyUsageRecord[];
  /**
   * Near-duplicate descriptors absorbed into this entry by the
   * analyser. Family / style / weight / size match the primary; line-
   * height or letter-spacing differ. Empty when no near-duplicate was
   * seen. Use `decisions.typography[aliasKey].merge = primaryKey` to
   * redirect bind actions away from the alias.
   */
  readonly aliases: readonly TypographyAliasRecord[];
  /** GUID of an existing TEXT-style styleDefinition whose descriptor matches, if any. */
  readonly existingStyleDefinitionGuid: string | undefined;
  readonly existingStyleDefinitionName: string | undefined;
};

export type StructureMemberRecord = {
  readonly nodeGuid: string;
  readonly nodeName: string;
  readonly width: number;
  readonly height: number;
  readonly aHash: string;
  readonly dHash: string;
};

export type StructureClusterEntry = {
  /** Stable cluster id (role-signature × size class). */
  readonly clusterId: string;
  readonly roleSignature: string;
  readonly structuralSignature: string;
  /** Average width and height across members. */
  readonly sizeClass: { readonly width: number; readonly height: number };
  readonly members: readonly StructureMemberRecord[];
};

/**
 * Auto-layout inference for a single FRAME. Surfaced as a hint the
 * agent must opt into via `decisions.layouts[nodeGuid].apply = true`;
 * the analyser never adopts a hint automatically.
 */
export type LayoutHintRecord = {
  readonly nodeGuid: string;
  readonly layoutMode: "HORIZONTAL" | "VERTICAL";
  readonly itemSpacing: number;
  readonly paddingTop: number;
  readonly paddingRight: number;
  readonly paddingBottom: number;
  readonly paddingLeft: number;
  /**
   * Cross-axis alignment recognised by the inferrer: MIN (top/left),
   * CENTER, or MAX (bottom/right). Apply writes this as Figma's
   * `stackCounterAlignItems`.
   */
  readonly counterAxisAlign: "MIN" | "CENTER" | "MAX";
  readonly childCount: number;
};

export type GeometryClusterMemberRecord = {
  readonly nodeGuid: string;
  readonly nodeName: string;
  readonly parentGuid: string | undefined;
  readonly width: number;
  readonly height: number;
};

export type GeometryClusterEntry = {
  /** Stable cluster id (e.g. `vec-<12hex>`). Hash of the fingerprint. */
  readonly clusterId: string;
  readonly width: number;
  readonly height: number;
  readonly members: readonly GeometryClusterMemberRecord[];
};

export type Inventory = {
  readonly palette: readonly PaletteEntry[];
  readonly typography: readonly TypographyEntry[];
  readonly structureClusters: readonly StructureClusterEntry[];
  /**
   * Strict-byte VECTOR groups: nodes that share the exact commands
   * blob, integer size, paint stack, and stroke parameters. The agent
   * may promote them into one SYMBOL + N INSTANCEs via
   * `decisions.geometryClusters[id] = { name }`.
   */
  readonly geometryClusters: readonly GeometryClusterEntry[];
  /** Structures that could not be rendered (e.g. missing OS font). */
  readonly unrenderable: readonly { readonly nodeGuid: string; readonly nodeName: string; readonly reason: string }[];
  /**
   * Auto-layout candidates the inferrer recognised with high
   * confidence. Empty array when no FRAME in the file matched the
   * fail-fast gates (uniform single-axis stack with consistent
   * cross-axis size and uniform inter-child gaps).
   */
  readonly layoutHints: readonly LayoutHintRecord[];
};
