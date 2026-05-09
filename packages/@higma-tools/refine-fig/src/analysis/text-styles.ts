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

const WEIGHT_BY_STYLE: ReadonlyMap<string, number> = new Map([
  ["thin", 100],
  ["extralight", 200],
  ["ultralight", 200],
  ["light", 300],
  ["regular", 400],
  ["normal", 400],
  ["book", 400],
  ["medium", 500],
  ["semibold", 600],
  ["demibold", 600],
  ["bold", 700],
  ["extrabold", 800],
  ["ultrabold", 800],
  ["black", 900],
  ["heavy", 900],
]);

function styleToWeight(style: string): number {
  const norm = style.toLowerCase().replace(/[^a-z]/g, "");
  return WEIGHT_BY_STYLE.get(norm) ?? 400;
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

export type TypographyCluster = {
  readonly key: string;
  readonly descriptor: TypographyDescriptor;
  readonly usages: readonly TypographyUsage[];
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
    fontWeight: styleToWeight(fontName.style),
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
  const roleCounts = new Map<TextStyleRole, number>();
  const clusters: TypographyCluster[] = [];
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
      proxyGuid: proxy ? guidToString(proxy.guid) : undefined,
      proxyName: proxy?.name,
      suggestedRole: role,
      suggestedSlug,
    });
  }
  return { clusters };
}
