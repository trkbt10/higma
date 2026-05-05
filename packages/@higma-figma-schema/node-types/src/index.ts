/**
 * @file Figma-family product node type groups
 */

export const FIG_PRESENTATION_NODE_TYPES = [
  "SLIDE_GRID",
  "SLIDE_ROW",
  "SLIDE",
  "INTERACTIVE_SLIDE_ELEMENT",
] as const;

export const FIG_SITE_NODE_TYPES = [
  "RESPONSIVE_SET",
  "REPEATER",
  "CMS_RICH_TEXT",
] as const;

export const FIG_TEMPLATE_METADATA_FIELDS = [
  "cooperTemplateData",
] as const;

export type FigPresentationNodeType = (typeof FIG_PRESENTATION_NODE_TYPES)[number];
export type FigSiteNodeType = (typeof FIG_SITE_NODE_TYPES)[number];
export type FigTemplateMetadataField = (typeof FIG_TEMPLATE_METADATA_FIELDS)[number];
