/**
 * @file Presentation metadata for site render roles.
 */

import type { SiteRenderRole } from "@higma-document-renderers/site";

export type SiteRolePresentation = {
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly accentColor: string;
};

export const SITE_ROLE_PRESENTATIONS = {
  "cms-rich-text": {
    label: "CMS Rich Text",
    shortLabel: "Rich Text",
    description: "Rich text content mapped through CMS field aliases.",
    accentColor: "#8b5cf6",
  },
  repeater: {
    label: "Repeater",
    shortLabel: "Repeater",
    description: "Repeated layout bound to a CMS collection selector.",
    accentColor: "#0ea5e9",
  },
  "responsive-set": {
    label: "Responsive Set",
    shortLabel: "Responsive",
    description: "Breakpoint-aware layout scope for a route or block.",
    accentColor: "#16a34a",
  },
  symbol: {
    label: "Symbol",
    shortLabel: "Symbol",
    description: "Reusable component source in the site layout graph.",
    accentColor: "#f59e0b",
  },
  instance: {
    label: "Instance",
    shortLabel: "Instance",
    description: "Reusable component instance placed inside a layout scope.",
    accentColor: "#64748b",
  },
} satisfies Record<SiteRenderRole, SiteRolePresentation>;

/** Resolve presentation metadata for a site render role. */
export function getSiteRolePresentation(role: SiteRenderRole): SiteRolePresentation {
  return SITE_ROLE_PRESENTATIONS[role];
}
