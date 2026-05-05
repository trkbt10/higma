/**
 * @file Figma-family canvas schema profiles
 */

export type FigCanvasMagic = "fig-kiwi" | "fig-deck" | "fig-buzz" | "fig-site";

export type FigSchemaProfileName = "fig" | "deck" | "buzz" | "site";

export type FigSchemaProfile = {
  readonly name: FigSchemaProfileName;
  readonly magic: FigCanvasMagic;
  readonly extension: ".fig" | ".deck" | ".buzz" | ".site";
  readonly domain: "design" | "presentation" | "template" | "site";
};

export const FIG_SCHEMA_PROFILES: readonly FigSchemaProfile[] = [
  {
    name: "fig",
    magic: "fig-kiwi",
    extension: ".fig",
    domain: "design",
  },
  {
    name: "deck",
    magic: "fig-deck",
    extension: ".deck",
    domain: "presentation",
  },
  {
    name: "buzz",
    magic: "fig-buzz",
    extension: ".buzz",
    domain: "template",
  },
  {
    name: "site",
    magic: "fig-site",
    extension: ".site",
    domain: "site",
  },
];

export const FIG_CANVAS_MAGICS: readonly FigCanvasMagic[] = FIG_SCHEMA_PROFILES.map((profile) => profile.magic);

/** Return true when a raw canvas magic belongs to a known fig-family profile. */
export function isFigCanvasMagic(value: string): value is FigCanvasMagic {
  return FIG_CANVAS_MAGICS.includes(value as FigCanvasMagic);
}

/** Find the schema profile associated with a raw canvas magic value. */
export function getFigSchemaProfileByMagic(magic: FigCanvasMagic): FigSchemaProfile {
  const profile = FIG_SCHEMA_PROFILES.find((entry) => entry.magic === magic);
  if (!profile) {
    throw new Error(`Unknown fig schema profile magic: ${magic}`);
  }
  return profile;
}
