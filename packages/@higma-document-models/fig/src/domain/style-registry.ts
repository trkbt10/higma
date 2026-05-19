/** @file Style registry types derived from Kiwi nodes. */

import type {
  FigEffect,
  FigFontName,
  FigPaint,
  KiwiEnumValue,
} from "../types";

export type FigTextStyleProperties = {
  readonly fontName?: FigFontName;
  readonly fontSize?: number;
  readonly lineHeight?: { readonly value: number; readonly units: KiwiEnumValue };
  readonly letterSpacing?: { readonly value: number; readonly units: KiwiEnumValue };
  readonly textCase?: KiwiEnumValue;
  readonly textDecoration?: KiwiEnumValue;
  readonly textTracking?: number;
  readonly fontVariations?: readonly { readonly axisTag: number; readonly axisValue: number }[];
};

export type FigStyleRegistry = {
  readonly paints: ReadonlyMap<string, readonly FigPaint[]>;
  readonly effects: ReadonlyMap<string, readonly FigEffect[]>;
  readonly textProperties: ReadonlyMap<string, FigTextStyleProperties>;
  readonly layoutGrids: ReadonlyMap<string, readonly unknown[]>;
};

export const EMPTY_FIG_STYLE_REGISTRY: FigStyleRegistry = {
  paints: new Map(),
  effects: new Map(),
  textProperties: new Map(),
  layoutGrids: new Map(),
};
