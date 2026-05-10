/**
 * @file `text-leaf` — a leaf-text element (`<h1>Hello</h1>`).
 *
 * `RawElement.text` is set and `children` is empty, the predicate the
 * normaliser uses to dispatch into `normalizeText`. Adding text to an
 * element via this fixture is the lowest-level text primitive.
 */
import type { RawElement, RawRect } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const DEFAULT_TEXT = "Hello";
export const DEFAULT_FONT_FAMILY = "Inter";
export const DEFAULT_FONT_SIZE_PX = 24;
export const DEFAULT_FONT_WEIGHT = 700;
export const DEFAULT_TEXT_COLOR = "rgb(20, 30, 40)";
export const DEFAULT_TEXT_BOX: RawRect = { x: 0, y: 0, width: 200, height: 36 };

/** Build a leaf-text `RawElement` (`<h1>Hello</h1>` shape) with overridable font / colour / box. */
export function textLeaf(overrides: {
  readonly id?: string;
  readonly tag?: string;
  readonly rect?: RawRect;
  readonly text?: string;
  readonly fontFamily?: string;
  readonly fontSizePx?: number;
  readonly fontWeight?: number;
  readonly color?: string;
  readonly extra?: Record<string, string>;
} = {}): RawElement {
  const styleOverrides: Record<string, string> = {
    "font-family": overrides.fontFamily ?? DEFAULT_FONT_FAMILY,
    "font-size": `${overrides.fontSizePx ?? DEFAULT_FONT_SIZE_PX}px`,
    "font-weight": String(overrides.fontWeight ?? DEFAULT_FONT_WEIGHT),
    color: overrides.color ?? DEFAULT_TEXT_COLOR,
    ...overrides.extra,
  };
  return synthEl({
    id: overrides.id ?? "text",
    tag: overrides.tag ?? "h1",
    rect: overrides.rect ?? DEFAULT_TEXT_BOX,
    styleOverrides,
    text: overrides.text ?? DEFAULT_TEXT,
  });
}
