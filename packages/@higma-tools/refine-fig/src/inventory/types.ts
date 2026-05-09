/**
 * @file `Inventory` data shape — strictly *facts* observed in the
 * source `.fig` file.
 *
 * Inventory makes no naming choices, applies no thresholds, and emits
 * no proposals. It walks the resolved tree, groups what it sees by
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
 *   - `subtreeClusters[]` — every group of ≥ 2 visually-similar
 *                            subtrees the detector found. Members are
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
   * rebind to a single-SOLID style proxy. Multi-paint stacks
   * (image-over-solid etc.) are flagged false so the plan layer
   * never proposes a binding for them.
   */
  readonly bindEligible: boolean;
};

export type PaletteEntry = {
  /** 3-decimal canonical key matching `colorKey()` from analysis/palette. */
  readonly key: string;
  /** Hex string, alpha included only when < 1. */
  readonly hex: string;
  readonly color: ColorRGBA;
  readonly usages: readonly PaintUsageRecord[];
  /** GUID of an existing FILL-style proxy whose paint matches, if any. */
  readonly existingProxyGuid: string | undefined;
  readonly existingProxyName: string | undefined;
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

export type TypographyEntry = {
  /** Stable key over the descriptor (joined with `|`). */
  readonly key: string;
  readonly descriptor: TypographyDescriptorRecord;
  readonly usages: readonly TypographyUsageRecord[];
  /** GUID of an existing TEXT-style proxy whose descriptor matches, if any. */
  readonly existingProxyGuid: string | undefined;
  readonly existingProxyName: string | undefined;
};

export type SubtreeMemberRecord = {
  readonly nodeGuid: string;
  readonly nodeName: string;
  readonly width: number;
  readonly height: number;
  readonly aHash: string;
  readonly dHash: string;
};

export type SubtreeClusterEntry = {
  /** Stable cluster id (role-signature × size class). */
  readonly clusterId: string;
  readonly roleSignature: string;
  readonly structuralSignature: string;
  /** Average width and height across members. */
  readonly sizeClass: { readonly width: number; readonly height: number };
  readonly members: readonly SubtreeMemberRecord[];
};

export type Inventory = {
  readonly palette: readonly PaletteEntry[];
  readonly typography: readonly TypographyEntry[];
  readonly subtreeClusters: readonly SubtreeClusterEntry[];
  /** Subtrees that could not be rendered (e.g. missing OS font). */
  readonly unrenderable: readonly { readonly nodeGuid: string; readonly nodeName: string; readonly reason: string }[];
};
