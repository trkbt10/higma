/**
 * @file Assemble per-file TSX output for pages and components.
 *
 * A *page* file mirrors one user-selected top-level frame and is the
 * primary surface a developer wires into a router. A *component* file
 * mirrors one SYMBOL or one Variant Set (a FRAME with variant
 * metadata; the canonical schema has no COMPONENT_SET NodeType — see
 * `docs/refactor/component-type-cleanup.md`),
 * with variants collapsed into a single component switching on a
 * `variant` prop and any other typed component-property defs surfaced
 * as React props.
 *
 * `tokens.css` is loaded once from `index.html` and once from
 * `main.tsx` (so Bun's bundler ships it as `main.css`). Per-page TSX
 * files do NOT import `tokens.css` themselves: doing so would duplicate
 * the entire token sheet into every page bundle and (worse) cause Bun
 * to emit a same-named CSS chunk that competes with the standalone
 * `tokens.css` already linked from `index.html`. The CSS variables
 * stay in scope at the document root, which is enough for every
 * `var(--token)` reference in the generated JSX to resolve.
 *
 * Imports of generated components are tracked per-file by the
 * `EmitContext` and inserted in deterministic alphabetical order so
 * regenerating the same fig produces byte-identical output.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import type { ComponentPropDecl, ComponentTarget, EmitFile, EmitRegistry, FrameTarget } from "../types";
import type { EmitContext } from "./jsx";
import { emitFrameJsx } from "./jsx";
import type { TokenIndex } from "../../tokens";
import type { FigSymbolContext } from "@higma-document-io/fig/context";
import type { ImageResolver } from "../style/paint";
import type { PropBindings } from "../plan/prop-bindings";
import { buildPropBindings } from "../plan/prop-bindings";
import { buildReparentResult } from "../layout/reparent";
import { applyRowClustering } from "../layout/cluster";
import { serialize as serializeJsx } from "../../lib/jsx-tree/serialize";

/**
 * Indentation depth used when serializing the JSX body to live
 * inside `return (\n  ...\n  );`. Two levels of two spaces puts the
 * outer `<div>` at column 4, matching the indentation prefix of the
 * surrounding `return (...)` block.
 */
const JSX_BODY_DEPTH = 2;

export type EmitOpts = {
  readonly debugAttrs: boolean;
  readonly imageResolver: ImageResolver;
};

const EMPTY_BINDINGS: PropBindings = new Map();

function buildLayoutOverlay(rootNode: FigNode): EmitContext["reparent"] {
  // Reparent first (image-to-fig flat-tree repair), then row-cluster on
  // top of the reparent overlay so the clustering pass operates on the
  // already-corrected children list.
  const base = buildReparentResult(rootNode);
  const childrenByParent = new Map(base.childrenByParent);
  const transformByGuid = new Map(base.transformByGuid);
  applyRowClustering(rootNode, childrenByParent, transformByGuid);
  return { childrenByParent, transformByGuid };
}

function makeContext(
  source: FigSymbolContext,
  registry: EmitRegistry,
  index: TokenIndex,
  emittingFile: string,
  opts: EmitOpts,
  propBindings: PropBindings,
  rootNode: FigNode,
): EmitContext {
  return {
    source,
    registry,
    index,
    imageResolver: opts.imageResolver,
    emittingFile,
    imports: new Map(),
    debugAttrs: opts.debugAttrs,
    propBindings,
    reparent: buildLayoutOverlay(rootNode),
  };
}

function renderImports(imports: ReadonlyMap<string, string>): string {
  if (imports.size === 0) {
    return "";
  }
  const entries = [...imports.entries()].sort(([a], [b]) => a.localeCompare(b));
  return entries
    .map(([name, path]) => `import { ${name} } from ${JSON.stringify(path)};`)
    .join("\n");
}

function fileHeader(name: string, role: "page" | "component", figmaName: string): string {
  return [
    `/**`,
    ` * @file ${role === "page" ? "Page" : "Component"} \`${name}\` generated from Figma frame ${JSON.stringify(figmaName)}.`,
    ` * Edit at your own risk — re-running fig-to-web overwrites this file.`,
    ` */`,
  ].join("\n");
}

function renderPropTypeName(componentName: string): string {
  return `${componentName}Props`;
}

/**
 * Render the TS prop type for a component: every prop in `decls` becomes
 * one line. The variant axis emits a string-union; other props use
 * native TS types.
 */
function renderPropsTypeBody(decls: readonly ComponentPropDecl[]): string {
  if (decls.length === 0) {
    return "Record<string, never>";
  }
  const lines = decls.map(renderPropTypeLine);
  return `{\n  ${lines.join(";\n  ")};\n}`;
}

function renderPropTypeLine(decl: ComponentPropDecl): string {
  const propName = JSON.stringify(decl.name);
  switch (decl.kind) {
    case "variant":
      return `${propName}?: ${decl.values.map((v) => JSON.stringify(v)).join(" | ")}`;
    case "boolean":
      return `${propName}?: boolean`;
    case "string":
      return `${propName}?: string`;
    case "number":
      return `${propName}?: number`;
    case "node":
      return `${propName}?: React.ReactNode`;
  }
}

function renderDestructure(decls: readonly ComponentPropDecl[]): string {
  if (decls.length === 0) {
    return "";
  }
  const entries = decls.map(destructureEntry);
  return `{ ${entries.join(", ")} }`;
}

function destructureEntry(decl: ComponentPropDecl): string {
  const ident = jsIdentForKey(decl.name);
  switch (decl.kind) {
    case "variant":
      return `${ident} = ${JSON.stringify(decl.defaultValue)}`;
    case "boolean":
      return withOptionalDefault(ident, decl.defaultValue, (v) => `${v}`);
    case "string":
      return withOptionalDefault(ident, decl.defaultValue, (v) => JSON.stringify(v));
    case "number":
      return withOptionalDefault(ident, decl.defaultValue, (v) => `${v}`);
    case "node":
      return ident;
  }
}

function withOptionalDefault<T>(ident: string, value: T | undefined, format: (v: T) => string): string {
  if (value === undefined) {
    return ident;
  }
  return `${ident} = ${format(value)}`;
}

/**
 * Convert a Figma prop name (free text, e.g. "Property 1", "Show Icon")
 * into a JS-safe identifier. The name lives in the React prop's actual
 * key when destructured; if it differs from the source we use the
 * `<source>: <ident>` rename form on destructuring.
 */
function jsIdentForKey(propName: string): string {
  if (propName === "variant") {
    return "variant";
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(propName)) {
    return propName;
  }
  // Rename to a sanitised identifier while keeping the source key in
  // the destructure pattern: e.g. `"Property 1": variant`.
  const camel = propName
    .split(/[^A-Za-z0-9]+/)
    .filter((s) => s.length > 0)
    .map((s, i) => (i === 0 ? s.charAt(0).toLowerCase() : s.charAt(0).toUpperCase()) + s.slice(1).toLowerCase())
    .join("");
  const safe = /^[0-9]/.test(camel) ? `p${camel}` : camel;
  return `${JSON.stringify(propName)}: ${safe}`;
}

/** Render one TSX file for a target page (top-level Figma frame). */
export function emitPageFile(
  source: FigSymbolContext,
  registry: EmitRegistry,
  index: TokenIndex,
  target: FrameTarget,
  opts: EmitOpts,
): EmitFile {
  // Pages have no typed component props — they are not bound to a
  // SYMBOL — so `EMPTY_BINDINGS` lets the JSX emitter render
  // hard-coded TEXT characters verbatim.
  const context = makeContext(source, registry, index, target.filePath, opts, EMPTY_BINDINGS, target.node);
  const bodyNode = emitFrameJsx(target.node, context, "page-root");
  const body = serializeJsx(bodyNode, { depth: JSX_BODY_DEPTH });
  const importsSrc = renderImports(context.imports);
  const header = fileHeader(target.componentName, "page", target.node.name ?? "");
  const propTypeName = renderPropTypeName(target.componentName);

  const lines = [
    header,
    "",
    `import * as React from "react";`,
    importsSrc,
    "",
    `export type ${propTypeName} = Record<string, never>;`,
    "",
    `export function ${target.componentName}(_props: ${propTypeName} = {}): React.ReactElement {`,
    `  return (`,
    body,
    `  );`,
    `}`,
    "",
    `export default ${target.componentName};`,
    "",
  ].filter((line) => line !== "");

  return { path: target.filePath, contents: `${lines.join("\n")}\n` };
}

function emitVariantSwitch(
  source: FigSymbolContext,
  registry: EmitRegistry,
  index: TokenIndex,
  target: ComponentTarget,
  context: EmitContext,
): string {
  const cases: string[] = [];
  for (const [value, variantNode] of target.variants) {
    cases.push(emitVariantCase(source, registry, index, value, variantNode, context));
  }
  return cases.join("\n");
}

function emitVariantCase(
  _source: FigSymbolContext,
  _registry: EmitRegistry,
  _index: TokenIndex,
  variantValue: string,
  variantNode: FigNode,
  context: EmitContext,
): string {
  // Delegate to the same component-root path that single-variant
  // components and pages use. The previous bespoke wrapper only
  // emitted `position / width / height`, dropping the variant
  // SYMBOL's authored auto-layout (`stackMode`, alignment, padding)
  // — which is exactly what gives YouTube's pill chips their
  // centered text against a rounded background. Reusing
  // `emitFrameJsx` keeps the variant case in lockstep with every
  // other "wrap a single root frame in a `<div>`" call site.
  const frameNode = emitFrameJsx(variantNode, context, "component-root");
  // Variant case body lands four levels deep: `function { switch
  // { case X: return ( <jsx> ); } }` — `JSX_BODY_DEPTH + 2` keeps the
  // outer `<div>` aligned with the closing `)` paren.
  const frameJsx = serializeJsx(frameNode, { depth: JSX_BODY_DEPTH + 2 });
  return [
    `    case ${JSON.stringify(variantValue)}:`,
    `      return (`,
    frameJsx,
    `      );`,
  ].join("\n");
}

/** Render one TSX file for a referenced SYMBOL / variant-set target. */
export function emitComponentFile(
  source: FigSymbolContext,
  registry: EmitRegistry,
  index: TokenIndex,
  target: ComponentTarget,
  opts: EmitOpts,
): EmitFile {
  // Build the descendant-guid → prop binding map from the component
  // target's typed props. The JSX emitter consults this when rendering
  // each TEXT node so a `componentPropRefs(TEXT_DATA)` slot reads
  // `{label}` instead of the SYMBOL-default literal.
  const bindings = buildPropBindings(target);
  const context = makeContext(source, registry, index, target.filePath, opts, bindings, target.node);
  const isVariantSet = target.variants.size > 0;
  const propsSig = renderPropsTypeBody(target.props);
  const propTypeName = renderPropTypeName(target.componentName);
  const destructure = renderDestructure(target.props);

  if (isVariantSet) {
    const switchProp = pickVariantPropIdent(target.props);
    const body = emitVariantSwitch(source, registry, index, target, context);
    const importsSrc = renderImports(context.imports);
    const header = fileHeader(target.componentName, "component", target.node.name ?? "");

    const fnSignature = renderFnSignature(destructure, propTypeName);

    const lines = [
      header,
      "",
      `import * as React from "react";`,
      importsSrc,
      "",
      `export type ${propTypeName} = ${propsSig};`,
      "",
      `export function ${target.componentName}(${fnSignature}): React.ReactElement {`,
      `  switch (${switchProp}) {`,
      body,
      `  }`,
      `}`,
      "",
      `export default ${target.componentName};`,
      "",
    ].filter((line) => line !== "");
    return { path: target.filePath, contents: `${lines.join("\n")}\n` };
  }

  const bodyNode = emitFrameJsx(target.node, context, "component-root");
  const body = serializeJsx(bodyNode, { depth: JSX_BODY_DEPTH });
  const importsSrc = renderImports(context.imports);
  const header = fileHeader(target.componentName, "component", target.node.name ?? "");

  const fnSignature = renderFnSignature(destructure, propTypeName);

  const lines = [
    header,
    "",
    `import * as React from "react";`,
    importsSrc,
    "",
    `export type ${propTypeName} = ${propsSig};`,
    "",
    `export function ${target.componentName}(${fnSignature}): React.ReactElement {`,
    `  return (`,
    body,
    `  );`,
    `}`,
    "",
    `export default ${target.componentName};`,
    "",
  ].filter((line) => line !== "");
  return { path: target.filePath, contents: `${lines.join("\n")}\n` };
}

function renderFnSignature(destructure: string, propTypeName: string): string {
  if (destructure.length === 0) {
    return `_props: ${propTypeName} = {}`;
  }
  return `${destructure}: ${propTypeName} = {}`;
}

function pickVariantPropIdent(props: readonly ComponentPropDecl[]): string {
  for (const prop of props) {
    if (prop.kind === "variant") {
      return "variant";
    }
  }
  throw new Error("emit/files: variant component without a variant prop");
}
