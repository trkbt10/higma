/**
 * @file Build the EmitRegistry — the mapping from fig nodes to the
 * generated React component (file + identifier) they end up in.
 *
 * Pipeline:
 *
 * 1. Index every node's parent so we can answer "is this SYMBOL part
 *    of a variant set?" without walking the tree per-INSTANCE.
 *
 * 2. For each user-selected target frame, register a page entry under
 *    `pages/<canvas-slug>/<frame-slug>.tsx`. Two frames sharing a name
 *    are disambiguated with a `-2` / `-3` suffix.
 *
 * 3. Walk every target's INSTANCE descendants, follow each
 *    `symbolID`, and resolve the *variant set root* — either the
 *    SYMBOL's parent COMPONENT_SET (modern schema) or its parent
 *    FRAME when that FRAME carries a `componentPropDefs` entry of
 *    type VARIANT (older schema, used by the Youtube fixture).
 *
 * The variant-set root is what becomes the React component file:
 * `components/<canvas-slug>/<set-name>.tsx`. The set's variants flow
 * into a `variant` prop with a string-union type. Other props on the
 * set (TEXT / BOOL / NUMBER / etc.) become typed props.
 */
import type { FigNode, FigGuid, FigComponentPropDef, FigVariantPropSpec } from "@higma-document-models/fig/types";
import { getNodeType, guidToString, safeChildren } from "@higma-document-models/fig/domain";
import type { ComponentPropDecl, ComponentTarget, EmitRegistry, FrameTarget } from "../types";
import type { FigSource } from "../../fig-source";
import { toCssSlug, toPascalCase, uniqueId, uniqueIdent } from "@higma-primitives/identifier";

/**
 * Resolve the canvas ancestor of a node. Walks up `parentIndex`
 * until the parent is a CANVAS (or until we run out of ancestors).
 * Returns undefined when the node is not part of any canvas — this
 * never happens in well-formed fig files.
 */
function ancestorCanvas(source: FigSource, node: FigNode): FigNode | undefined {
  return walkAncestors(source, node, (candidate) => getNodeType(candidate) === "CANVAS");
}

function walkAncestors(
  source: FigSource,
  start: FigNode,
  predicate: (node: FigNode) => boolean,
): FigNode | undefined {
  const seen = new Set<string>();
  return stepUp(source, start, predicate, seen);
}

function stepUp(
  source: FigSource,
  node: FigNode,
  predicate: (node: FigNode) => boolean,
  seen: Set<string>,
): FigNode | undefined {
  const id = guidToString(node.guid);
  if (seen.has(id)) {
    return undefined;
  }
  seen.add(id);
  if (predicate(node)) {
    return node;
  }
  const parentGuid = node.parentIndex?.guid;
  if (!parentGuid) {
    return undefined;
  }
  const parent = source.nodesByGuid.get(guidToString(parentGuid));
  if (!parent) {
    return undefined;
  }
  return stepUp(source, parent, predicate, seen);
}

function getSymbolGuid(node: FigNode): FigGuid | undefined {
  if (node.symbolID) {
    return node.symbolID;
  }
  if (node.symbolData?.symbolID) {
    return node.symbolData.symbolID;
  }
  return undefined;
}

/**
 * Determine whether a parent node groups variant children. True when:
 *   - the parent is a literal `COMPONENT_SET`, or
 *   - the parent is a FRAME / COMPONENT carrying `componentPropDefs`
 *     of type VARIANT (older fig schema where variants share a FRAME).
 */
function isVariantSetRoot(node: FigNode): boolean {
  if (node.type.name === "COMPONENT_SET") {
    return true;
  }
  if (!node.componentPropDefs || node.componentPropDefs.length === 0) {
    return false;
  }
  for (const def of node.componentPropDefs) {
    if (def.type?.name === "VARIANT") {
      return true;
    }
  }
  return false;
}

/**
 * Resolve an INSTANCE's component target — either the SYMBOL's
 * variant-set root (when one exists) or the SYMBOL itself.
 */
function resolveInstanceTarget(source: FigSource, instance: FigNode): FigNode | undefined {
  const symbolGuid = getSymbolGuid(instance);
  if (!symbolGuid) {
    return undefined;
  }
  const symbol = source.nodesByGuid.get(guidToString(symbolGuid));
  if (!symbol) {
    return undefined;
  }
  const parentGuid = symbol.parentIndex?.guid;
  if (!parentGuid) {
    return symbol;
  }
  const parent = source.nodesByGuid.get(guidToString(parentGuid));
  if (parent && isVariantSetRoot(parent)) {
    return parent;
  }
  return symbol;
}

/**
 * Variant value as authored on a SYMBOL / COMPONENT. Falls back to a
 * synthetic id only when the SYMBOL has no variantPropSpec at all —
 * this can happen for plain children of a FRAME we mistakenly classify
 * as a variant set, in which case the generator still produces a
 * valid (if dull) variant entry.
 */
function variantValueOf(node: FigNode): string {
  const specs = node.variantPropSpecs as readonly FigVariantPropSpec[] | undefined;
  if (specs && specs.length > 0) {
    const first = specs[0];
    if (first?.value) {
      return first.value;
    }
  }
  const name = node.name ?? "";
  const eq = name.indexOf("=");
  if (eq !== -1) {
    return name.slice(eq + 1).trim();
  }
  return name || "default";
}

function findVariantChildren(parent: FigNode): readonly FigNode[] {
  const out: FigNode[] = [];
  for (const child of safeChildren(parent)) {
    if (child.type.name !== "COMPONENT" && child.type.name !== "SYMBOL") {
      continue;
    }
    out.push(child);
  }
  return out;
}

function buildVariantMap(target: FigNode): ReadonlyMap<string, FigNode> {
  if (!isVariantSetRoot(target)) {
    return new Map();
  }
  // Variant *value* names can collide inside one set (the YouTube
  // Mobile UIKit fixture has two SYMBOLs both labelled
  // `Property 1=Default` under the same FRAME). Silently dropping
  // the duplicates would erase the second SYMBOL's content from the
  // generated component, and INSTANCEs that point at it would route
  // to whichever sibling won the dedup race. Suffix the key with an
  // index when names collide so each SYMBOL gets its own switch
  // case; `variantValueForInstance` reproduces the same suffix from
  // an instance's `symbolID` to keep both sides in sync.
  const out = new Map<string, FigNode>();
  const counts = new Map<string, number>();
  for (const child of findVariantChildren(target)) {
    const base = variantValueOf(child);
    const taken = counts.get(base) ?? 0;
    counts.set(base, taken + 1);
    const key = taken === 0 ? base : `${base}-${taken + 1}`;
    out.set(key, child);
  }
  return out;
}

export const SYNTHETIC_TEXT_PREFIX = "synthetic-text:";

/**
 * Build the JS identifier used as the React prop name for a
 * synthetic text override. We embed both halves of the Figma guid so
 * the same descendant guid round-trips to the same prop name across
 * INSTANCE call sites and the SYMBOL declaration.
 */
export function syntheticTextPropName(guidStr: string): string {
  return `text_${guidStr.replace(":", "_")}`;
}

/**
 * Walk the SYMBOL (or every variant of a variant set) and add a
 * synthetic `string` prop for every TEXT descendant. Figma authors
 * routinely override the visible characters of a TEXT node on each
 * INSTANCE without declaring a typed `componentPropDefs` slot for
 * it — those overrides surface in `instance.symbolData.symbolOverrides`
 * via `textData.characters`. Without an explicit prop, the React
 * component would render the SYMBOL's authored default ("All", "On",
 * …) on every instance.
 *
 * We deduplicate by descendant guid so the same TEXT inside multiple
 * variants only contributes one prop. The default value is the
 * SYMBOL's authored characters (from the first variant we encounter)
 * so an INSTANCE that *doesn't* override the descendant still
 * renders the authored copy.
 */
function augmentWithImplicitTextProps(
  base: readonly ComponentPropDecl[],
  target: FigNode,
  variants: ReadonlyMap<string, FigNode>,
): readonly ComponentPropDecl[] {
  const declared = new Set(base.map((p) => p.defId));
  const out: ComponentPropDecl[] = [...base];
  const seen = new Set<string>();
  // For non-variant components walk descendants of the symbol itself.
  // For a variant set walk EVERY child of the variant-set frame
  // (`findVariantChildren`) — not just `[...variants.values()]`,
  // which is keyed by variant value name and silently drops siblings
  // that happen to share a value (Figma allows two SYMBOLs with
  // value "Default" inside one set; both contribute distinct TEXT
  // descendants the INSTANCE may want to override).
  const roots: readonly FigNode[] =
    variants.size === 0 ? [target] : [...findVariantChildren(target)];
  for (const root of roots) {
    visitTextDescendants(root, (text) => {
      const guidStr = guidToString(text.guid);
      if (seen.has(guidStr)) {
        return;
      }
      seen.add(guidStr);
      const defId = `${SYNTHETIC_TEXT_PREFIX}${guidStr}`;
      if (declared.has(defId)) {
        return;
      }
      const characters = readTextCharacters(text);
      out.push({
        kind: "string",
        name: syntheticTextPropName(guidStr),
        defId,
        defaultValue: characters,
      });
    });
  }
  return out;
}

function visitTextDescendants(node: FigNode, visit: (descendant: FigNode) => void): void {
  for (const child of safeChildren(node)) {
    if (child.type?.name === "TEXT") {
      visit(child);
    }
    visitTextDescendants(child, visit);
  }
}

function readTextCharacters(node: FigNode): string | undefined {
  const td = (node as { readonly textData?: { readonly characters?: string } }).textData;
  if (typeof td?.characters === "string") {
    return td.characters;
  }
  const characters = (node as { readonly characters?: string }).characters;
  return typeof characters === "string" ? characters : undefined;
}

/**
 * Convert a Figma `componentPropDefs` array plus a sibling-derived
 * variant value list into the generator's typed prop declarations.
 */
function buildPropDecls(
  defs: readonly FigComponentPropDef[] | undefined,
  variants: ReadonlyMap<string, FigNode>,
): readonly ComponentPropDecl[] {
  if (!defs || defs.length === 0) {
    if (variants.size === 0) {
      return [];
    }
    const values = [...variants.keys()];
    const fallbackDefault = values[0];
    if (fallbackDefault === undefined) {
      return [];
    }
    return [{ kind: "variant", name: "variant", defId: "synthetic", values, defaultValue: fallbackDefault }];
  }

  return collapseVariantDecls(
    defs
      .filter((def) => Boolean(def.id) && Boolean(def.name))
      .map((def) => mapPropDef(def, variants))
      .filter((decl): decl is ComponentPropDecl => decl !== undefined),
  );
}

/**
 * Figma allows a COMPONENT_SET to declare multiple VARIANT-typed
 * `componentPropDefs` (one per variant axis: "State", "Size", "Color", …).
 * The emit pipeline collapses every axis into a single `variant` prop
 * whose value is the combined variant key produced by `buildVariantMap`
 * (e.g. "State=Hover, Size=Large"). That collapse means we must emit
 * exactly **one** variant declaration in `target.props`; otherwise the
 * `variant = …` destructure pattern contains the same identifier multiple
 * times and the bundle fails with "cannot be bound multiple times in the
 * same parameter list". First-VARIANT-wins for `defId` (used by JSX prop
 * bindings); values come from the variant map regardless.
 *
 * Implemented as `reduce` rather than a `for` + `let` flag so the
 * accumulator's "have we already emitted a variant?" state is encoded in
 * the result array itself — the project's no-`let` lint rule is a
 * structural guard for exactly this kind of imperative dedup-flag pattern.
 */
function collapseVariantDecls(
  decls: readonly ComponentPropDecl[],
): readonly ComponentPropDecl[] {
  return decls.reduce<ComponentPropDecl[]>((acc, decl) => {
    if (decl.kind === "variant" && acc.some((existing) => existing.kind === "variant")) {
      return acc;
    }
    return [...acc, decl];
  }, []);
}

function mapPropDef(
  def: FigComponentPropDef,
  variants: ReadonlyMap<string, FigNode>,
): ComponentPropDecl | undefined {
  if (!def.id || !def.name) {
    return undefined;
  }
  const defId = guidToString(def.id);
  switch (def.type?.name) {
    case "VARIANT":
      return mapVariantPropDef(def.name, defId, variants);
    case "BOOL":
      return { kind: "boolean", name: def.name, defId, defaultValue: def.initialValue?.boolValue };
    case "TEXT":
      return { kind: "string", name: def.name, defId, defaultValue: def.initialValue?.textValue?.characters };
    case "NUMBER":
      return { kind: "number", name: def.name, defId, defaultValue: def.initialValue?.numberValue };
    case "INSTANCE_SWAP":
    case "SLOT":
      return { kind: "node", name: def.name, defId };
    default:
      return undefined;
  }
}

function mapVariantPropDef(
  name: string,
  defId: string,
  variants: ReadonlyMap<string, FigNode>,
): ComponentPropDecl | undefined {
  const values = [...variants.keys()];
  if (values.length === 0) {
    return undefined;
  }
  const defaultValue = values[0];
  if (defaultValue === undefined) {
    return undefined;
  }
  return { kind: "variant", name: "variant", defId, values, defaultValue };
}

function collectInstancesIn(node: FigNode, out: FigNode[]): void {
  if (node.type.name === "INSTANCE") {
    out.push(node);
  }
  for (const child of node.children ?? []) {
    if (child) {
      collectInstancesIn(child, out);
    }
  }
}

function canvasSlugFor(source: FigSource, node: FigNode): string {
  const canvas = ancestorCanvas(source, node);
  if (canvas?.name) {
    return toCssSlug(canvas.name);
  }
  return "root";
}

/**
 * Construct the EmitRegistry for a chosen set of target frames.
 *
 * Two passes are run: one for pages (frames the user picked), then one
 * for the components that those pages reference via INSTANCE.
 */
export function buildRegistry(source: FigSource, frames: readonly FigNode[]): EmitRegistry {
  const frameRegistry = new Map<string, FrameTarget>();
  const componentRegistry = new Map<string, ComponentTarget>();
  const componentNameUsed = new Set<string>();
  const componentSlugUsed = new Set<string>();
  const frameNameUsed = new Set<string>();
  const frameSlugUsed = new Set<string>();

  for (const node of frames) {
    const canvasSlug = canvasSlugFor(source, node);
    const baseSlug = toCssSlug(node.name ?? "frame");
    const slugKey = `${canvasSlug}/${baseSlug}`;
    const slug = uniqueId(slugKey, frameSlugUsed).slice(canvasSlug.length + 1);
    const name = uniqueIdent(toPascalCase(node.name ?? "Frame"), frameNameUsed);
    frameRegistry.set(guidToString(node.guid), {
      node,
      componentName: name,
      filePath: `pages/${canvasSlug}/${slug}.tsx`,
      slug,
      canvasSlug,
    });
  }

  for (const frame of frames) {
    const instances: FigNode[] = [];
    collectInstancesIn(frame, instances);
    for (const instance of instances) {
      registerInstanceTarget(source, instance, componentRegistry, componentNameUsed, componentSlugUsed);
    }
  }

  return { frames: frameRegistry, components: componentRegistry };
}

function registerInstanceTarget(
  source: FigSource,
  instance: FigNode,
  componentRegistry: Map<string, ComponentTarget>,
  componentNameUsed: Set<string>,
  componentSlugUsed: Set<string>,
): void {
  const target = resolveInstanceTarget(source, instance);
  if (!target) {
    return;
  }
  const id = guidToString(target.guid);
  if (componentRegistry.has(id)) {
    return;
  }
  const canvasSlug = canvasSlugFor(source, target);
  const baseSlug = toCssSlug(target.name ?? "component");
  const slugKey = `${canvasSlug}/${baseSlug}`;
  const slug = uniqueId(slugKey, componentSlugUsed).slice(canvasSlug.length + 1);
  const baseName = toPascalCase(target.name ?? "Component");
  const name = uniqueIdent(baseName, componentNameUsed);
  const variants = buildVariantMap(target);
  const baseProps = buildPropDecls(target.componentPropDefs, variants);
  const props = augmentWithImplicitTextProps(baseProps, target, variants);
  componentRegistry.set(id, {
    node: target,
    componentName: name,
    filePath: `components/${canvasSlug}/${slug}.tsx`,
    slug,
    canvasSlug,
    variants,
    props,
  });
}

/** Resolve the component target for an INSTANCE node, or undefined when missing. */
export function lookupInstanceTarget(
  source: FigSource,
  registry: EmitRegistry,
  instance: FigNode,
): ComponentTarget | undefined {
  const target = resolveInstanceTarget(source, instance);
  if (!target) {
    return undefined;
  }
  return registry.components.get(guidToString(target.guid));
}

/**
 * Determine which variant string an INSTANCE selects from its
 * registry component (when that component carries a variant axis).
 * Returns undefined when the component is not a variant set.
 */
export function variantValueForInstance(
  source: FigSource,
  registry: EmitRegistry,
  instance: FigNode,
): string | undefined {
  const symbolGuid = getSymbolGuid(instance);
  if (!symbolGuid) {
    return undefined;
  }
  const symbolNode = source.nodesByGuid.get(guidToString(symbolGuid));
  if (!symbolNode) {
    return undefined;
  }
  const target = lookupInstanceTarget(source, registry, instance);
  if (!target || target.variants.size === 0) {
    return undefined;
  }
  // Match the unique key `buildVariantMap` chose for this SYMBOL by
  // looking it up by guid. Names alone cannot disambiguate when two
  // siblings share a variant value; the map already tracks which
  // SYMBOL ended up at which key, so we just reverse-lookup here.
  const symbolGuidStr = guidToString(symbolGuid);
  for (const [key, variant] of target.variants) {
    if (guidToString(variant.guid) === symbolGuidStr) {
      return key;
    }
  }
  return variantValueOf(symbolNode);
}
