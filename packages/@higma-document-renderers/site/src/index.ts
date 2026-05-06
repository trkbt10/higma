/**
 * @file Site document renderer boundary.
 */

import { createSiteDomainSummary, type SiteDocument, type SiteDomainSummary } from "@higma-document-models/site";
import {
  createFigmaRenderOutline,
  type FigmaRenderOutline,
  type FigmaRenderOutlineEntry,
} from "@higma-figma-analysis/render-outline";

export type SiteRenderRole = "cms-rich-text" | "repeater" | "responsive-set" | "symbol" | "instance";

export type SiteRenderUnitBase<Role extends SiteRenderRole> = {
  readonly kind: "site-render-unit";
  readonly id: string;
  readonly role: Role;
  readonly nodeType: string;
  readonly label: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly depth: number;
  readonly order: number;
};

export type SiteCmsRichTextRenderUnit = SiteRenderUnitBase<"cms-rich-text"> & {
  readonly layoutScope: "cms-rich-text";
};

export type SiteRepeaterRenderUnit = SiteRenderUnitBase<"repeater"> & {
  readonly layoutScope: "repeater";
};

export type SiteResponsiveSetRenderUnit = SiteRenderUnitBase<"responsive-set"> & {
  readonly layoutScope: "responsive-set";
};

export type SiteSymbolRenderUnit = SiteRenderUnitBase<"symbol"> & {
  readonly layoutScope: "symbol";
};

export type SiteInstanceRenderUnit = SiteRenderUnitBase<"instance"> & {
  readonly layoutScope: "instance";
};

export type SiteRenderUnit =
  | SiteCmsRichTextRenderUnit
  | SiteRepeaterRenderUnit
  | SiteResponsiveSetRenderUnit
  | SiteSymbolRenderUnit
  | SiteInstanceRenderUnit;

const SITE_RENDER_ROLES = [
  { nodeType: "CMS_RICH_TEXT", role: "cms-rich-text" },
  { nodeType: "REPEATER", role: "repeater" },
  { nodeType: "RESPONSIVE_SET", role: "responsive-set" },
  { nodeType: "SYMBOL", role: "symbol" },
  { nodeType: "INSTANCE", role: "instance" },
] as const;

export type SiteRenderPlan = {
  readonly kind: "site";
  readonly document: SiteDocument;
  readonly insights: SiteDocument["insights"];
  readonly domainSummary: SiteDomainSummary;
  readonly renderOutline: FigmaRenderOutline<SiteRenderRole>;
  readonly renderUnits: readonly SiteRenderUnit[];
};

function siteRenderLabel(entry: FigmaRenderOutlineEntry<SiteRenderRole>): string {
  return entry.name ?? `${entry.type} ${entry.id}`;
}

function siteRenderUnitBase<Role extends SiteRenderRole>(
  entry: FigmaRenderOutlineEntry<SiteRenderRole>,
  role: Role,
): SiteRenderUnitBase<Role> {
  return {
    kind: "site-render-unit",
    id: entry.id,
    role,
    nodeType: entry.type,
    label: siteRenderLabel(entry),
    parentId: entry.parentId,
    childIds: entry.childIds,
    depth: entry.depth,
    order: entry.order,
  };
}

function createSiteRenderUnit(entry: FigmaRenderOutlineEntry<SiteRenderRole>): SiteRenderUnit {
  switch (entry.role) {
    case "cms-rich-text":
      return { ...siteRenderUnitBase(entry, "cms-rich-text"), layoutScope: "cms-rich-text" };
    case "repeater":
      return { ...siteRenderUnitBase(entry, "repeater"), layoutScope: "repeater" };
    case "responsive-set":
      return { ...siteRenderUnitBase(entry, "responsive-set"), layoutScope: "responsive-set" };
    case "symbol":
      return { ...siteRenderUnitBase(entry, "symbol"), layoutScope: "symbol" };
    case "instance":
      return { ...siteRenderUnitBase(entry, "instance"), layoutScope: "instance" };
  }
}

/** Create a site render plan with explicit layout render units. */
export function createSiteRenderPlan(document: SiteDocument): SiteRenderPlan {
  const renderOutline = createFigmaRenderOutline(document.canvas.nodeChanges, SITE_RENDER_ROLES);
  const renderUnits = renderOutline.entries.map(createSiteRenderUnit);
  if (renderUnits.length === 0) {
    throw new Error("Site render plan requires at least one layout render unit");
  }
  return {
    kind: "site",
    document,
    insights: document.insights,
    domainSummary: createSiteDomainSummary(document),
    renderOutline,
    renderUnits,
  };
}
