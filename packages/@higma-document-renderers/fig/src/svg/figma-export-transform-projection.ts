/**
 * @file Project SVG transforms into geometry before export.
 *
 * Figma's SVG exporter emits viewport-space geometry for the static SVG
 * export path. The RenderTree keeps Kiwi node transforms as wrappers so
 * SVG/React/WebGL consume the same resolved tree. This module is the SVG
 * export boundary that projects safe wrapper transforms into the structured
 * SVG element tree, including user-space defs whose coordinate system must
 * move with the rendered content.
 */

import { parseSvgPathD, pathCommandsToSvgPath, transformPathCommands, type AffineMatrix, type PathCommand } from "@higma-primitives/path";
import type { SvgAttributeValue, SvgAttributes, SvgElementNode, SvgNode } from "./element-primitives";

type Translation = {
  readonly tx: number;
  readonly ty: number;
};

type Matrix = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};

type MatrixTransformOperation = {
  readonly kind: "matrix";
  readonly matrix: Matrix;
};

type TranslateTransformOperation = {
  readonly kind: "translate";
  readonly tx: number;
  readonly ty: number;
};

type ScaleTransformOperation = {
  readonly kind: "scale";
  readonly sx: number;
  readonly sy: number;
};

type RotateTransformOperation = {
  readonly kind: "rotate";
  readonly angle: number;
  readonly cx?: number;
  readonly cy?: number;
};

type TransformOperation =
  | MatrixTransformOperation
  | TranslateTransformOperation
  | ScaleTransformOperation
  | RotateTransformOperation;

const ZERO_TRANSLATION: Translation = { tx: 0, ty: 0 };
const X_POSITION_ATTRIBUTES = new Set(["x", "cx", "x1", "x2", "fx"]);
const Y_POSITION_ATTRIBUTES = new Set(["y", "cy", "y1", "y2", "fy"]);
const GEOMETRY_POSITION_TAG_NAMES = new Set(["path", "rect", "circle", "ellipse", "line", "text", "image", "foreignObject"]);
const USER_SPACE_DEF_TAG_NAMES = new Set(["mask", "clipPath", "linearGradient", "radialGradient", "pattern"]);
const PROJECTABLE_AFFINE_CONTAINER_TAG_NAMES = new Set(["g"]);
const PROJECTABLE_AFFINE_GEOMETRY_TAG_NAMES = new Set(["path"]);
const AFFINE_PROJECTION_BLOCKING_ATTRIBUTES = new Set(["clip-path", "filter", "mask", "style", "transform"]);

/**
 * Projects exporter-only transforms into SVG geometry without changing RenderTree semantics.
 */
export function projectFigmaExportTransforms(root: SvgNode): SvgNode {
  return collapseTransparentGroups(projectSvgNode(root, ZERO_TRANSLATION));
}

function collapseTransparentGroups(node: SvgNode): SvgNode {
  switch (node.kind) {
    case "fragment":
      return { ...node, children: collapseTransparentGroupChildren(node.children) };
    case "text":
      return node;
    case "element":
      return collapseTransparentGroupElement(node);
  }
}

function collapseTransparentGroupElement(node: SvgElementNode): SvgNode {
  const children = collapseTransparentGroupChildren(node.children);
  if (node.name === "g" && definedAttributeNames(node.attrs).length === 0) {
    return { kind: "fragment", children };
  }
  return { ...node, children };
}

function collapseTransparentGroupChildren(children: readonly SvgNode[]): readonly SvgNode[] {
  return children.flatMap((child) => {
    const collapsed = collapseTransparentGroups(child);
    if (collapsed.kind === "fragment") {
      return collapsed.children;
    }
    return [collapsed];
  });
}

function projectSvgNode(node: SvgNode, translation: Translation): SvgNode {
  switch (node.kind) {
    case "fragment":
      return { ...node, children: projectChildren(node.children, translation) };
    case "text":
      return node;
    case "element":
      return projectElementNode(node, translation);
  }
}

function projectElementNode(node: SvgElementNode, translation: Translation): SvgNode {
  if (node.name === "g" || node.name === "svg" || node.name === "defs") {
    return projectContainerElement(node, translation);
  }
  if (node.name === "filter") {
    return projectFilterElement(node, translation);
  }
  if (USER_SPACE_DEF_TAG_NAMES.has(node.name)) {
    return projectUserSpaceDefElement(node, translation);
  }
  if (GEOMETRY_POSITION_TAG_NAMES.has(node.name)) {
    return projectGeometryElement(node, translation);
  }
  return {
    ...node,
    children: projectChildren(node.children, translation),
  };
}

function projectContainerElement(node: SvgElementNode, translation: Translation): SvgElementNode {
  const affineProjection = projectAffineContainerTransform(node, translation);
  if (affineProjection !== undefined) {
    return affineProjection;
  }
  const projection = projectElementTransform(node.attrs, translation);
  return {
    ...node,
    attrs: projection.attrs,
    children: projectChildren(node.children, projection.childTranslation),
  };
}

function projectFilterElement(node: SvgElementNode, translation: Translation): SvgElementNode {
  const projection = projectElementTransform(node.attrs, translation);
  return {
    ...node,
    attrs: projectPositionAttributes(projection.attrs, projection.childTranslation),
    children: node.children,
  };
}

function projectUserSpaceDefElement(node: SvgElementNode, translation: Translation): SvgElementNode {
  if (node.transformProjection === "preserve") {
    return projectPreservedTransformUserSpaceDefElement(node, translation);
  }
  const projection = projectElementTransform(node.attrs, translation);
  const translatedAttrs = projectUserSpaceDefAttributes(node.name, projection.attrs, projection.childTranslation);
  const childTranslation = projectUserSpaceDefChildTranslation(node.name, projection.attrs, projection.childTranslation);
  return {
    ...node,
    attrs: translatedAttrs,
    children: projectChildren(node.children, childTranslation),
  };
}

function projectPreservedTransformUserSpaceDefElement(node: SvgElementNode, translation: Translation): SvgElementNode {
  if (node.name !== "clipPath") {
    throw new Error(`projectFigmaExportTransforms cannot preserve transform projection for <${node.name}>`);
  }
  return {
    ...node,
    attrs: projectPreservedTransformAttributes(node.attrs, translation),
    children: projectChildren(node.children, translation),
  };
}

function projectPreservedTransformAttributes(attrs: SvgAttributes, translation: Translation): SvgAttributes {
  const transform = readAttribute(attrs, "transform");
  if (transform === undefined) {
    throw new Error("projectFigmaExportTransforms requires transform when transformProjection is preserve");
  }
  return {
    ...attrs,
    transform: prependTranslationToTransform(negateTranslation(translation), transform),
  };
}

function projectGeometryElement(node: SvgElementNode, translation: Translation): SvgElementNode {
  if (node.transformProjection === "preserve") {
    return projectPreservedTransformGeometryElement(node, translation);
  }
  const projection = projectElementTransform(node.attrs, translation);
  if (!isZeroTranslation(projection.childTranslation) && projection.attrs.transform !== undefined) {
    return {
      ...node,
      attrs: projection.attrs,
      children: projectChildren(node.children, ZERO_TRANSLATION),
    };
  }
  const attrs = projectGeometryAttributes(node.name, projection.attrs, projection.childTranslation);
  return {
    ...node,
    attrs,
    children: projectChildren(node.children, ZERO_TRANSLATION),
  };
}

function projectPreservedTransformGeometryElement(node: SvgElementNode, translation: Translation): SvgElementNode {
  if (isZeroTranslation(translation)) {
    return {
      ...node,
      children: projectChildren(node.children, ZERO_TRANSLATION),
    };
  }
  const transform = readAttribute(node.attrs, "transform");
  return {
    ...node,
    attrs: {
      ...node.attrs,
      transform: translatedTransformAttribute(translation, transform),
    },
    children: projectChildren(node.children, ZERO_TRANSLATION),
  };
}

function translatedTransformAttribute(translation: Translation, transform: string | undefined): string {
  if (transform === undefined) {
    return formatTransformOperations([{ kind: "translate", tx: translation.tx, ty: translation.ty }]);
  }
  return prependTranslationToTransform(translation, transform);
}

function projectChildren(children: readonly SvgNode[], translation: Translation): readonly SvgNode[] {
  return children.map((child) => projectSvgNode(child, translation));
}

function projectAffineContainerTransform(
  node: SvgElementNode,
  inherited: Translation,
): SvgElementNode | undefined {
  if (!PROJECTABLE_AFFINE_CONTAINER_TAG_NAMES.has(node.name)) {
    return undefined;
  }
  const transform = readAttribute(node.attrs, "transform");
  if (transform === undefined) {
    return undefined;
  }
  const matrix = readMatrix(transform);
  if (matrix === undefined || isPureTranslationMatrix(matrix)) {
    return undefined;
  }
  const ownBlockingAttrs = definedAttributeNames(node.attrs)
    .filter((name) => name !== "transform" && AFFINE_PROJECTION_BLOCKING_ATTRIBUTES.has(name));
  if (ownBlockingAttrs.length > 0) {
    return undefined;
  }
  if (!canProjectAffineChildren(node.children)) {
    return undefined;
  }
  return {
    ...node,
    attrs: removeAttribute(node.attrs, "transform"),
    children: projectAffineChildren(node.children, prependTranslationToMatrix(inherited, matrix)),
  };
}

function canProjectAffineChildren(children: readonly SvgNode[]): boolean {
  return children.every(canProjectAffineNode);
}

function canProjectAffineNode(node: SvgNode): boolean {
  switch (node.kind) {
    case "fragment":
      return canProjectAffineChildren(node.children);
    case "text":
      return false;
    case "element":
      return canProjectAffineElement(node);
  }
}

function canProjectAffineElement(node: SvgElementNode): boolean {
  if (PROJECTABLE_AFFINE_CONTAINER_TAG_NAMES.has(node.name)) {
    return definedAttributeNames(node.attrs).length === 0 && canProjectAffineChildren(node.children);
  }
  if (!PROJECTABLE_AFFINE_GEOMETRY_TAG_NAMES.has(node.name)) {
    return false;
  }
  if (readAttribute(node.attrs, "d") === undefined) {
    return false;
  }
  return definedAttributeNames(node.attrs).every((name) => !AFFINE_PROJECTION_BLOCKING_ATTRIBUTES.has(name));
}

function projectAffineChildren(children: readonly SvgNode[], matrix: Matrix): readonly SvgNode[] {
  return children.map((child) => projectAffineNode(child, matrix));
}

function projectAffineNode(node: SvgNode, matrix: Matrix): SvgNode {
  switch (node.kind) {
    case "fragment":
      return { ...node, children: projectAffineChildren(node.children, matrix) };
    case "text":
      throw new Error("projectFigmaExportTransforms cannot project affine transform into text");
    case "element":
      return projectAffineElement(node, matrix);
  }
}

function projectAffineElement(node: SvgElementNode, matrix: Matrix): SvgElementNode {
  if (PROJECTABLE_AFFINE_CONTAINER_TAG_NAMES.has(node.name)) {
    return { ...node, children: projectAffineChildren(node.children, matrix) };
  }
  if (node.name !== "path") {
    throw new Error(`projectFigmaExportTransforms cannot project affine transform into <${node.name}>`);
  }
  const d = readAttribute(node.attrs, "d");
  if (d === undefined) {
    throw new Error("projectFigmaExportTransforms cannot project affine transform into a path without d");
  }
  return {
    ...node,
    attrs: {
      ...node.attrs,
      d: projectPathDWithMatrix(d, matrix),
    },
  };
}

function projectElementTransform(
  attrs: SvgAttributes,
  inherited: Translation,
): { readonly attrs: SvgAttributes; readonly childTranslation: Translation } {
  const transform = readAttribute(attrs, "transform");
  if (transform === undefined) {
    return { attrs, childTranslation: inherited };
  }
  const ownTranslation = readPureTranslation(transform);
  if (ownTranslation !== undefined) {
    return {
      attrs: removeAttribute(attrs, "transform"),
      childTranslation: addTranslations(inherited, ownTranslation),
    };
  }
  if (isZeroTranslation(inherited)) {
    return { attrs, childTranslation: ZERO_TRANSLATION };
  }
  return {
    attrs: { ...attrs, transform: prependTranslationToTransform(inherited, transform) },
    childTranslation: ZERO_TRANSLATION,
  };
}

function projectUserSpaceDefAttributes(name: string, attrs: SvgAttributes, translation: Translation): SvgAttributes {
  if (isZeroTranslation(translation)) {
    return attrs;
  }
  if (name === "linearGradient" || name === "radialGradient") {
    return projectGradientAttributes(attrs, translation);
  }
  if (name === "pattern") {
    return projectPatternAttributes(attrs, translation);
  }
  return projectPositionAttributes(attrs, translation);
}

function projectGradientAttributes(attrs: SvgAttributes, translation: Translation): SvgAttributes {
  if (attrs.gradientUnits !== "userSpaceOnUse") {
    return attrs;
  }
  if (attrs.gradientTransform !== undefined) {
    return projectTransformLikeAttribute(attrs, "gradientTransform", translation);
  }
  return projectPositionAttributes(attrs, translation);
}

function projectPatternAttributes(attrs: SvgAttributes, translation: Translation): SvgAttributes {
  if (attrs.patternUnits !== "userSpaceOnUse") {
    return attrs;
  }
  const withPositions = projectPositionAttributes(attrs, translation);
  return projectTransformLikeAttribute(withPositions, "patternTransform", translation);
}

function projectUserSpaceDefChildTranslation(
  name: string,
  attrs: SvgAttributes,
  translation: Translation,
): Translation {
  if (name !== "pattern") {
    return translation;
  }
  if (attrs.patternContentUnits === "objectBoundingBox") {
    return ZERO_TRANSLATION;
  }
  return translation;
}

function projectTransformLikeAttribute(
  attrs: SvgAttributes,
  name: string,
  translation: Translation,
): SvgAttributes {
  const value = readAttribute(attrs, name);
  if (value === undefined) {
    return attrs;
  }
  return { ...attrs, [name]: prependTranslationToTransform(translation, value) };
}

function projectGeometryAttributes(name: string, attrs: SvgAttributes, translation: Translation): SvgAttributes {
  if (isZeroTranslation(translation)) {
    return attrs;
  }
  if (name === "path") {
    return projectPathAttributes(attrs, translation);
  }
  return projectPositionAttributes(attrs, translation);
}

function projectPathAttributes(attrs: SvgAttributes, translation: Translation): SvgAttributes {
  const d = readAttribute(attrs, "d");
  if (d === undefined) {
    return projectPositionAttributes(attrs, translation);
  }
  return {
    ...projectPositionAttributes(attrs, translation),
    d: projectPathD(d, translation),
  };
}

function projectPositionAttributes(attrs: SvgAttributes, translation: Translation): SvgAttributes {
  if (isZeroTranslation(translation)) {
    return attrs;
  }
  return Object.fromEntries(
    Object.entries(attrs).map(([key, value]) => [key, projectPositionAttribute(key, value, translation)]),
  );
}

function projectPositionAttribute(
  name: string,
  value: SvgAttributeValue,
  translation: Translation,
): SvgAttributeValue {
  if (value === undefined || value === true || value === false) {
    return value;
  }
  if (X_POSITION_ATTRIBUTES.has(name)) {
    return projectNumericAttribute(value, translation.tx, name);
  }
  if (Y_POSITION_ATTRIBUTES.has(name)) {
    return projectNumericAttribute(value, translation.ty, name);
  }
  return value;
}

function projectNumericAttribute(value: SvgAttributeValue, offset: number, name: string): SvgAttributeValue {
  const parsed = parsePlainNumber(String(value), name);
  return parsed + offset;
}

function projectPathD(d: string, translation: Translation): string {
  const commands = parseSvgPathD(d).map((command) => projectPathCommand(command, translation));
  return pathCommandsToSvgPath(commands, { precision: 12, separator: " " });
}

function projectPathDWithMatrix(d: string, matrix: Matrix): string {
  const commands = parseSvgPathD(d);
  if (commands.some((command) => command.type === "A")) {
    throw new Error("projectFigmaExportTransforms cannot project affine transform into arc path commands");
  }
  return pathCommandsToSvgPath(transformPathCommands(commands, matrixToAffine(matrix)), { precision: 12, separator: " " });
}

function projectPathCommand(command: PathCommand, translation: Translation): PathCommand {
  switch (command.type) {
    case "M":
    case "L":
      return { ...command, x: command.x + translation.tx, y: command.y + translation.ty };
    case "C":
      return {
        type: "C",
        x1: command.x1 + translation.tx,
        y1: command.y1 + translation.ty,
        x2: command.x2 + translation.tx,
        y2: command.y2 + translation.ty,
        x: command.x + translation.tx,
        y: command.y + translation.ty,
      };
    case "Q":
      return {
        type: "Q",
        x1: command.x1 + translation.tx,
        y1: command.y1 + translation.ty,
        x: command.x + translation.tx,
        y: command.y + translation.ty,
      };
    case "A":
      return { ...command, x: command.x + translation.tx, y: command.y + translation.ty };
    case "Z":
      return command;
  }
}

function readPureTranslation(value: string): Translation | undefined {
  const matrix = readMatrix(value);
  if (matrix !== undefined && isPureTranslationMatrix(matrix)) {
    return { tx: matrix.e, ty: matrix.f };
  }
  const translate = /^translate\(([^)]*)\)$/u.exec(value);
  if (translate === null) {
    return undefined;
  }
  const parts = splitTransformNumbers(translate[1], "translate");
  if (parts.length !== 1 && parts.length !== 2) {
    throw new Error(`projectFigmaExportTransforms requires translate() with one or two values: ${value}`);
  }
  return { tx: parts[0], ty: parts[1] ?? 0 };
}

function isPureTranslationMatrix(matrix: Matrix): boolean {
  return matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1;
}

function prependTranslationToMatrix(translation: Translation, matrix: Matrix): Matrix {
  if (isZeroTranslation(translation)) {
    return matrix;
  }
  return { ...matrix, e: matrix.e + translation.tx, f: matrix.f + translation.ty };
}

function matrixToAffine(matrix: Matrix): AffineMatrix {
  return {
    m00: matrix.a,
    m01: matrix.c,
    m02: matrix.e,
    m10: matrix.b,
    m11: matrix.d,
    m12: matrix.f,
  };
}

function prependTranslationToTransform(translation: Translation, transform: string): string {
  if (isZeroTranslation(translation)) {
    return transform;
  }
  const operations = parseTransformList(transform);
  const firstOperation = operations[0];
  if (firstOperation === undefined) {
    throw new Error("projectFigmaExportTransforms requires a non-empty transform");
  }
  if (firstOperation.kind === "matrix") {
    return formatTransformOperations([
      { kind: "matrix", matrix: prependTranslationToMatrix(translation, firstOperation.matrix) },
      ...operations.slice(1),
    ]);
  }
  if (firstOperation.kind === "translate") {
    return formatTransformOperations([
      { kind: "translate", tx: firstOperation.tx + translation.tx, ty: firstOperation.ty + translation.ty },
      ...operations.slice(1),
    ]);
  }
  return formatTransformOperations([
    { kind: "translate", tx: translation.tx, ty: translation.ty },
    ...operations,
  ]);
}

function parseTransformList(value: string): readonly TransformOperation[] {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("projectFigmaExportTransforms requires a non-empty transform");
  }
  if (!/^(?:[A-Za-z]+\([^)]*\)\s*)+$/u.test(trimmed)) {
    throw new Error(`projectFigmaExportTransforms cannot parse transform list: ${value}`);
  }
  return Array.from(trimmed.matchAll(/([A-Za-z]+)\(([^)]*)\)/gu))
    .map((match) => parseTransformOperation(match[1], match[2], value));
}

function parseTransformOperation(
  name: string | undefined,
  args: string | undefined,
  source: string,
): TransformOperation {
  if (name === undefined || args === undefined) {
    throw new Error(`projectFigmaExportTransforms cannot parse transform operation: ${source}`);
  }
  switch (name) {
    case "matrix":
      return { kind: "matrix", matrix: parseMatrixNumbers(splitTransformNumbers(args, "matrix"), source) };
    case "translate":
      return parseTranslateOperation(args, source);
    case "scale":
      return parseScaleOperation(args, source);
    case "rotate":
      return parseRotateOperation(args, source);
    default:
      throw new Error(`projectFigmaExportTransforms cannot project translation through ${name}() transform: ${source}`);
  }
}

function parseTranslateOperation(args: string, source: string): TranslateTransformOperation {
  const parts = splitTransformNumbers(args, "translate");
  if (parts.length !== 1 && parts.length !== 2) {
    throw new Error(`projectFigmaExportTransforms requires translate() with one or two values: ${source}`);
  }
  return { kind: "translate", tx: parts[0], ty: parts[1] ?? 0 };
}

function parseScaleOperation(args: string, source: string): ScaleTransformOperation {
  const parts = splitTransformNumbers(args, "scale");
  if (parts.length !== 1 && parts.length !== 2) {
    throw new Error(`projectFigmaExportTransforms requires scale() with one or two values: ${source}`);
  }
  return { kind: "scale", sx: parts[0], sy: parts[1] ?? parts[0] };
}

function parseRotateOperation(args: string, source: string): RotateTransformOperation {
  const parts = splitTransformNumbers(args, "rotate");
  if (parts.length !== 1 && parts.length !== 3) {
    throw new Error(`projectFigmaExportTransforms requires rotate() with one or three values: ${source}`);
  }
  if (parts.length === 1) {
    return {
      kind: "rotate",
      angle: parts[0],
    };
  }
  return {
    kind: "rotate",
    angle: parts[0],
    cx: parts[1],
    cy: parts[2],
  };
}

function parseMatrixNumbers(parts: readonly number[], source: string): Matrix {
  if (parts.length !== 6) {
    throw new Error(`projectFigmaExportTransforms requires matrix() with six values: ${source}`);
  }
  return { a: parts[0], b: parts[1], c: parts[2], d: parts[3], e: parts[4], f: parts[5] };
}

function formatTransformOperations(operations: readonly TransformOperation[]): string {
  return operations.map(formatTransformOperation).join(" ");
}

function formatTransformOperation(operation: TransformOperation): string {
  switch (operation.kind) {
    case "matrix":
      return formatMatrix(operation.matrix);
    case "translate":
      return `translate(${formatNumber(operation.tx)} ${formatNumber(operation.ty)})`;
    case "scale":
      return formatScaleOperation(operation);
    case "rotate":
      return formatRotateOperation(operation);
  }
}

function formatScaleOperation(operation: ScaleTransformOperation): string {
  if (operation.sx === operation.sy) {
    return `scale(${formatNumber(operation.sx)})`;
  }
  return `scale(${formatNumber(operation.sx)} ${formatNumber(operation.sy)})`;
}

function formatRotateOperation(operation: RotateTransformOperation): string {
  if (operation.cx === undefined || operation.cy === undefined) {
    return `rotate(${formatNumber(operation.angle)})`;
  }
  return `rotate(${formatNumber(operation.angle)} ${formatNumber(operation.cx)} ${formatNumber(operation.cy)})`;
}

function readMatrix(value: string): Matrix | undefined {
  const matrix = /^matrix\(([^)]*)\)$/u.exec(value);
  if (matrix === null) {
    return undefined;
  }
  return parseMatrixNumbers(splitTransformNumbers(matrix[1], "matrix"), value);
}

function splitTransformNumbers(value: string, label: string): readonly number[] {
  return value
    .trim()
    .split(/[,\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => parsePlainNumber(part, label));
}

function parsePlainNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`projectFigmaExportTransforms requires finite ${label}: ${value}`);
  }
  return parsed;
}

function addTranslations(a: Translation, b: Translation): Translation {
  return { tx: a.tx + b.tx, ty: a.ty + b.ty };
}

function negateTranslation(translation: Translation): Translation {
  return { tx: -translation.tx, ty: -translation.ty };
}

function isZeroTranslation(translation: Translation): boolean {
  return translation.tx === 0 && translation.ty === 0;
}

function readAttribute(attrs: SvgAttributes, name: string): string | undefined {
  const value = attrs[name];
  if (value === undefined || value === true || value === false) {
    return undefined;
  }
  return String(value);
}

function definedAttributeNames(attrs: SvgAttributes): readonly string[] {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name);
}

function removeAttribute(attrs: SvgAttributes, name: string): SvgAttributes {
  return Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== name));
}

function formatMatrix(matrix: Matrix): string {
  return `matrix(${formatNumber(matrix.a)},${formatNumber(matrix.b)},${formatNumber(matrix.c)},${formatNumber(matrix.d)},${formatNumber(matrix.e)},${formatNumber(matrix.f)})`;
}

function formatNumber(value: number): string {
  const cleaned = Number(value.toPrecision(12));
  if (Object.is(cleaned, -0)) {
    return "0";
  }
  return cleaned.toString();
}
