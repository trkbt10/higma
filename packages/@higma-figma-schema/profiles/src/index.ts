/**
 * @file Public entry point for fig-family schema facts
 */

export {
  FIG_CANVAS_MAGICS,
  FIG_SCHEMA_PROFILES,
  getFigSchemaProfileByMagic,
  isFigCanvasMagic,
  type FigCanvasMagic,
  type FigSchemaProfile,
  type FigSchemaProfileName,
} from "./profiles";

export {
  FIGMA_KIWI_SCHEMA,
  getFigEnumTable,
  requireFigEnumTable,
  reverseFigEnumTable,
  type FigSchema,
  type FigSchemaDefinition,
  type FigEnumTable,
} from "./schema";
