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
import { createNodeRenderer } from "../visual";
import type {
  Inventory,
  PaletteEntry,
  PaintUsageRecord,
  TypographyEntry,
  SubtreeClusterEntry,
  SubtreeMemberRecord,
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
  if (options.skipClusters) {
    return { palette, typography, subtreeClusters: [], unrenderable: [] };
  }
  const renderer = createNodeRenderer({ loaded: source.loaded, symbolMap: source.nodesByGuid });
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
    unrenderable: dup.unrenderable.map((u) => ({
      nodeGuid: u.nodeGuid,
      nodeName: u.nodeName,
      reason: u.reason,
    })),
  };
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
    existingProxyGuid: c.proxyGuid,
    existingProxyName: c.proxyName,
  }));
}
