/**
 * @file Strict classification of CMS field kinds based on figma variableField enum names.
 */

export type SiteCollectionFieldKind =
  | "text"
  | "rich-text"
  | "image"
  | "date"
  | "link"
  | "number"
  | "boolean";

const VARIABLE_FIELD_TO_KIND: ReadonlyMap<string, SiteCollectionFieldKind> = new Map([
  ["TEXT_DATA", "text"],
  ["CMS_SERIALIZED_RICH_TEXT_DATA", "rich-text"],
  ["IMAGE_FILL_PAINT", "image"],
  ["VIDEO_PAINT", "image"],
  ["DATE_DATA", "date"],
  ["DATE_TIME_DATA", "date"],
  ["URL_DATA", "link"],
  ["LINK_URL", "link"],
  ["NUMBER_DATA", "number"],
  ["BOOLEAN_DATA", "boolean"],
]);

const KIND_LABELS: Readonly<Record<SiteCollectionFieldKind, string>> = {
  text: "Text",
  "rich-text": "Rich Text",
  image: "Image",
  date: "Date",
  link: "Link",
  number: "Number",
  boolean: "Toggle",
};

/**
 * Map a figma variableField enum name to its CMS field kind.
 *
 * Throws on unknown names so the dictionary stays the only source of truth —
 * extend `VARIABLE_FIELD_TO_KIND` when a new variableField appears in the wild.
 */
export function classifySiteCollectionFieldKind(variableFieldName: string): SiteCollectionFieldKind {
  const kind = VARIABLE_FIELD_TO_KIND.get(variableFieldName);
  if (kind === undefined) {
    throw new Error(
      `Unknown CMS variableField "${variableFieldName}". Add it to VARIABLE_FIELD_TO_KIND in site-collection-field-kind.ts`,
    );
  }
  return kind;
}

/** Reduce a non-empty list of variableField names to their single shared kind. */
export function classifySiteCollectionFieldKindFromAll(
  variableFieldNames: readonly string[],
): SiteCollectionFieldKind {
  if (variableFieldNames.length === 0) {
    throw new Error("classifySiteCollectionFieldKindFromAll requires at least one variableField name");
  }
  const kinds = new Set(variableFieldNames.map(classifySiteCollectionFieldKind));
  if (kinds.size > 1) {
    throw new Error(
      `Cannot reduce mixed CMS field kinds [${[...kinds].join(", ")}] from variableFields [${variableFieldNames.join(", ")}] to a single kind`,
    );
  }
  const [first] = [...kinds];
  if (first === undefined) {
    throw new Error("classifySiteCollectionFieldKindFromAll: empty kinds set after deduplication");
  }
  return first;
}

/** Display label for a CMS field kind. */
export function getSiteCollectionFieldKindLabel(kind: SiteCollectionFieldKind): string {
  return KIND_LABELS[kind];
}
