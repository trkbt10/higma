/**
 * @file Typography analysis.
 *
 * Walks every TEXT node in the user-visible canvases and clusters
 * unique (family, style, fontSize, lineHeight, letterSpacing) tuples.
 * For each cluster we infer a semantic role (display / heading-N /
 * body / caption / button / overline) from font size, weight, and
 * casing, then propose a stable slug.
 *
 * The cluster keys match fig-to-web's typography token logic so the
 * skill's proposals stay aligned with the eventual CSS export.
 *
 * `existingTextProxies` is the list of `styleType.name === "TEXT"`
 * children of the Internal Only Canvas. When a cluster's descriptor
 * exactly matches a proxy, the cluster is marked already-themed and
 * gets bound rather than newly proposed.
 */
import type { FigNode, FigValueWithUnits } from "@higma-document-models/fig/types";
import { getNodeType, guidToString, safeChildren } from "@higma-document-models/fig/domain";
import { figmaFontToQuery } from "@higma-document-models/fig/font";

/**
 * Numeric weight for a Figma fontName.style string. Routes through the
 * canonical `figmaFontToQuery` SoT so this analysis layer's clusters
 * key on the same numeric weight every other consumer (token emit,
 * scene-graph, run resolver) sees.
 */
function styleToWeight(family: string, style: string): number {
  return figmaFontToQuery({ family, style }).weight;
}

function valueWithUnitsKey(v: FigValueWithUnits | undefined): string {
  if (!v) {
    return "";
  }
  return `${v.value.toFixed(3)}${v.units.name}`;
}

export type TypographyDescriptor = {
  readonly fontFamily: string;
  readonly fontStyle: string;
  readonly fontWeight: number;
  readonly fontSize: number;
  readonly lineHeightKey: string;
  readonly letterSpacingKey: string;
};

export type TypographyUsage = {
  readonly nodeGuid: string;
  readonly nodeName: string;
  readonly characters: string;
  readonly characterCount: number;
};

export type TextStyleRole =
  | "display"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "title"
  | "subtitle"
  | "body"
  | "body-strong"
  | "body-small"
  | "caption"
  | "overline"
  | "button"
  | "label";

export type TypographyAlias = {
  /** `descriptorKey()` of the absorbed entry. */
  readonly key: string;
  readonly descriptor: TypographyDescriptor;
  readonly usageCount: number;
  /** Names of TypographyDescriptor fields that differ from the primary. */
  readonly differingFields: readonly (keyof TypographyDescriptor)[];
};

export type TypographyCluster = {
  readonly key: string;
  readonly descriptor: TypographyDescriptor;
  readonly usages: readonly TypographyUsage[];
  /**
   * Near-duplicate entries (same family / style / weight / size but
   * differing in lineHeight or letterSpacing) absorbed into this
   * cluster's surface so the agent sees them grouped. The clusters
   * themselves stay distinct — the agent decides via
   * `decisions.typography[key].merge` whether to redirect bind actions.
   */
  readonly aliases: readonly TypographyAlias[];
  /** Existing TEXT proxy whose properties match, if any. */
  readonly proxyGuid: string | undefined;
  readonly proxyName: string | undefined;
  readonly suggestedRole: TextStyleRole;
  readonly suggestedSlug: string;
};

export type TypographyAnalysis = {
  readonly clusters: readonly TypographyCluster[];
};

function descriptorKey(d: TypographyDescriptor): string {
  return [d.fontFamily, d.fontStyle, d.fontSize, d.lineHeightKey, d.letterSpacingKey].join("|");
}

function describe(node: FigNode): TypographyDescriptor | undefined {
  const fontName = node.fontName;
  const fontSize = typeof node.fontSize === "number" ? node.fontSize : undefined;
  if (!fontName || fontSize === undefined) {
    return undefined;
  }
  return {
    fontFamily: fontName.family,
    fontStyle: fontName.style,
    fontWeight: styleToWeight(fontName.family, fontName.style),
    fontSize,
    lineHeightKey: valueWithUnitsKey(node.lineHeight),
    letterSpacingKey: valueWithUnitsKey(node.letterSpacing),
  };
}

function isAllUpper(text: string): boolean {
  const alpha = [...text].filter((ch) => /[A-Za-z]/.test(ch));
  if (alpha.length < 3) {
    return false;
  }
  const upperCount = alpha.filter((ch) => ch === ch.toUpperCase() && ch !== ch.toLowerCase()).length;
  return upperCount / alpha.length >= 0.85;
}

function suggestRole(d: TypographyDescriptor, sampleText: string): TextStyleRole {
  const allUpper = isAllUpper(sampleText);
  const heavy = d.fontWeight >= 600;
  if (allUpper && d.fontSize <= 14) {
    return "overline";
  }
  if (d.fontSize >= 48) {
    return "display";
  }
  if (d.fontSize >= 32) {
    return "heading-1";
  }
  if (d.fontSize >= 24) {
    return "heading-2";
  }
  if (d.fontSize >= 20) {
    return "heading-3";
  }
  if (d.fontSize >= 18) {
    return "heading-4";
  }
  if (d.fontSize >= 16) {
    if (heavy) {
      return "title";
    }
    return "body";
  }
  if (d.fontSize >= 14) {
    if (heavy) {
      return "body-strong";
    }
    return "body";
  }
  if (d.fontSize >= 12) {
    if (heavy) {
      return "label";
    }
    return "body-small";
  }
  if (d.fontSize >= 10) {
    return "caption";
  }
  return "label";
}

const ROLE_BASE_SLUG: Readonly<Record<TextStyleRole, string>> = {
  display: "display",
  "heading-1": "heading-1",
  "heading-2": "heading-2",
  "heading-3": "heading-3",
  "heading-4": "heading-4",
  title: "title",
  subtitle: "subtitle",
  body: "body",
  "body-strong": "body-strong",
  "body-small": "body-small",
  caption: "caption",
  overline: "overline",
  button: "button",
  label: "label",
};

function clamp(s: string): string {
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

function visit(node: FigNode, out: Map<string, TypographyCluster & { usages: TypographyUsage[] }>): void {
  if (getNodeType(node) === "TEXT") {
    const desc = describe(node);
    if (desc) {
      const key = descriptorKey(desc);
      const usage: TypographyUsage = {
        nodeGuid: guidToString(node.guid),
        nodeName: node.name ?? "(unnamed)",
        characters: clamp(node.characters ?? ""),
        characterCount: (node.characters ?? "").length,
      };
      const existing = out.get(key);
      if (existing) {
        existing.usages.push(usage);
      } else {
        out.set(key, {
          key,
          descriptor: desc,
          usages: [usage],
          proxyGuid: undefined,
          proxyName: undefined,
          aliases: [],
          // Resolved post-collection.
          suggestedRole: "body",
          suggestedSlug: "body",
        });
      }
    }
  }
  for (const child of safeChildren(node)) {
    visit(child, out);
  }
}

function buildProxyIndex(proxies: readonly FigNode[]): ReadonlyMap<string, FigNode> {
  const out = new Map<string, FigNode>();
  for (const proxy of proxies) {
    const desc = describe(proxy);
    if (!desc) {
      continue;
    }
    out.set(descriptorKey(desc), proxy);
  }
  return out;
}

type AliasLink = {
  readonly primary: string;
  readonly differingFields: readonly (keyof TypographyDescriptor)[];
};

type ClusterEntry = TypographyCluster & { usages: TypographyUsage[] };

function findPrimaryFor(
  candidate: ClusterEntry,
  candidates: readonly ClusterEntry[],
  upToIdx: number,
  aliasOf: ReadonlyMap<string, AliasLink>,
): AliasLink | undefined {
  return candidates
    .slice(0, upToIdx)
    .filter((primary) => !aliasOf.has(primary.key))
    .reduce<AliasLink | undefined>((found, primary) => {
      if (found) {
        return found;
      }
      const fields = diffDescriptors(primary.descriptor, candidate.descriptor);
      if (fields.length === 0) {
        return undefined;
      }
      return { primary: primary.key, differingFields: fields };
    }, undefined);
}

function assignAliases(sorted: readonly ClusterEntry[]): ReadonlyMap<string, AliasLink> {
  return sorted.reduce<Map<string, AliasLink>>((aliasOf, candidate, idx) => {
    if (idx === 0) {
      return aliasOf;
    }
    const link = findPrimaryFor(candidate, sorted, idx, aliasOf);
    if (link) {
      aliasOf.set(candidate.key, link);
    }
    return aliasOf;
  }, new Map<string, AliasLink>());
}

/**
 * Two descriptors are near-duplicate iff family + style + weight +
 * size agree and at least one of lineHeight / letterSpacing differs.
 * Returns the list of differing fields, empty when not a candidate.
 */
function diffDescriptors(
  a: TypographyDescriptor,
  b: TypographyDescriptor,
): readonly (keyof TypographyDescriptor)[] {
  if (a.fontFamily !== b.fontFamily) {
    return [];
  }
  if (a.fontStyle !== b.fontStyle) {
    return [];
  }
  if (a.fontWeight !== b.fontWeight) {
    return [];
  }
  if (a.fontSize !== b.fontSize) {
    return [];
  }
  const out: (keyof TypographyDescriptor)[] = [];
  if (a.lineHeightKey !== b.lineHeightKey) {
    out.push("lineHeightKey");
  }
  if (a.letterSpacingKey !== b.letterSpacingKey) {
    out.push("letterSpacingKey");
  }
  return out;
}

/** Walk frames, cluster typography, and label each cluster with a role + slug. */
export function analyseTypography(
  frames: readonly FigNode[],
  textProxies: readonly FigNode[],
): TypographyAnalysis {
  const collected = new Map<string, TypographyCluster & { usages: TypographyUsage[] }>();
  for (const frame of frames) {
    visit(frame, collected);
  }
  const proxyIndex = buildProxyIndex(textProxies);
  const sorted = [...collected.values()].sort((a, b) => b.usages.length - a.usages.length);

  // Alias assignment: walk in descending usage-count order. The most-
  // used cluster of a family becomes the primary; later cousins (same
  // family / style / weight / size, differing line-height or
  // letter-spacing) attach to it as aliases. Distinct families / sizes
  // never alias — `diffDescriptors` returns empty there. Alias chains
  // are at most one level deep: a primary cannot itself be aliased to
  // another primary.
  const aliasOf = assignAliases(sorted);

  const roleCounts = new Map<TextStyleRole, number>();
  const clusters: TypographyCluster[] = [];
  const aliasesByPrimary = new Map<string, TypographyAlias[]>();
  for (const c of sorted) {
    const link = aliasOf.get(c.key);
    if (link) {
      const arr = aliasesByPrimary.get(link.primary) ?? [];
      arr.push({
        key: c.key,
        descriptor: c.descriptor,
        usageCount: c.usages.length,
        differingFields: link.differingFields,
      });
      aliasesByPrimary.set(link.primary, arr);
    }
  }
  for (const c of sorted) {
    const sample = c.usages.find((u) => u.characterCount >= 2)?.characters ?? c.usages[0]?.characters ?? "";
    const role = suggestRole(c.descriptor, sample);
    const ord = (roleCounts.get(role) ?? 0) + 1;
    roleCounts.set(role, ord);
    const base = ROLE_BASE_SLUG[role];
    const suggestedSlug = ord === 1 ? base : `${base}-${ord}`;
    const proxy = proxyIndex.get(c.key);
    clusters.push({
      key: c.key,
      descriptor: c.descriptor,
      usages: c.usages,
      aliases: aliasesByPrimary.get(c.key) ?? [],
      proxyGuid: proxy ? guidToString(proxy.guid) : undefined,
      proxyName: proxy?.name,
      suggestedRole: role,
      suggestedSlug,
    });
  }
  return { clusters };
}
