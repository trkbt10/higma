/**
 * @file Structured SVG element primitives for scene-renderer output.
 */
/* eslint-disable jsdoc/require-jsdoc -- Exported functions are one-to-one SVG element constructors; the file overview defines the contract. */

import { escapeSvgAttributeValue } from "./primitives";

export type SvgAttributeValue = string | number | boolean | undefined;

export type SvgAttributes = Record<string, SvgAttributeValue>;

export type SvgElementNode = {
  readonly kind: "element";
  readonly name: string;
  readonly attrs: SvgAttributes;
  readonly children: readonly SvgNode[];
  readonly selfClosing: boolean;
};

export type SvgTextNode = {
  readonly kind: "text";
  readonly value: string;
};

export type SvgFragmentNode = {
  readonly kind: "fragment";
  readonly children: readonly SvgNode[];
};

export type SvgNode = SvgElementNode | SvgTextNode | SvgFragmentNode;

export const EMPTY_SVG: SvgNode = { kind: "fragment", children: [] };

export type SvgPaintAttrs = {
  fill?: string;
  stroke?: string;
  "stroke-width"?: number | string;
  "stroke-linecap"?: "butt" | "round" | "square";
  "stroke-linejoin"?: "miter" | "round" | "bevel";
  "stroke-dasharray"?: string;
  "fill-rule"?: "nonzero" | "evenodd";
  "clip-rule"?: "nonzero" | "evenodd";
  "fill-opacity"?: number | string;
  "stroke-opacity"?: number | string;
  transform?: string;
  class?: string;
  style?: string;
  "shape-rendering"?: "auto" | "optimizeSpeed" | "crispEdges" | "geometricPrecision";
  opacity?: number | string;
  filter?: string;
  mask?: string;
};

export function serializeSvgNode(node: SvgNode): string {
  switch (node.kind) {
    case "fragment":
      return node.children.map(serializeSvgNode).join("");
    case "text":
      return escapeSvgTextValue(node.value);
    case "element":
      return serializeSvgElement(node);
  }
}

export function svg(
  attrs: {
    width?: number | string;
    height?: number | string;
    viewBox?: string;
    preserveAspectRatio?: string;
    overflow?: "visible" | "hidden" | "scroll" | "auto";
    fill?: string;
    class?: string;
    style?: string;
    xmlns?: string;
  },
  ...children: readonly SvgNode[]
): SvgNode {
  return element("svg", { xmlns: attrs.xmlns ?? "http://www.w3.org/2000/svg", ...attrs }, children, false);
}

export function g(
  attrs: {
    transform?: string;
    class?: string;
    style?: string;
    id?: string;
    "clip-path"?: string;
    mask?: string;
    filter?: string;
    opacity?: number | string;
    fill?: string;
  },
  ...children: readonly SvgNode[]
): SvgNode {
  return element("g", attrs, children, false);
}

export function defs(...children: readonly SvgNode[]): SvgNode {
  return element("defs", {}, children, false);
}

export function path(attrs: SvgPaintAttrs & { d: string }): SvgNode {
  return element("path", attrs, [], true);
}

export function rect(attrs: SvgPaintAttrs & {
  x?: number | string;
  y?: number | string;
  width: number | string;
  height: number | string;
  rx?: number | string;
  ry?: number | string;
  filter?: string;
}): SvgNode {
  return element("rect", attrs, [], true);
}

export function circle(attrs: SvgPaintAttrs & {
  cx: number | string;
  cy: number | string;
  r: number | string;
}): SvgNode {
  return element("circle", attrs, [], true);
}

export function ellipse(attrs: SvgPaintAttrs & {
  cx: number | string;
  cy: number | string;
  rx: number | string;
  ry: number | string;
  filter?: string;
}): SvgNode {
  return element("ellipse", attrs, [], true);
}

export function line(attrs: {
  x1: number | string;
  y1: number | string;
  x2: number | string;
  y2: number | string;
  stroke?: string;
  "stroke-width"?: number | string;
  "stroke-linecap"?: "butt" | "round" | "square";
  "stroke-dasharray"?: string;
  "stroke-opacity"?: number | string;
  transform?: string;
  class?: string;
  style?: string;
  opacity?: number | string;
}): SvgNode {
  return element("line", attrs, [], true);
}

export function text(
  attrs: {
    x?: number | string;
    y?: number | string;
    fill?: string;
    "fill-opacity"?: number | string;
    "font-family"?: string;
    "font-size"?: number | string;
    "font-weight"?: number | string;
    "font-style"?: string;
    "letter-spacing"?: number | string;
    "text-anchor"?: "start" | "middle" | "end";
    style?: string;
    transform?: string;
  },
  content: string,
): SvgNode {
  return element("text", attrs, [{ kind: "text", value: content }], false);
}

export function image(attrs: {
  href: string;
  x?: number | string;
  y?: number | string;
  width: number | string;
  height: number | string;
  preserveAspectRatio?: string;
  transform?: string;
  opacity?: number | string;
  filter?: string;
  mask?: string;
}): SvgNode {
  return element("image", attrs, [], true);
}

export function linearGradient(attrs: {
  id: string;
  x1?: string;
  y1?: string;
  x2?: string;
  y2?: string;
  gradientUnits?: string;
  gradientTransform?: string;
}, ...children: readonly SvgNode[]): SvgNode {
  return element("linearGradient", attrs, children, false);
}

export function radialGradient(attrs: {
  id: string;
  cx?: string;
  cy?: string;
  r?: string;
  fx?: string;
  fy?: string;
  gradientUnits?: string;
  gradientTransform?: string;
}, ...children: readonly SvgNode[]): SvgNode {
  return element("radialGradient", attrs, children, false);
}

export function stop(attrs: {
  offset: string;
  "stop-color": string;
  "stop-opacity"?: number | string;
}): SvgNode {
  return element("stop", attrs, [], true);
}

export function pattern(attrs: {
  id: string;
  x?: number | string;
  y?: number | string;
  width: number | string;
  height: number | string;
  patternUnits?: string;
  patternContentUnits?: string;
  patternTransform?: string;
}, ...children: readonly SvgNode[]): SvgNode {
  return element("pattern", attrs, children, false);
}

export function clipPath(attrs: { id: string }, ...children: readonly SvgNode[]): SvgNode {
  return element("clipPath", attrs, children, false);
}

export function mask(attrs: {
  id: string;
  style?: string;
  maskUnits?: string;
  x?: string | number;
  y?: string | number;
  width?: string | number;
  height?: string | number;
}, ...children: readonly SvgNode[]): SvgNode {
  return element("mask", attrs, children, false);
}

export function a(attrs: { href: string }, ...children: readonly SvgNode[]): SvgNode {
  return element("a", attrs, children, false);
}

export function foreignObject(attrs: {
  x: number | string;
  y: number | string;
  width: number | string;
  height: number | string;
  "clip-path"?: string;
  opacity?: number | string;
}, ...children: readonly SvgNode[]): SvgNode {
  return element("foreignObject", attrs, children, false);
}

export function htmlDiv(attrs: {
  xmlns: "http://www.w3.org/1999/xhtml";
  style: string;
}): SvgNode {
  return element("div", attrs, [], false);
}

export function filter(attrs: {
  id: string;
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  filterUnits?: string;
  "color-interpolation-filters"?: string;
}, ...children: readonly SvgNode[]): SvgNode {
  return element("filter", attrs, children, false);
}

export function feFlood(attrs: { "flood-color"?: string; "flood-opacity"?: number | string; result?: string }): SvgNode {
  return element("feFlood", attrs, [], true);
}

export function feColorMatrix(attrs: { in?: string; type: string; values: string; result?: string }): SvgNode {
  return element("feColorMatrix", attrs, [], true);
}

export function feOffset(attrs: { in?: string; dx?: number | string; dy?: number | string; result?: string }): SvgNode {
  return element("feOffset", attrs, [], true);
}

export function feGaussianBlur(attrs: { in?: string; stdDeviation: number | string; result?: string }): SvgNode {
  return element("feGaussianBlur", attrs, [], true);
}

export function feMorphology(attrs: { in?: string; operator: string; radius: number | string; result?: string }): SvgNode {
  return element("feMorphology", attrs, [], true);
}

export function feBlend(attrs: { mode?: string; in?: string; in2?: string; result?: string }): SvgNode {
  return element("feBlend", attrs, [], true);
}

export function feMerge(...children: readonly SvgNode[]): SvgNode;
export function feMerge(_attrs: Record<string, never>, ...children: readonly SvgNode[]): SvgNode;
export function feMerge(
  first?: Record<string, never> | SvgNode,
  ...rest: readonly SvgNode[]
): SvgNode {
  if (first === undefined) {
    return element("feMerge", {}, [], false);
  }
  if (isSvgNode(first)) {
    return element("feMerge", {}, [first, ...rest], false);
  }
  return element("feMerge", {}, rest, false);
}

export function feMergeNode(attrs: { in?: string }): SvgNode {
  return element("feMergeNode", attrs, [], true);
}

export function feComposite(attrs: {
  in?: string;
  in2?: string;
  operator?: string;
  k1?: number | string;
  k2?: number | string;
  k3?: number | string;
  k4?: number | string;
  result?: string;
}): SvgNode {
  return element("feComposite", attrs, [], true);
}

function element(
  name: string,
  attrs: SvgAttributes,
  children: readonly SvgNode[],
  selfClosing: boolean,
): SvgElementNode {
  return { kind: "element", name, attrs, children, selfClosing };
}

function serializeSvgElement(node: SvgElementNode): string {
  const attrs = serializeSvgAttributes(node.attrs);
  const attrPart = attrs.length > 0 ? ` ${attrs}` : "";
  if (node.selfClosing) {
    return `<${node.name}${attrPart}/>`;
  }
  return `<${node.name}${attrPart}>${node.children.map(serializeSvgNode).join("")}</${node.name}>`;
}

export function serializeSvgAttributes(attrs: SvgAttributes): string {
  return Object.entries(attrs)
    .filter((entry): entry is [string, string | number | true] => entry[1] !== undefined && entry[1] !== false)
    .map(([key, value]) => serializeSvgAttribute(key, value))
    .join(" ");
}

function serializeSvgAttribute(key: string, value: string | number | true): string {
  if (value === true) {
    return key;
  }
  return `${key}="${escapeSvgAttributeValue(String(value))}"`;
}

function escapeSvgTextValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isSvgNode(value: unknown): value is SvgNode {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return "kind" in value;
}
