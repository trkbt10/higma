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
import { guidToString } from "@higma-document-models/fig/domain";
import type { ComponentPropDecl, ComponentTarget, EmitFile, EmitRegistry, FrameTarget } from "../types";
import type { EmitContext } from "./jsx";
import { emitFrameJsx } from "./jsx";
import type { TokenIndex } from "../../tokens";
import type { FigDocumentContext } from "@higma-document-io/fig/context";
import type { ImageResolver } from "../style/paint";
import type { PropBindings } from "../plan/prop-bindings";
import { buildPropBindings } from "../plan/prop-bindings";
import { collectAuthoredTextOverridesByGuid } from "../plan/registry";
import { buildReparentResult } from "../layout/reparent";
import { applyRowClustering } from "../layout/cluster";
import { buildLiquidOverlay, type LiquidOverlay } from "../layout/liquid";
import { serialize as serializeJsx } from "../../lib/jsx-tree/serialize";
import type { AssetStrategy, CssImportStrategy, CssMode, ExportStyle, LayoutSizing, VariantStrategy } from "../orchestrate";
import type { IconRegistry } from "../assets/icons";
import type { JsxNode } from "../../lib/jsx-tree/types";
import {
  buildCssModuleFile,
  createCssModulesCollector,
  cssModuleImportLine,
  rewriteForCssModules,
  type CssModulesCollector,
} from "../style/strategy/css-modules";
import {
  blockSlugFromName,
  externalStylesheetImport,
  rewriteForExternalCss,
  type ExternalCssRegistry,
} from "../style/strategy/external-css";
import { rewriteForTailwind } from "../style/strategy/tailwind";

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
  /**
   * Output strategy for the React component declaration. The orchestrator
   * resolves the user-facing option (defaulting to `"function-default"`)
   * and passes the concrete value here so this module never has to
   * apply its own default.
   */
  readonly exportStyle: ExportStyle;
  /**
   * CSS delivery mode. The orchestrator rejects modes not yet
   * implemented (`tailwind`), so this code path only ever sees
   * `inline`, `css-modules`, or `external-css`.
   */
  readonly cssMode: CssMode;
  /**
   * Side-effect import wiring for `external-css`. Ignored for other
   * CSS modes. The orchestrator defaults this to `"direct"`.
   */
  readonly cssImport: CssImportStrategy;
  /**
   * Shared external-css registry — present iff `cssMode ===
   * "external-css"`. Every component / page emit calls
   * `forBlock(<component-slug>)` to obtain a collector that contributes
   * rules to the run-wide stylesheet.
   */
  readonly externalCssRegistry: ExternalCssRegistry | undefined;
  /**
   * Path of the run-wide stylesheet relative to the output root,
   * referenced from TSX `import` statements in `external-css` mode.
   * `undefined` is a contract violation when `cssMode === "external-css"`
   * but allowed for other modes (the value is never read there).
   */
  readonly externalStylesheetPath: string;
  /**
   * How Variant Sets land in the generated output. See
   * `VariantStrategy` in `emit/orchestrate.ts`.
   */
  readonly variantStrategy: VariantStrategy;
  /**
   * Asset-output strategy for vector subtrees. See `AssetStrategy`.
   * The JSX emitter consults this together with `iconRegistry` and
   * `assetComplexityThreshold` to externalise complex icons.
   */
  readonly assetStrategy: AssetStrategy;
  /**
   * Complexity threshold above which a vector subtree externalises
   * to `assets/icons/<slug>.svg`. Ignored when
   * `assetStrategy !== "externalize-complex"`.
   */
  readonly assetComplexityThreshold: number;
  /**
   * Shared registry that collects externalised vector subtrees as
   * `.svg` files. Present iff `assetStrategy === "externalize-complex"`;
   * the orchestrator's `EmitResult.assets` aggregates the registry's
   * collected entries alongside image assets.
   */
  readonly iconRegistry: IconRegistry | undefined;
  /**
   * Sizing regime for the inferred layout. `"liquid"` makes
   * `makeContext` build a per-node relative-sizing overlay the JSX
   * emitter consults to emit `%` instead of `px`; `"fixed"` leaves
   * the overlay empty so emission is byte-identical to before.
   */
  readonly layoutSizing: LayoutSizing;
};

const EMPTY_BINDINGS: PropBindings = new Map();

function buildLayoutOverlay(source: FigDocumentContext, rootNode: FigNode): EmitContext["reparent"] {
  // Reparent first (image-to-fig flat-tree repair), then row-cluster on
  // top of the reparent overlay so the clustering pass operates on the
  // already-corrected children list.
  const base = buildReparentResult(rootNode, source.document.childrenOf);
  const childrenByParent = new Map(base.childrenByParent);
  const transformByGuid = new Map(base.transformByGuid);
  applyRowClustering(rootNode, childrenByParent, transformByGuid, source.document.childrenOf);
  return { childrenByParent, transformByGuid };
}

function makeContext(
  source: FigDocumentContext,
  registry: EmitRegistry,
  index: TokenIndex,
  emittingFile: string,
  opts: EmitOpts,
  propBindings: PropBindings,
  rootNode: FigNode,
  rootKind: "page" | "component",
): EmitContext {
  const overrides = collectAuthoredTextOverridesByGuid(source, rootNode);
  const distinctCount = new Map<string, number>();
  for (const [key, values] of overrides) {
    distinctCount.set(key, values.size);
  }
  // The reparent/cluster overlay must be built once and shared: the
  // liquid pass reads children through the SAME overlay-aware reader the
  // JSX emitter uses (`childrenOfEmitNode`), so both agree on the tree
  // when computing percentages vs emitting px.
  const reparent = buildLayoutOverlay(source, rootNode);
  const childrenOf = (node: FigNode): readonly FigNode[] => {
    const overlay = reparent.childrenByParent.get(guidToString(node.guid));
    return overlay !== undefined ? overlay : source.document.childrenOf(node);
  };
  const liquidOverlay: LiquidOverlay =
    opts.layoutSizing === "liquid"
      ? buildLiquidOverlay(rootNode, {
          childrenOf,
          // `resolveContainerLayout` only consults these for
          // `absorbBackgroundDecoration` (which reads childrenOf / index /
          // imageResolver) and `inferLayout` (which reads neither), so the
          // absorb-relevant inputs are sufficient to mirror the emitter's
          // layout decision exactly.
          styleInputs: { index, imageResolver: opts.imageResolver, childrenOf },
          rootKind,
        })
      : new Map();
  return {
    source,
    registry,
    index,
    imageResolver: opts.imageResolver,
    emittingFile,
    emittingRootGuid: guidToString(rootNode.guid),
    imports: new Map(),
    debugAttrs: opts.debugAttrs,
    propBindings,
    reparent,
    iconRegistry: opts.iconRegistry,
    assetStrategy: opts.assetStrategy,
    assetComplexityThreshold: opts.assetComplexityThreshold,
    layoutSizing: opts.layoutSizing,
    liquidOverlay,
    authoredTextOverrideDistinctValueCount: distinctCount,
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

/**
 * Emit the React component declaration in the requested export shape.
 *
 * The two forms share function-body lines (`return ( ... );` for plain
 * components, `switch ( ... ) { ... }` for variant sets) but differ in
 * the surrounding declaration:
 *
 *   - `"function-default"`: `export function X(args): React.ReactElement { body }`
 *     followed by a trailing `export default X;`. Preserves the
 *     pre-existing emit shape so the standalone preview / App.tsx
 *     imports (which use the named `import { X } from ...` form anyway)
 *     and any consumer relying on the default export both keep working.
 *
 *   - `"const-named"`: `export const X = (args): React.ReactElement => { body };`.
 *     Drops the default export — the user explicitly asked for this
 *     form so that consumers commit to the named-export-only contract.
 */
export function renderComponentDeclaration(
  componentName: string,
  fnSignature: string,
  bodyLines: readonly string[],
  exportStyle: ExportStyle,
): readonly string[] {
  if (exportStyle === "const-named") {
    return [
      `export const ${componentName} = (${fnSignature}): React.ReactElement => {`,
      ...bodyLines,
      `};`,
    ];
  }
  return [
    `export function ${componentName}(${fnSignature}): React.ReactElement {`,
    ...bodyLines,
    `}`,
    "",
    `export default ${componentName};`,
  ];
}

/**
 * One-pass JSX rewriter bound to a CSS strategy. `inline` returns the
 * identity rewriter; `css-modules` and `external-css` return rewriters
 * that consult their respective collectors.
 *
 * Returning a closure (rather than rewriting in-place) lets the
 * variant-switch path call the rewriter once per variant case while
 * the collector accumulates rules across every case — exactly what
 * the variant-aware emit needs.
 *
 * `cssModulesCollector` is non-undefined only in css-modules mode and
 * carries the per-file rules the caller turns into a sidecar.
 */
type CssStrategyHandle = {
  readonly rewrite: (node: JsxNode) => JsxNode;
  readonly cssModulesCollector: CssModulesCollector | undefined;
};

function externalCssRegistryOf(opts: EmitOpts): ExternalCssRegistry {
  const registry = opts.externalCssRegistry;
  if (registry === undefined) {
    throw new Error(
      "fig-to-web: external-css mode requires an externalCssRegistry on EmitOpts (orchestrator wiring bug)",
    );
  }
  return registry;
}

function createCssStrategy(componentName: string, opts: EmitOpts): CssStrategyHandle {
  if (opts.cssMode === "css-modules") {
    const collector = createCssModulesCollector();
    return {
      rewrite: (node) => rewriteForCssModules(node, collector),
      cssModulesCollector: collector,
    };
  }
  if (opts.cssMode === "external-css") {
    const blockCollector = externalCssRegistryOf(opts).forBlock(blockSlugFromName(componentName));
    return {
      rewrite: (node) => rewriteForExternalCss(node, blockCollector),
      cssModulesCollector: undefined,
    };
  }
  if (opts.cssMode === "tailwind") {
    return {
      rewrite: rewriteForTailwind,
      cssModulesCollector: undefined,
    };
  }
  return {
    rewrite: (node) => node,
    cssModulesCollector: undefined,
  };
}

/**
 * Render the stylesheet-import line for the TSX file's prelude.
 *
 * - `"css-modules"`: `import classes from "./X.module.css";`
 * - `"external-css"` with `cssImport: "direct"`: `import "./styles.css";`
 *   (specifier is relative to the TSX file's directory).
 * - `"external-css"` with `cssImport: "external"` or any other mode:
 *   empty string. The `.filter(…)` join in the file emitter drops
 *   the blank.
 */
function cssImportFor(tsxFilePath: string, opts: EmitOpts): string {
  if (opts.cssMode === "css-modules") {
    return cssModuleImportLine(tsxFilePath);
  }
  if (opts.cssMode === "external-css") {
    return externalStylesheetImport(tsxFilePath, opts.externalStylesheetPath, opts.cssImport);
  }
  return "";
}

/**
 * Append the CSS-Modules sidecar to a list of TSX EmitFiles when
 * the strategy collected at least one rule. The sidecar lives next
 * to the TSX at the same path with `.tsx` swapped for `.module.css`.
 * external-css mode has no per-file sidecar (one global stylesheet
 * lives at the output root), so this routine is a no-op there.
 */
function appendCssSidecar(
  files: EmitFile[],
  tsxFilePath: string,
  collector: CssModulesCollector | undefined,
): readonly EmitFile[] {
  if (!collector) {
    return files;
  }
  const sidecar = buildCssModuleFile(tsxFilePath, collector);
  if (sidecar) {
    files.push(sidecar);
  }
  return files;
}

/** Render TSX + optional sidecar `.module.css` for a target page (top-level Figma frame). */
export function emitPageFile(
  source: FigDocumentContext,
  registry: EmitRegistry,
  index: TokenIndex,
  target: FrameTarget,
  opts: EmitOpts,
): readonly EmitFile[] {
  // Pages have no typed component props — they are not bound to a
  // SYMBOL — so `EMPTY_BINDINGS` lets the JSX emitter render
  // hard-coded TEXT characters verbatim.
  const context = makeContext(source, registry, index, target.filePath, opts, EMPTY_BINDINGS, target.node, "page");
  const rawBodyNode = emitFrameJsx(target.node, context, "page-root");
  const strategy = createCssStrategy(target.componentName, opts);
  const bodyNode = strategy.rewrite(rawBodyNode);
  const cssModulesCollector = strategy.cssModulesCollector;
  const body = serializeJsx(bodyNode, { depth: JSX_BODY_DEPTH });
  const importsSrc = renderImports(context.imports);
  const cssImportLine = cssImportFor(target.filePath, opts);
  const header = fileHeader(target.componentName, "page", target.node.name ?? "");
  const propTypeName = renderPropTypeName(target.componentName);

  const declaration = renderComponentDeclaration(
    target.componentName,
    `_props: ${propTypeName} = {}`,
    [
      `  return (`,
      body,
      `  );`,
    ],
    opts.exportStyle,
  );

  const lines = [
    header,
    "",
    `import * as React from "react";`,
    importsSrc,
    cssImportLine,
    "",
    `export type ${propTypeName} = Record<string, never>;`,
    "",
    ...declaration,
    "",
  ].filter((line) => line !== "");

  const tsxFile: EmitFile = { path: target.filePath, contents: `${lines.join("\n")}\n` };
  return appendCssSidecar([tsxFile], target.filePath, cssModulesCollector);
}

function emitVariantSwitch(
  source: FigDocumentContext,
  registry: EmitRegistry,
  index: TokenIndex,
  target: ComponentTarget,
  context: EmitContext,
  rewrite: (node: JsxNode) => JsxNode,
): string {
  const cases: string[] = [];
  for (const [value, variantNode] of target.variants) {
    cases.push(emitVariantCase(source, registry, index, value, variantNode, context, rewrite));
  }
  return cases.join("\n");
}

function emitVariantCase(
  _source: FigDocumentContext,
  _registry: EmitRegistry,
  _index: TokenIndex,
  variantValue: string,
  variantNode: FigNode,
  context: EmitContext,
  rewrite: (node: JsxNode) => JsxNode,
): string {
  // Delegate to the same component-root path that single-variant
  // components and pages use. The previous bespoke wrapper only
  // emitted `position / width / height`, dropping the variant
  // SYMBOL's authored auto-layout (`stackMode`, alignment, padding)
  // — which is exactly what gives YouTube's pill chips their
  // centered text against a rounded background. Reusing
  // `emitFrameJsx` keeps the variant case in lockstep with every
  // other "wrap a single root frame in a `<div>`" call site.
  const rawFrameNode = emitFrameJsx(variantNode, context, "component-root");
  // Every variant case threads through the SAME strategy rewriter so
  // the per-file `.module.css` (in css-modules mode) or run-wide
  // `styles.css` (in external-css mode) covers every variant branch.
  // The identity rewriter applies for inline mode.
  const frameNode = rewrite(rawFrameNode);
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

/**
 * Sanitise a variant value (free-text Figma string like `"On"`,
 * `"Heart Filled"`, or `"Property 1=Off"`) into a PascalCase suffix
 * that concatenates onto a component name (`Button` + `On` →
 * `ButtonOn`). Non-alphanumerics drop; word boundaries trigger an
 * uppercase. Multi-property variants land as one long PascalCase
 * string — accepted shape, given Figma already requires authors to
 * disambiguate variants by hand.
 *
 * Throws when the input yields no alphanumerics. An empty suffix
 * would silently collapse `ButtonOn` and `Button` onto the same
 * component name and overwrite the barrel; fail loudly so the
 * caller fixes the source variant value (Figma's authoring tool
 * already requires non-empty variant names, so this fires only on
 * malformed input from external tooling).
 */
function variantSuffixPascal(value: string): string {
  const suffix = value
    .split(/[^A-Za-z0-9]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
  if (suffix.length === 0) {
    throw new Error(
      `variant-explosion: variant value "${value}" yields no usable PascalCase suffix. ` +
      `The component name (\`<Set><Suffix>\`) requires at least one alphanumeric character ` +
      `in the variant value.`,
    );
  }
  return suffix;
}

/**
 * Sanitise a variant value into a kebab-case slug suitable for use
 * in a filename. Mirrors `variantSuffixPascal` but lowercases and
 * keeps hyphen separators so the resulting file path stays readable
 * (`Button-on.tsx`, `Button-heart-filled.tsx`).
 *
 * Throws on empty input for the same reason `variantSuffixPascal`
 * does — an empty kebab suffix would produce `Button-.tsx` and
 * collide with sibling files.
 */
function variantSuffixKebab(value: string): string {
  const slug = value
    .split(/[^A-Za-z0-9]+/)
    .filter((segment) => segment.length > 0)
    .join("-")
    .toLowerCase();
  if (slug.length === 0) {
    throw new Error(
      `variant-explosion: variant value "${value}" yields no usable kebab slug. ` +
      `The per-variant file path requires at least one alphanumeric character.`,
    );
  }
  return slug;
}

/**
 * Compute the file path for one exploded variant of a variant set.
 *
 *   `components/Design/Button.tsx`, variant `"On"`
 *     → `components/Design/Button-on.tsx`
 */
function variantFilePath(originalPath: string, variantValue: string): string {
  const slug = variantSuffixKebab(variantValue);
  return originalPath.replace(/\.tsx$/, `-${slug}.tsx`);
}

/**
 * Emit the per-variant component files for an exploded variant set.
 *
 * Each variant becomes a standalone React component whose body
 * renders its variant SYMBOL through the same code path single-variant
 * components use. The variant axis is removed from the prop set —
 * the choice is already baked into the component identity.
 *
 * Recurses into `emitComponentFile` with a synthesised `ComponentTarget`
 * that has empty `variants` (so the recursion takes the non-variant
 * branch). The shared CSS strategy (external-css registry, css-modules
 * collector created per-call) flows through `opts` and continues to
 * aggregate correctly across the recursive calls.
 */
function emitExplodedVariantFiles(
  source: FigDocumentContext,
  registry: EmitRegistry,
  index: TokenIndex,
  target: ComponentTarget,
  opts: EmitOpts,
): readonly EmitFile[] {
  const out: EmitFile[] = [];
  const nonVariantProps = target.props.filter((decl) => decl.kind !== "variant");
  for (const [variantValue, variantNode] of target.variants) {
    const variantSuffix = variantSuffixPascal(variantValue);
    const variantComponentName = `${target.componentName}${variantSuffix}`;
    const variantTarget: ComponentTarget = {
      ...target,
      node: variantNode,
      componentName: variantComponentName,
      filePath: variantFilePath(target.filePath, variantValue),
      variants: new Map(),
      props: nonVariantProps,
    };
    for (const file of emitComponentFile(source, registry, index, variantTarget, opts)) {
      out.push(file);
    }
  }
  return out;
}

/**
 * Emit the barrel file for an exploded variant set.
 *
 * The barrel imports each per-variant component and exposes a
 * runtime switcher (`Button({variant, ...rest})`) so consumers who
 * select a variant dynamically still have one entry point. The
 * individual `ButtonOn` / `ButtonOff` files give consumers who know
 * the variant at import time the tree-shake-friendly direct import.
 *
 * Re-exports each variant component by name so a downstream caller
 * who imports `{ Button, ButtonOn }` from `./Button` resolves both.
 */
function emitVariantBarrelFile(
  target: ComponentTarget,
  opts: EmitOpts,
): EmitFile {
  const header = fileHeader(target.componentName, "component", target.node.name ?? "");
  const propsSig = renderPropsTypeBody(target.props);
  const propTypeName = renderPropTypeName(target.componentName);
  const destructure = renderDestructure(target.props);
  const fnSignature = renderFnSignature(destructure, propTypeName);
  const switchProp = pickVariantPropIdent(target.props);

  const variantEntries = [...target.variants.keys()].map((value) => {
    const suffix = variantSuffixPascal(value);
    return {
      variantValue: value,
      componentName: `${target.componentName}${suffix}`,
      importPath: `./${target.componentName}-${variantSuffixKebab(value)}`,
    };
  });

  const importLines = variantEntries.map(
    (entry) => `import { ${entry.componentName} } from ${JSON.stringify(entry.importPath)};`,
  );
  const reexportLine = buildReexportLine(variantEntries);

  // Spread the non-variant props to each variant component so any
  // typed prop the variant set declared on top of the variant axis
  // (a TEXT label, a boolean toggle) propagates verbatim to the
  // chosen component.
  const nonVariantProps = target.props.filter((decl) => decl.kind !== "variant");
  const spreadProps = buildSpreadPropsAttrs(nonVariantProps);
  const switchCases = variantEntries.map((entry) => [
    `    case ${JSON.stringify(entry.variantValue)}:`,
    `      return <${entry.componentName}${spreadProps} />;`,
  ].join("\n"));

  const declaration = renderComponentDeclaration(
    target.componentName,
    fnSignature,
    [
      `  switch (${switchProp}) {`,
      ...switchCases,
      `  }`,
    ],
    opts.exportStyle,
  );

  const lines = [
    header,
    "",
    `import * as React from "react";`,
    ...importLines,
    "",
    `export type ${propTypeName} = ${propsSig};`,
    "",
    ...declaration,
    "",
    reexportLine,
    "",
  ].filter((line) => line !== "");

  return { path: target.filePath, contents: `${lines.join("\n")}\n` };
}

/**
 * Render a single non-variant prop into a JSX spread-style attribute
 * for the barrel's `<VariantComponent ... />` invocation.
 *
 * The destructure pattern in the barrel function signature already
 * carries each prop as a local binding (`label`, `isPressed`, …); the
 * barrel just forwards them. JS identifier-safe names pass through;
 * non-identifier names use the `"Property 1": p1Name` rename the
 * destructure also applies (see `jsIdentForKey`).
 */
/**
 * Build the `export { ... };` re-export line listing every per-variant
 * component name. Returns an empty string when there are no
 * entries — the `.filter((line) => line !== "")` join in the file
 * emitter drops it. Extracted to avoid an inline ternary that the
 * project's lint rule prohibits.
 */
function buildReexportLine(
  entries: readonly { readonly componentName: string }[],
): string {
  if (entries.length === 0) {
    return "";
  }
  return `export { ${entries.map((e) => e.componentName).join(", ")} };`;
}

/**
 * Build the JSX attribute string the barrel uses to forward
 * non-variant props to the chosen per-variant component
 * (`<ButtonOn label={label} isPressed={isPressed} />`). Empty when
 * the variant set has only the variant axis. Leading space is
 * included so callers can concatenate without padding.
 */
function buildSpreadPropsAttrs(decls: readonly ComponentPropDecl[]): string {
  if (decls.length === 0) {
    return "";
  }
  return ` ${decls.map(spreadEntry).join(" ")}`;
}

function spreadEntry(decl: ComponentPropDecl): string {
  const propName = decl.name;
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(propName)) {
    return `${propName}={${propName}}`;
  }
  const camel = propName
    .split(/[^A-Za-z0-9]+/)
    .filter((s) => s.length > 0)
    .map((s, i) => (i === 0 ? s.charAt(0).toLowerCase() : s.charAt(0).toUpperCase()) + s.slice(1).toLowerCase())
    .join("");
  const safe = /^[0-9]/.test(camel) ? `p${camel}` : camel;
  return `${propName}={${safe}}`;
}

/** Render TSX + optional sidecar `.module.css` for a referenced SYMBOL / variant-set target. */
export function emitComponentFile(
  source: FigDocumentContext,
  registry: EmitRegistry,
  index: TokenIndex,
  target: ComponentTarget,
  opts: EmitOpts,
): readonly EmitFile[] {
  // Build the descendant-guid → prop binding map from the component
  // target's typed props. The JSX emitter consults this when rendering
  // each TEXT node so a `componentPropRefs(TEXT_DATA)` slot reads
  // `{label}` instead of the SYMBOL-default literal.
  const bindings = buildPropBindings(target, source.document);
  const context = makeContext(source, registry, index, target.filePath, opts, bindings, target.node, "component");
  const isVariantSet = target.variants.size > 0;

  // Variant-set explosion: emit one standalone file per variant plus
  // a barrel. Exploded mode short-circuits the discriminated-emit
  // path below — the per-variant calls go through the
  // non-variant branch via `emitExplodedVariantFiles`, and the
  // barrel is a thin switcher that imports them.
  if (isVariantSet && opts.variantStrategy === "exploded") {
    const variantFiles = emitExplodedVariantFiles(source, registry, index, target, opts);
    return [...variantFiles, emitVariantBarrelFile(target, opts)];
  }

  const propsSig = renderPropsTypeBody(target.props);
  const propTypeName = renderPropTypeName(target.componentName);
  const destructure = renderDestructure(target.props);

  // One strategy handle shared across every variant case for a
  // variant set so per-file (`.module.css`) and run-wide (`styles.css`)
  // collectors aggregate ALL branches together.
  const strategy = createCssStrategy(target.componentName, opts);
  const cssImportLine = cssImportFor(target.filePath, opts);
  const header = fileHeader(target.componentName, "component", target.node.name ?? "");
  const fnSignature = renderFnSignature(destructure, propTypeName);

  if (isVariantSet) {
    const switchProp = pickVariantPropIdent(target.props);
    const body = emitVariantSwitch(source, registry, index, target, context, strategy.rewrite);
    const importsSrc = renderImports(context.imports);

    const declaration = renderComponentDeclaration(
      target.componentName,
      fnSignature,
      [
        `  switch (${switchProp}) {`,
        body,
        `  }`,
      ],
      opts.exportStyle,
    );

    const lines = [
      header,
      "",
      `import * as React from "react";`,
      importsSrc,
      cssImportLine,
      "",
      `export type ${propTypeName} = ${propsSig};`,
      "",
      ...declaration,
      "",
    ].filter((line) => line !== "");
    const tsxFile: EmitFile = { path: target.filePath, contents: `${lines.join("\n")}\n` };
    return appendCssSidecar([tsxFile], target.filePath, strategy.cssModulesCollector);
  }

  const rawBodyNode = emitFrameJsx(target.node, context, "component-root");
  const bodyNode = strategy.rewrite(rawBodyNode);
  const body = serializeJsx(bodyNode, { depth: JSX_BODY_DEPTH });
  const importsSrc = renderImports(context.imports);

  const declaration = renderComponentDeclaration(
    target.componentName,
    fnSignature,
    [
      `  return (`,
      body,
      `  );`,
    ],
    opts.exportStyle,
  );

  const lines = [
    header,
    "",
    `import * as React from "react";`,
    importsSrc,
    cssImportLine,
    "",
    `export type ${propTypeName} = ${propsSig};`,
    "",
    ...declaration,
    "",
  ].filter((line) => line !== "");
  const tsxFile: EmitFile = { path: target.filePath, contents: `${lines.join("\n")}\n` };
  return appendCssSidecar([tsxFile], target.filePath, strategy.cssModulesCollector);
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
