/**
 * @file `buildPlan` — combine the analysis primitives into a single
 * `RefinePlan` ready for review or apply.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { guidToString, safeChildren } from "@higma-document-models/fig/domain";
import type { RefineSource } from "../refine-source/load";
import type {
  RefinePlan,
  RenameAction,
  FillStyleBindAction,
  FillStyleProposal,
  TextStyleProposal,
  TypographyClusterRecord,
  ComponentCandidate,
} from "./types";
import { analysePalette } from "../analysis/palette";
import { bindablePaintsFor } from "../analysis/palette";
import { analyseTypography } from "../analysis/text-styles";
import { proposeRenames } from "../analysis/naming";
import { detectDuplicates } from "../analysis/duplicate-clusters";
import type { NodeRenderer } from "../visual/render-node";

export type BuildPlanOptions = {
  readonly file: string;
  readonly bytes: number;
  /** When true, skip duplicate-cluster detection (no rendering). Default false. */
  readonly skipDuplicateDetection?: boolean;
  /** Minimum number of bindings for a colour to deserve a new proxy. Default 4. */
  readonly minColorBindings?: number;
  /** Minimum number of bindings for a typography cluster to be promoted. Default 3. */
  readonly minTextStyleBindings?: number;
};

function countNodes(roots: readonly FigNode[]): number {
  return roots.reduce((acc, r) => acc + countNodesIn(r), 0);
}

function countNodesIn(node: FigNode): number {
  return 1 + safeChildren(node).reduce((acc, c) => acc + countNodesIn(c), 0);
}

/**
 * Build a refinement plan.
 *
 * `renderer` is required when `skipDuplicateDetection` is false (the
 * default) — duplicate detection requires the visual stage.
 */
export async function buildPlan(
  source: RefineSource,
  renderer: NodeRenderer | undefined,
  options: BuildPlanOptions,
): Promise<RefinePlan> {
  const minColorBindings = options.minColorBindings ?? 4;
  const minTextStyleBindings = options.minTextStyleBindings ?? 3;

  const palette = analysePalette(source.topFrames, source.fillStyleProxies);
  const typography = analyseTypography(source.topFrames, source.textStyleProxies);
  const renames = proposeRenames(source.topFrames);

  // Fill style bindings — when an existing proxy already covers the
  // colour AND the node's fill stack is safely substitutable. We only
  // bind nodes whose fill stack is exactly one visible SOLID paint
  // with default blend; image-over-solid and gradient-over-solid
  // stacks would lose their non-solid layer if styleIdForFill pointed
  // at a flat proxy, so they're excluded by `bindablePaintsFor`.
  const fillStyleBindings: FillStyleBindAction[] = [];
  for (const entry of palette.entries) {
    if (!entry.proxyGuid) {
      continue;
    }
    for (const usage of entry.usages) {
      if (usage.role !== "fill") {
        // Stroke / background bindings would require styleIdForStrokeFill; we keep v1
        // restricted to fill-fill bindings to avoid overwriting nodes whose strokes
        // happen to share a colour with a fill style proxy.
        continue;
      }
      const node = source.nodesByGuid.get(usage.nodeGuid);
      if (!node) {
        continue;
      }
      if (!bindablePaintsFor(node, "fill")) {
        // Multi-paint / image / gradient stack — not safely substitutable.
        continue;
      }
      fillStyleBindings.push({
        kind: "fill-style-bind",
        nodeGuid: usage.nodeGuid,
        nodeName: usage.nodeName,
        proxyGuid: entry.proxyGuid,
        proxyName: entry.proxyName ?? entry.suggestedSlug,
        colorHex: entry.hex,
      });
    }
  }

  // Fill style proposals — colours used heavily but without a proxy yet.
  const usedSlugs = new Set<string>(
    source.fillStyleProxies
      .map((p) => (p.name ?? "").trim().toLowerCase())
      .filter((s): s is string => Boolean(s)),
  );
  const fillStyleProposals: FillStyleProposal[] = [];
  for (const entry of palette.entries) {
    if (entry.proxyGuid) {
      continue;
    }
    const fillUsages = entry.usages.filter((u) => u.role === "fill");
    if (fillUsages.length < minColorBindings) {
      continue;
    }
    const slug = uniqueSlug(entry.suggestedSlug, usedSlugs);
    usedSlugs.add(slug.toLowerCase());
    fillStyleProposals.push({
      kind: "fill-style-create",
      slug,
      suggestedName: humanizeName(slug),
      role: entry.suggestedRole,
      colorHex: entry.hex,
      color: { r: entry.color.r, g: entry.color.g, b: entry.color.b, a: entry.color.a },
      bindings: fillUsages.map((u) => ({
        nodeGuid: u.nodeGuid,
        nodeName: u.nodeName,
        nodeType: u.nodeType,
        role: u.role,
      })),
    });
  }

  const usedTextSlugs = new Set<string>(
    source.textStyleProxies
      .map((p) => (p.name ?? "").trim().toLowerCase())
      .filter((s): s is string => Boolean(s)),
  );
  const textStyleProposals: TextStyleProposal[] = [];
  for (const cluster of typography.clusters) {
    if (cluster.proxyGuid) {
      continue;
    }
    if (cluster.usages.length < minTextStyleBindings) {
      continue;
    }
    const slug = uniqueSlug(cluster.suggestedSlug, usedTextSlugs);
    usedTextSlugs.add(slug.toLowerCase());
    textStyleProposals.push({
      kind: "text-style-create",
      slug,
      suggestedName: humanizeName(slug),
      role: cluster.suggestedRole,
      descriptor: {
        fontFamily: cluster.descriptor.fontFamily,
        fontStyle: cluster.descriptor.fontStyle,
        fontWeight: cluster.descriptor.fontWeight,
        fontSize: cluster.descriptor.fontSize,
        lineHeightKey: cluster.descriptor.lineHeightKey,
        letterSpacingKey: cluster.descriptor.letterSpacingKey,
      },
      bindings: cluster.usages.map((u) => ({ nodeGuid: u.nodeGuid, nodeName: u.nodeName })),
    });
  }

  const dup = await buildComponentCandidates(source.topFrames, renderer, options.skipDuplicateDetection ?? false);

  const renameActions: RenameAction[] = renames.map((r) => ({
    kind: "rename",
    nodeGuid: r.nodeGuid,
    oldName: r.currentName,
    newName: r.suggestedName,
    reason: r.reason,
  }));

  const refinedRenames = dedupeSiblingRenames(renameActions, source);

  return {
    source: {
      file: options.file,
      bytes: options.bytes,
      canvases: source.userCanvases.map((c) => c.name ?? "(unnamed)"),
      topFrameCount: source.topFrames.length,
      nodeCount: countNodes(source.topFrames),
    },
    renames: refinedRenames,
    fillStyleBindings,
    fillStyleProposals,
    textStyleProposals,
    typographyClusters: typography.clusters.map((c): TypographyClusterRecord => ({
      fontFamily: c.descriptor.fontFamily,
      fontStyle: c.descriptor.fontStyle,
      fontWeight: c.descriptor.fontWeight,
      fontSize: c.descriptor.fontSize,
      lineHeightKey: c.descriptor.lineHeightKey,
      letterSpacingKey: c.descriptor.letterSpacingKey,
      usageCount: c.usages.length,
    })),
    componentCandidates: dup.candidates,
    stats: {
      paletteEntries: palette.entries.length,
      typographyClusters: typography.clusters.length,
      duplicateClusters: dup.candidates.length,
      unrenderableSubtrees: dup.unrenderable,
    },
  };
}

type ComponentDuplicateOutput = {
  readonly candidates: readonly ComponentCandidate[];
  readonly unrenderable: number;
};

async function buildComponentCandidates(
  frames: readonly FigNode[],
  renderer: NodeRenderer | undefined,
  skip: boolean,
): Promise<ComponentDuplicateOutput> {
  if (skip) {
    return { candidates: [], unrenderable: 0 };
  }
  if (!renderer) {
    throw new Error("buildPlan: renderer is required when skipDuplicateDetection=false");
  }
  const duplicates = await detectDuplicates(frames, renderer);
  const candidates = duplicates.clusters.map((c): ComponentCandidate => ({
    kind: "component-candidate",
    clusterId: c.clusterId,
    suggestedName: c.suggestedName,
    roleSignature: c.roleSignature,
    sizeClass: c.sizeClass,
    memberGuids: c.members.map((m) => m.nodeGuid),
    applied: false,
  }));
  return { candidates, unrenderable: duplicates.unrenderable.length };
}

function uniqueSlug(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base.toLowerCase())) {
    return base;
  }
  return uniqueSlugWithSuffix(base, 2, used);
}

function uniqueSlugWithSuffix(base: string, n: number, used: ReadonlySet<string>): string {
  const candidate = `${base}-${n}`;
  if (!used.has(candidate.toLowerCase())) {
    return candidate;
  }
  return uniqueSlugWithSuffix(base, n + 1, used);
}

function uniqueSiblingName(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base.toLowerCase())) {
    return base;
  }
  return uniqueSlugWithSuffix(base, 2, used);
}

function humanizeName(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.length === 0 ? part : part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * When two siblings get the same suggested name, append `-2`, `-3`,
 * etc. so the final tree is unambiguous. Done by walking the source
 * tree and applying suggestions per parent.
 */
function dedupeSiblingRenames(actions: readonly RenameAction[], source: RefineSource): RenameAction[] {
  const byGuid = new Map<string, RenameAction>();
  for (const a of actions) {
    byGuid.set(a.nodeGuid, a);
  }
  const adjusted = new Map<string, string>();
  for (const frame of source.topFrames) {
    walk(frame);
  }
  function walk(node: FigNode): void {
    const usedNames = new Set<string>();
    // Existing sibling names that we are NOT renaming still occupy slots.
    for (const child of safeChildren(node)) {
      const guid = guidToString(child.guid);
      const action = byGuid.get(guid);
      if (!action) {
        if (child.name) {
          usedNames.add(child.name.toLowerCase());
        }
      }
    }
    for (const child of safeChildren(node)) {
      const guid = guidToString(child.guid);
      const action = byGuid.get(guid);
      if (action) {
        const candidate = uniqueSiblingName(action.newName, usedNames);
        adjusted.set(guid, candidate);
        usedNames.add(candidate.toLowerCase());
      }
      walk(child);
    }
  }
  return actions.map((a) => ({ ...a, newName: adjusted.get(a.nodeGuid) ?? a.newName }));
}
