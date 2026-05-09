/**
 * @file `RefinePlan` data shape.
 *
 * A plan is a serialisable JSON structure (everything is plain
 * objects + arrays of strings/numbers/booleans). It is produced by
 * `buildPlan(source)` and consumed by `applyPlan(loaded, plan)`.
 *
 * The plan is intentionally explicit: every action lists the exact
 * GUIDs it will touch and the values it will write. There is no
 * inference at apply time. This matches the project-wide fail-fast
 * stance — if the analysis stage missed something, the apply stage
 * is the wrong place to discover it.
 */
import type { TextStyleRole } from "../analysis/text-styles";
import type { SuggestedRole } from "../analysis/palette";

export type RenameAction = {
  readonly kind: "rename";
  readonly nodeGuid: string;
  readonly oldName: string;
  readonly newName: string;
  readonly reason: string;
};

export type FillStyleBindAction = {
  readonly kind: "fill-style-bind";
  readonly nodeGuid: string;
  readonly nodeName: string;
  readonly proxyGuid: string;
  readonly proxyName: string;
  readonly colorHex: string;
};

export type FillStyleProposal = {
  readonly kind: "fill-style-create";
  /** Stable proxy slug — collisions resolved via the applier. */
  readonly slug: string;
  readonly suggestedName: string;
  readonly role: SuggestedRole;
  readonly colorHex: string;
  readonly color: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
  /** Nodes that should bind to the new proxy after creation. */
  readonly bindings: readonly { readonly nodeGuid: string; readonly nodeName: string; readonly nodeType: string; readonly role: "fill" | "stroke" | "background" }[];
};

export type TextStyleProposal = {
  readonly kind: "text-style-create";
  readonly slug: string;
  readonly suggestedName: string;
  readonly role: TextStyleRole;
  readonly descriptor: {
    readonly fontFamily: string;
    readonly fontStyle: string;
    readonly fontWeight: number;
    readonly fontSize: number;
    readonly lineHeightKey: string;
    readonly letterSpacingKey: string;
  };
  readonly bindings: readonly { readonly nodeGuid: string; readonly nodeName: string }[];
};

/**
 * Slim, serialisable record of a typography cluster (one unique
 * (family, style, fontSize, lineHeight, letterSpacing) tuple). Every
 * cluster the analyser found is included — both the ones promoted to
 * `textStyleProposals` and the ones that did not meet the binding
 * threshold — so consumers (e.g. the summary writer or a host-font
 * pre-check) read a single SoT instead of re-walking the document.
 */
export type TypographyClusterRecord = {
  readonly fontFamily: string;
  readonly fontStyle: string;
  readonly fontWeight: number;
  readonly fontSize: number;
  readonly lineHeightKey: string;
  readonly letterSpacingKey: string;
  readonly usageCount: number;
};

export type ComponentCandidate = {
  readonly kind: "component-candidate";
  readonly clusterId: string;
  readonly suggestedName: string;
  readonly roleSignature: string;
  readonly sizeClass: { readonly width: number; readonly height: number };
  readonly memberGuids: readonly string[];
  /** v1 does not auto-componentise — this is reported only. */
  readonly applied: false;
};

export type RefinePlan = {
  readonly source: {
    readonly file: string;
    readonly bytes: number;
    readonly canvases: readonly string[];
    readonly topFrameCount: number;
    readonly nodeCount: number;
  };
  readonly renames: readonly RenameAction[];
  readonly fillStyleBindings: readonly FillStyleBindAction[];
  readonly fillStyleProposals: readonly FillStyleProposal[];
  readonly textStyleProposals: readonly TextStyleProposal[];
  /** Every typography cluster found, regardless of whether it became a proposal. */
  readonly typographyClusters: readonly TypographyClusterRecord[];
  readonly componentCandidates: readonly ComponentCandidate[];
  readonly stats: {
    readonly paletteEntries: number;
    readonly typographyClusters: number;
    readonly duplicateClusters: number;
    /** Subtrees the renderer rejected during duplicate detection (e.g. missing fonts on this OS). */
    readonly unrenderableSubtrees: number;
  };
};
