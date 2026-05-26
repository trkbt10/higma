/**
 * @file Top-level React renderer for a fig scene graph
 *
 * Renders a SceneGraph as React SVG elements via the RenderTree
 * intermediate representation. All attribute resolution is performed
 * by resolveRenderTree() — this component tree only formats.
 *
 * ## Architecture
 *
 * ```
 * SceneGraph
 *     ↓ resolveRenderTree()
 * RenderTree (fully resolved)
 *     ↓ FigSceneRenderer [this file]
 * React SVG elements
 * ```
 *
 * Usage:
 * - In the editor canvas (EditorCanvas children): renders as <g> fragment
 * - In standalone viewer: wrap in your own <svg> element
 */

import { Fragment, createElement, memo, useMemo, useRef, type ReactNode } from "react";
import {
  translateSceneGraphNode,
  type SceneGraph,
  type SceneGraphNodeTranslation,
} from "@higma-document-renderers/fig/scene-graph";
import type { SceneGraphRenderOptions } from "../scene-graph";
import {
  resolveRenderTreeWithReferenceReuse,
  type RenderTree,
  type RenderTreeReferenceReuseState,
} from "../scene-graph";
import {
  formatRenderTreeToFigmaExportSvgElement,
  formatRenderTreeToSvgElement,
  type SvgAttributeValue,
  type SvgAttributes,
  type SvgNode,
} from "../svg";
import { RenderNodeComponent } from "./nodes/RenderNodeComponent";

// =============================================================================
// Types
// =============================================================================

type FigSceneRendererProps = {
  /** The scene graph to render (will be resolved to RenderTree internally) */
  readonly sceneGraph: SceneGraph;
  readonly sceneGraphNodeTranslation?: SceneGraphNodeTranslation;
  readonly renderOptions?: SceneGraphRenderOptions;
};

type FigRenderTreeRendererProps = {
  /** Pre-resolved render tree */
  readonly renderTree: RenderTree;
};

type FigSceneSvgRendererProps = FigSceneRendererProps & {
  readonly rootProps?: SvgReactAttributes;
};

type FigRenderTreeSvgRendererProps = FigRenderTreeRendererProps & {
  readonly rootProps?: SvgReactAttributes;
};

type FigSceneFigmaExportSvgRendererProps = FigSceneSvgRendererProps;

type FigRenderTreeFigmaExportSvgRendererProps = FigRenderTreeSvgRendererProps;

type SvgReactAttributeValue = Exclude<SvgAttributeValue, undefined>;

type SvgReactStyle = Record<string, string>;

type SvgReactAttribute = SvgReactAttributeValue | SvgReactStyle;

type SvgReactAttributes = Record<string, SvgReactAttribute | undefined>;

const CSS_CLASS_BACKED_BLEND_MODE_STYLES = ".higma-svg-blend-plus-lighter{mix-blend-mode:plus-lighter}";

type ReactSvgStyleConversion = {
  readonly style?: SvgReactStyle;
  readonly className?: string;
};

// =============================================================================
// Components
// =============================================================================

/**
 * Render a pre-resolved RenderTree as React SVG elements.
 *
 * Use this when you've already resolved the RenderTree
 * (e.g., to share it between SVG string and React renderers).
 */
function FigRenderTreeRendererImpl({ renderTree }: FigRenderTreeRendererProps) {
  const childNodes = useMemo(
    () =>
      renderTree.children.map((child) => (
        <RenderNodeComponent key={child.id} node={child} />
      )),
    [renderTree.children],
  );

  return <g>{childNodes}</g>;
}

export const FigRenderTreeRenderer = memo(FigRenderTreeRendererImpl);

function reactSvgAttributeName(name: string): string {
  if (name === "class") {
    return "className";
  }
  if (name.startsWith("data-") || name.startsWith("aria-")) {
    return name;
  }
  return reactSvgStylePropertyName(name);
}

function reactSvgStylePropertyName(name: string): string {
  return name.replace(/-([a-z])/gu, (_match, letter: string) => letter.toUpperCase());
}

function parseSvgStyleDeclaration(declaration: string): readonly [string, string] {
  const separatorIndex = declaration.indexOf(":");
  if (separatorIndex < 0) {
    throw new Error(`FigSceneSvgRenderer requires CSS declarations with a colon: ${declaration}`);
  }
  return [
    declaration.slice(0, separatorIndex).trim(),
    declaration.slice(separatorIndex + 1).trim(),
  ];
}

function classBackedBlendModeClass(property: string, value: string): string | undefined {
  if (property !== "mix-blend-mode") {
    return undefined;
  }
  if (value === "plus-lighter") {
    return "higma-svg-blend-plus-lighter";
  }
  return undefined;
}

function appendClassName(current: string | undefined, next: string | undefined): string | undefined {
  if (current === undefined || current.length === 0) {
    return next;
  }
  if (next === undefined || next.length === 0) {
    return current;
  }
  return `${current} ${next}`;
}

function reactSvgStyle(value: string): ReactSvgStyleConversion {
  const declarations = value
    .split(";")
    .filter((declaration) => declaration.trim().length > 0)
    .map(parseSvgStyleDeclaration);
  const classNames = declarations
    .map(([property, declarationValue]) => classBackedBlendModeClass(property, declarationValue))
    .filter((className): className is string => className !== undefined);
  const styleEntries = declarations
    .filter(([property, declarationValue]) => classBackedBlendModeClass(property, declarationValue) === undefined)
    .map(([property, declarationValue]) => [reactSvgStylePropertyName(property), declarationValue] as const);
  const conversion: ReactSvgStyleConversion = {};
  if (styleEntries.length > 0) {
    return {
      style: Object.fromEntries(styleEntries),
      className: classNameFromList(classNames),
    };
  }
  if (classNames.length > 0) {
    return { className: classNameFromList(classNames) };
  }
  return conversion;
}

function classNameFromList(classNames: readonly string[]): string | undefined {
  if (classNames.length === 0) {
    return undefined;
  }
  return classNames.join(" ");
}

function mergeReactSvgAttribute(
  attrs: SvgReactAttributes,
  name: string,
  value: SvgReactAttribute | undefined,
): SvgReactAttributes {
  if (value === undefined) {
    return attrs;
  }
  if (name === "className") {
    return {
      ...attrs,
      className: appendClassName(asClassName(attrs.className), asClassName(value)),
    };
  }
  if (name === "style") {
    return {
      ...attrs,
      style: {
        ...asStyle(attrs.style),
        ...asStyle(value),
      },
    };
  }
  return { ...attrs, [name]: value };
}

function asClassName(value: SvgReactAttribute | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("FigSceneSvgRenderer requires className attributes to be strings");
  }
  return value;
}

function asStyle(value: SvgReactAttribute | undefined): SvgReactStyle {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object") {
    throw new Error("FigSceneSvgRenderer requires style attributes to be objects after React conversion");
  }
  return value;
}

function reactSvgAttributeEntries(name: string, value: SvgReactAttributeValue): readonly (readonly [string, SvgReactAttribute])[] {
  if (name !== "style") {
    return [[reactSvgAttributeName(name), value]];
  }
  if (typeof value !== "string") {
    throw new Error("FigSceneSvgRenderer requires string style attributes before React conversion");
  }
  const styleConversion = reactSvgStyle(value);
  const classEntry = optionalReactSvgAttributeEntry("className", styleConversion.className);
  const styleEntry = optionalReactSvgAttributeEntry("style", styleConversion.style);
  const entries: readonly (readonly [string, SvgReactAttribute] | undefined)[] = [classEntry, styleEntry];
  return entries.filter((entry): entry is readonly [string, SvgReactAttribute] => entry !== undefined);
}

function optionalReactSvgAttributeEntry(
  name: string,
  value: SvgReactAttribute | undefined,
): readonly [string, SvgReactAttribute] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return [name, value];
}

function reactSvgAttributes(attrs: SvgAttributes, rootProps?: SvgReactAttributes): SvgReactAttributes {
  const svgAttrs = Object.entries(attrs)
    .filter((entry): entry is [string, SvgReactAttributeValue] => entry[1] !== undefined && entry[1] !== false)
    .flatMap(([name, value]) => reactSvgAttributeEntries(name, value))
    .reduce(
      (merged, [name, value]) => mergeReactSvgAttribute(merged, name, value),
      {} as SvgReactAttributes,
    );
  return Object.entries(rootProps ?? {})
    .filter((entry): entry is [string, SvgReactAttribute] => entry[1] !== undefined)
    .reduce(
      (merged, [name, value]) => mergeReactSvgAttribute(merged, name, value),
      svgAttrs,
    );
}

function svgNodeNeedsCssClassBackedBlendMode(node: SvgNode): boolean {
  if (node.kind === "text") {
    return false;
  }
  if (node.kind === "fragment") {
    return node.children.some(svgNodeNeedsCssClassBackedBlendMode);
  }
  const style = node.attrs.style;
  if (typeof style === "string" && /mix-blend-mode:\s*plus-lighter/u.test(style)) {
    return true;
  }
  return node.children.some(svgNodeNeedsCssClassBackedBlendMode);
}

function svgNodeToReact(node: SvgNode, key: string): ReactNode {
  switch (node.kind) {
    case "fragment":
      return createElement(
        Fragment,
        { key },
        ...node.children.map((child, index) => svgNodeToReact(child, `${key}-${index}`)),
      );
    case "text":
      return createElement(Fragment, { key }, node.value);
    case "element":
      return createElement(
        node.name,
        { key, ...reactSvgAttributes(node.attrs) },
        ...node.children.map((child, index) => svgNodeToReact(child, `${key}-${index}`)),
      );
  }
}

function svgRootNodeToReact(node: SvgNode, rootProps: SvgReactAttributes | undefined): ReactNode {
  if (node.kind !== "element") {
    throw new Error("FigRenderTreeSvgRenderer requires an SVG root element");
  }
  const blendModeStyles = cssClassBackedBlendModeStyleElements(node);
  return createElement(
    node.name,
    reactSvgAttributes(node.attrs, rootProps),
    ...blendModeStyles,
    ...node.children.map((child, index) => svgNodeToReact(child, `svg-${index}`)),
  );
}

function cssClassBackedBlendModeStyleElements(node: SvgNode): readonly ReactNode[] {
  if (!svgNodeNeedsCssClassBackedBlendMode(node)) {
    return [];
  }
  return [createElement("style", { key: "css-class-backed-blend-mode" }, CSS_CLASS_BACKED_BLEND_MODE_STYLES)];
}

function resolveReactRendererSceneGraphInput(
  sceneGraph: SceneGraph,
  sceneGraphNodeTranslation: SceneGraphNodeTranslation | undefined,
): SceneGraph {
  if (sceneGraphNodeTranslation === undefined) {
    return sceneGraph;
  }
  return translateSceneGraphNode(sceneGraph, sceneGraphNodeTranslation);
}

/**
 * Render a pre-resolved RenderTree through the structured SVG formatter SoT.
 */
function FigRenderTreeSvgRendererImpl({ renderTree, rootProps }: FigRenderTreeSvgRendererProps) {
  return useMemo(
    () => svgRootNodeToReact(formatRenderTreeToSvgElement(renderTree), rootProps),
    [renderTree, rootProps],
  );
}

export const FigRenderTreeSvgRenderer = memo(FigRenderTreeSvgRendererImpl);

/**
 * Render a pre-resolved RenderTree through the Figma SVG export boundary.
 */
function FigRenderTreeFigmaExportSvgRendererImpl({ renderTree, rootProps }: FigRenderTreeFigmaExportSvgRendererProps) {
  return useMemo(
    () => svgRootNodeToReact(formatRenderTreeToFigmaExportSvgElement(renderTree), rootProps),
    [renderTree, rootProps],
  );
}

export const FigRenderTreeFigmaExportSvgRenderer = memo(FigRenderTreeFigmaExportSvgRendererImpl);

/**
 * Render a SceneGraph as React SVG elements.
 *
 * Resolves the SceneGraph to a RenderTree internally, then renders.
 */
function FigSceneRendererImpl({ sceneGraph, sceneGraphNodeTranslation, renderOptions }: FigSceneRendererProps) {
  const referenceReuseStateRef = useRef<RenderTreeReferenceReuseState | undefined>(undefined);
  const renderTree = useMemo(() => {
    const renderInputSceneGraph = resolveReactRendererSceneGraphInput(sceneGraph, sceneGraphNodeTranslation);
    const result = resolveRenderTreeWithReferenceReuse(renderInputSceneGraph, referenceReuseStateRef.current, renderOptions);
    referenceReuseStateRef.current = result.referenceReuseState;
    return result.renderTree;
  }, [sceneGraph, sceneGraphNodeTranslation, renderOptions]);

  return <FigRenderTreeRenderer renderTree={renderTree} />;
}

export const FigSceneRenderer = memo(FigSceneRendererImpl);

/**
 * Render a SceneGraph as structured SVG DOM before the Figma export boundary.
 */
function FigSceneSvgRendererImpl({ sceneGraph, sceneGraphNodeTranslation, renderOptions, rootProps }: FigSceneSvgRendererProps) {
  const referenceReuseStateRef = useRef<RenderTreeReferenceReuseState | undefined>(undefined);
  const renderTree = useMemo(() => {
    const renderInputSceneGraph = resolveReactRendererSceneGraphInput(sceneGraph, sceneGraphNodeTranslation);
    const result = resolveRenderTreeWithReferenceReuse(renderInputSceneGraph, referenceReuseStateRef.current, renderOptions);
    referenceReuseStateRef.current = result.referenceReuseState;
    return result.renderTree;
  }, [sceneGraph, sceneGraphNodeTranslation, renderOptions]);

  return <FigRenderTreeSvgRenderer renderTree={renderTree} rootProps={rootProps} />;
}

export const FigSceneSvgRenderer = memo(FigSceneSvgRendererImpl);

/**
 * Render a SceneGraph through the Figma SVG export boundary.
 */
function FigSceneFigmaExportSvgRendererImpl({
  sceneGraph,
  sceneGraphNodeTranslation,
  renderOptions,
  rootProps,
}: FigSceneFigmaExportSvgRendererProps) {
  const referenceReuseStateRef = useRef<RenderTreeReferenceReuseState | undefined>(undefined);
  const renderTree = useMemo(() => {
    const renderInputSceneGraph = resolveReactRendererSceneGraphInput(sceneGraph, sceneGraphNodeTranslation);
    const result = resolveRenderTreeWithReferenceReuse(renderInputSceneGraph, referenceReuseStateRef.current, renderOptions);
    referenceReuseStateRef.current = result.referenceReuseState;
    return result.renderTree;
  }, [sceneGraph, sceneGraphNodeTranslation, renderOptions]);

  return <FigRenderTreeFigmaExportSvgRenderer renderTree={renderTree} rootProps={rootProps} />;
}

export const FigSceneFigmaExportSvgRenderer = memo(FigSceneFigmaExportSvgRendererImpl);
