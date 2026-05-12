/**
 * @file `buildInventory` — produce structural facts about a refine
 * source.
 *
 * Inventory is the read-only ground truth the agent reviews and the
 * plan layer consumes. Naming, thresholds, and "is this worth
 * promoting" judgements happen in the agent-authored Decisions JSON
 * downstream — not here.
 *
 * Three sub-inventories are emitted in one pass:
 *
 *   - palette: every visible SOLID paint, with bind-eligibility
 *     pre-computed per usage so the plan layer cannot propose a
 *     binding that would erase an IMAGE / GRADIENT layer.
 *   - typography: every distinct (family, style, size, line-height,
 *     letter-spacing) descriptor with its TEXT usages.
 *   - subtreeClusters: visually-confirmed clusters of repeated
 *     subtrees, bucketed by role signature × size class.
 *
 * The duplicate detector renders each candidate; an in-process
 * `NodeRenderer` is created here and torn down when the call returns.
 */
import type { RefineSource } from "../refine-source/load";
import { analysePalette, bindablePaintsFor } from "../analysis/palette";
import { analyseTypography } from "../analysis/text-styles";
import { detectDuplicates } from "../analysis/duplicate-clusters";
import { detectGeometryClusters } from "../analysis/geometry-clusters";
import { inferLayouts } from "../analysis/layout-inference";
import { createNodeRenderer } from "../visual";
import type {
  Inventory,
  PaletteEntry,
  PaintUsageRecord,
  TypographyEntry,
  SubtreeClusterEntry,
  SubtreeMemberRecord,
  LayoutHintRecord,
  GeometryClusterEntry,
} from "./types";

export type BuildInventoryOptions = {
  /** Path of the input .fig — passed for diagnostic context only. */
  readonly figPath: string;
  /** Skip the duplicate detector (which renders every candidate). */
  readonly skipClusters?: boolean;
};

/** Walk the resolved source tree and assemble the inventory. */
export async function buildInventory(
  source: RefineSource,
  options: BuildInventoryOptions,
): Promise<Inventory> {
  const palette = collectPalette(source);
  const typography = collectTypography(source);
  const layoutHints = collectLayoutHints(source);
  const geometryClusters = collectGeometryClusters(source);
  if (options.skipClusters) {
    return { palette, typography, subtreeClusters: [], geometryClusters, unrenderable: [], layoutHints };
  }
  // `RefineSource` extends `FigSymbolContext`, so we can pass the
  // source itself — no need to pluck out individual fields.
  const renderer = createNodeRenderer(source);
  const dup = await detectDuplicates(source.topFrames, renderer);
  const subtreeClusters: SubtreeClusterEntry[] = dup.clusters.map((c) => ({
    clusterId: c.clusterId,
    roleSignature: c.roleSignature,
    structuralSignature: c.structuralSignature,
    sizeClass: c.sizeClass,
    members: c.members.map((m): SubtreeMemberRecord => ({
      nodeGuid: m.nodeGuid,
      nodeName: m.nodeName,
      width: m.width,
      height: m.height,
      aHash: m.hash.aHash,
      dHash: m.hash.dHash,
    })),
  }));
  return {
    palette,
    typography,
    subtreeClusters,
    geometryClusters,
    unrenderable: dup.unrenderable.map((u) => ({
      nodeGuid: u.nodeGuid,
      nodeName: u.nodeName,
      reason: u.reason,
    })),
    layoutHints,
  };
}

function collectGeometryClusters(source: RefineSource): readonly GeometryClusterEntry[] {
  const analysis = detectGeometryClusters(source.loaded, source.userCanvases);
  return analysis.clusters.map((c) => ({
    clusterId: c.clusterId,
    width: c.width,
    height: c.height,
    members: c.members.map((m) => ({
      nodeGuid: m.nodeGuid,
      nodeName: m.nodeName,
      parentGuid: m.parentGuid,
      width: m.width,
      height: m.height,
    })),
  }));
}

function collectLayoutHints(source: RefineSource): readonly LayoutHintRecord[] {
  // Walk the visible user canvases for FRAMEs whose children form a
  // uniform single-axis stack. The cluster analyser already excludes
  // the Internal Only Canvas; auto-layout has the same scope.
  return inferLayouts(source.userCanvases).map((h) => ({
    nodeGuid: h.nodeGuid,
    layoutMode: h.layoutMode,
    itemSpacing: h.itemSpacing,
    paddingTop: h.paddingTop,
    paddingRight: h.paddingRight,
    paddingBottom: h.paddingBottom,
    paddingLeft: h.paddingLeft,
    counterAxisAlign: h.counterAxisAlign,
    childCount: h.childCount,
  }));
}

function collectPalette(source: RefineSource): readonly PaletteEntry[] {
  const palette = analysePalette(source.topFrames, source.fillStyleProxies);
  return palette.entries.map((entry): PaletteEntry => {
    const usages: PaintUsageRecord[] = entry.usages.map((u) => {
      const node = source.nodesByGuid.get(u.nodeGuid);
      const eligible = node ? Boolean(bindablePaintsFor(node, u.role)) : false;
      return {
        nodeGuid: u.nodeGuid,
        nodeName: u.nodeName,
        nodeType: u.nodeType,
        role: u.role,
        paintIndex: u.paintIndex,
        bindEligible: eligible,
      };
    });
    return {
      key: entry.key,
      hex: entry.hex,
      color: entry.color,
      usages,
      aliases: entry.aliases.map((a) => ({
        key: a.key,
        color: a.color,
        hex: a.hex,
        usageCount: a.usageCount,
      })),
      existingProxyGuid: entry.proxyGuid,
      existingProxyName: entry.proxyName,
    };
  });
}

function collectTypography(source: RefineSource): readonly TypographyEntry[] {
  const typography = analyseTypography(source.topFrames, source.textStyleProxies);
  return typography.clusters.map((c): TypographyEntry => ({
    key: c.key,
    descriptor: {
      fontFamily: c.descriptor.fontFamily,
      fontStyle: c.descriptor.fontStyle,
      fontWeight: c.descriptor.fontWeight,
      fontSize: c.descriptor.fontSize,
      lineHeightKey: c.descriptor.lineHeightKey,
      letterSpacingKey: c.descriptor.letterSpacingKey,
    },
    usages: c.usages.map((u) => ({
      nodeGuid: u.nodeGuid,
      nodeName: u.nodeName,
      characters: u.characters,
      characterCount: u.characterCount,
    })),
    aliases: c.aliases.map((a) => ({
      key: a.key,
      descriptor: {
        fontFamily: a.descriptor.fontFamily,
        fontStyle: a.descriptor.fontStyle,
        fontWeight: a.descriptor.fontWeight,
        fontSize: a.descriptor.fontSize,
        lineHeightKey: a.descriptor.lineHeightKey,
        letterSpacingKey: a.descriptor.letterSpacingKey,
      },
      usageCount: a.usageCount,
      differingFields: a.differingFields.map(String),
    })),
    existingProxyGuid: c.proxyGuid,
    existingProxyName: c.proxyName,
  }));
}
