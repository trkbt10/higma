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
import type {
  FigNode,
  FigComponentPropDef,
  FigVariantPropSpec,
  FigKiwiSymbolOverride,
} from "@higma-document-models/fig/types";
import {
  findNodeByGuid,
  getNodeType,
  guidToString,
  type FigKiwiDocumentIndex,
} from "@higma-document-models/fig/domain";
import { isVariantSetFrame } from "@higma-document-models/fig/symbols";
import type { ComponentPropDecl, ComponentTarget, EmitRegistry, FrameTarget } from "../types";
import type { FigDocumentContext } from "@higma-document-io/fig/context";
import { toCssSlug, toPascalCase, uniqueId, uniqueIdent } from "@higma-primitives/identifier";

/**
 * Resolve the canvas ancestor of a node. Walks up `parentIndex`
 * until the parent is a CANVAS (or until we run out of ancestors).
 * Returns undefined when the node is not part of any canvas — this
 * never happens in well-formed fig files.
 */
function ancestorCanvas(source: FigDocumentContext, node: FigNode): FigNode | undefined {
  return walkAncestors(source, node, (candidate) => getNodeType(candidate) === "CANVAS");
}

function walkAncestors(
  source: FigDocumentContext,
  start: FigNode,
  predicate: (node: FigNode) => boolean,
): FigNode | undefined {
  const seen = new Set<string>();
  return stepUp(source, start, predicate, seen);
}

function stepUp(
  source: FigDocumentContext,
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
  const parent = findNodeByGuid(source.document, parentGuid);
  if (!parent) {
    return undefined;
  }
  return stepUp(source, parent, predicate, seen);
}

/**
 * Determine whether a parent node is a Variant Set root on disk.
 *
 * Delegates to the SoT routine in `@higma-document-models/fig/symbols`
 * so every detection site shares one implementation. See
 * `docs/refactor/component-type-cleanup.md`.
 */
function isVariantSetRoot(node: FigNode): boolean {
  return isVariantSetFrame(node);
}

/**
 * Pick the generated component node for an INSTANCE. SymbolResolver
 * owns INSTANCE → SYMBOL; this function only climbs from that SYMBOL
 * to the variant-set frame when the disk metadata marks one.
 */
function componentNodeForInstance(source: FigDocumentContext, instance: FigNode): FigNode | undefined {
  const symbol = source.symbolResolver.resolveReferences(instance).effectiveSymbol?.node;
  if (symbol === undefined) {
    return undefined;
  }
  const parentGuid = symbol.parentIndex?.guid;
  if (!parentGuid) {
    return symbol;
  }
  const parent = findNodeByGuid(source.document, parentGuid);
  if (parent && isVariantSetRoot(parent)) {
    return parent;
  }
  return symbol;
}

/**
 * Variant value authored on a SYMBOL child of a Variant Set FRAME.
 *
 * `variantPropSpecs` is the disk SoT for which value the SYMBOL
 * represents; the decorative `Prop=Value` naming on the SYMBOL is not
 * load-bearing (Figma reconstructs displayed labels from
 * `componentPropDefs` + `variantPropSpecs`, not from the name) and we
 * must not infer the value from it — see
 * `docs/refactor/component-type-cleanup.md`. A Variant Set child
 * without a `variantPropSpecs` entry is malformed input; fail fast.
 */
function variantValueOf(node: FigNode): string {
  const specs = node.variantPropSpecs as readonly FigVariantPropSpec[] | undefined;
  const first = specs?.[0];
  if (!first?.value) {
    throw new Error(
      `Variant Set child SYMBOL ${node.name ?? "?"} (${guidToString(node.guid)}) is missing variantPropSpecs[0].value; ` +
        `the disk SoT requires every variant SYMBOL to carry its variant value via variantPropSpecs.`,
    );
  }
  return first.value;
}

function findVariantChildren(source: FigDocumentContext, parent: FigNode): readonly FigNode[] {
  const out: FigNode[] = [];
  for (const child of source.document.childrenOf(parent)) {
    if (child.type.name !== "SYMBOL") {
      continue;
    }
    out.push(child);
  }
  return out;
}

function buildVariantMap(source: FigDocumentContext, target: FigNode): ReadonlyMap<string, FigNode> {
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
  for (const child of findVariantChildren(source, target)) {
    const base = variantValueOf(child);
    const taken = counts.get(base) ?? 0;
    counts.set(base, taken + 1);
    const key = taken === 0 ? base : `${base}-${taken + 1}`;
    out.set(key, child);
  }
  return out;
}

export const SYNTHETIC_TEXT_PREFIX = "synthetic-text:";
export const SYNTHETIC_VARIANT_PREFIX = "synthetic-variant:";

/**
 * Build the JS identifier used as the React prop name for a
 * synthetic text override. We embed both halves of the Figma guid so
 * the same descendant guid round-trips to the same prop name across
 * INSTANCE call sites and the SYMBOL declaration.
 */
export function syntheticTextPropName(guidStr: string): string {
  return `text_${guidStr.replace(":", "_")}`;
}

export function syntheticVariantPropName(guidStr: string): string {
  return `variant_${guidStr.replace(":", "_")}`;
}

/**
 * Walk the SYMBOL (or every variant of a variant set) and add a
 * synthetic `string` prop for every TEXT descendant. Figma authors
 * routinely override the visible characters of a TEXT node on each
 * INSTANCE without declaring a typed `componentPropDefs` slot for
 * it. The call-site emitter reads the resolved INSTANCE output from
 * SymbolResolver and supplies these synthetic props when the resolved
 * TEXT value differs from the SYMBOL's authored default.
 *
 * We deduplicate by descendant guid so the same TEXT inside multiple
 * variants only contributes one prop. The default value is the
 * SYMBOL's authored characters (from the first variant we encounter)
 * so an INSTANCE that *doesn't* override the descendant still
 * renders the authored copy.
 */
function augmentWithImplicitTextProps(
  source: FigDocumentContext,
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
  const roots: readonly FigNode[] = variants.size === 0 ? [target] : [...findVariantChildren(source, target)];
  for (const root of roots) {
    const overrideChars = collectAuthoredTextOverridesByGuid(source, root);
    visitTextDescendants(source, root, (text) => {
      const guidStr = guidToString(text.guid);
      if (seen.has(guidStr)) {
        return;
      }
      seen.add(guidStr);
      const defId = `${SYNTHETIC_TEXT_PREFIX}${guidStr}`;
      if (declared.has(defId)) {
        return;
      }
      const overrideSet = overrideChars.get(guidStr);
      const firstOverride = overrideSet ? overrideSet.values().next().value : undefined;
      const characters = firstOverride ?? readTextCharacters(text);
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

/**
 * Index, by inner-descendant guid, the textData overrides authored
 * on every INSTANCE descendant of `root`. Each guid is recorded
 * with the set of distinct override characters that the SYMBOL
 * body's authors wrote for it. Used by both:
 *
 *   - prop-default selection (registry): if exactly one distinct
 *     value, that is the SYMBOL's authored default for the prop.
 *   - sibling-distinct detection (jsx emit): when more than one
 *     distinct value exists, the SYMBOL body's sibling INSTANCEs
 *     are intentionally different and the inner-INSTANCE call sites
 *     must bake the literal each, instead of forwarding a single
 *     outer prop that cannot represent more than one value at once.
 */
export function collectAuthoredTextOverridesByGuid(
  source: FigDocumentContext,
  root: FigNode,
): ReadonlyMap<string, ReadonlySet<string>> {
  const out = new Map<string, Set<string>>();
  // First pass: collect every authored textData override, keyed by
  // the *resolved* TEXT descendant's guid (not the raw guidPath
  // last entry — Figma may write a stale/external guid there when
  // the override's slot was inherited from a different session, and
  // the resolver's payload-matching fallback substitutes the
  // SYMBOL's actual TEXT descendant at runtime). Without re-keying
  // here, the registry's distinct-value counter and the JSX emitter
  // both lose visibility into the override and treat the call site
  // as if it never wrote anything.
  function recordOverrideForInstance(instance: FigNode, override: FigKiwiSymbolOverride): void {
    const guids = override.guidPath?.guids;
    if (!guids || guids.length === 0) {
      return;
    }
    const characters = override.textData?.characters;
    if (typeof characters !== "string") {
      return;
    }
    const targetGuidStr = resolveOverrideTextTargetGuid(instance, override, source);
    if (targetGuidStr === undefined) {
      return;
    }
    const set = out.get(targetGuidStr) ?? new Set<string>();
    set.add(characters);
    out.set(targetGuidStr, set);
  }
  function visit(node: FigNode): void {
    if (node.type?.name === "INSTANCE") {
      const overrides = node.symbolData?.symbolOverrides ?? [];
      for (const override of overrides) {
        recordOverrideForInstance(node, override);
      }
    }
    for (const child of source.document.childrenOf(node)) {
      visit(child);
    }
  }
  visit(root);
  // Second pass: when a SYMBOL body has multiple sibling INSTANCEs
  // that all reach the same TEXT guid through their resolution
  // (different `symbolOverrides[].guidPath[0]`s, same final guid)
  // and only SOME of them override the descendant, the un-overridden
  // siblings still render the SYMBOL default. Include that default
  // in the distinct-value set so the emitter's call-site decision
  // (forward outer prop vs. bake literal) sees the real value
  // diversity. Without it, two siblings — one rendered as
  // "よくある質問" (default), one overridden to "お問い合わせ" —
  // look identical to one with a single override, and the
  // forwarding path collapses both to a single outer prop.
  collectImpliedDefaultsForOverriddenSiblings(source, root, out);
  return out;
}

function collectImpliedDefaultsForOverriddenSiblings(
  source: FigDocumentContext,
  root: FigNode,
  out: Map<string, Set<string>>,
): void {
  function visit(node: FigNode): void {
    const children = source.document.childrenOf(node);
    // For each container, group its direct INSTANCE children by
    // their referenced symbolID. Within each group, if at least
    // one sibling overrides a TEXT and another doesn't, the
    // un-overriding sibling renders the SYMBOL default for that
    // TEXT; that default is also a real authored value to track.
    const groups = new Map<string, FigNode[]>();
    for (const child of children) {
      if (child.type?.name !== "INSTANCE") {
        continue;
      }
      const sid = child.symbolData?.symbolID;
      if (!sid) {
        continue;
      }
      const key = guidToString(sid);
      const arr = groups.get(key) ?? [];
      arr.push(child);
      groups.set(key, arr);
    }
    for (const [, siblings] of groups) {
      if (siblings.length < 2) {
        continue;
      }
      const overriddenGuids = new Set<string>();
      // Per-sibling map keyed by resolved TEXT guid → did this
      // sibling actually authore the override at runtime. Needed
      // below so the no-override siblings get their resolved
      // SYMBOL-default characters added to the distinct set.
      const overrideByInstance = new Map<FigNode, Set<string>>();
      for (const inst of siblings) {
        const overrides = inst.symbolData?.symbolOverrides ?? [];
        const set = new Set<string>();
        for (const override of overrides) {
          if (typeof override.textData?.characters !== "string") {
            continue;
          }
          const targetGuidStr = resolveOverrideTextTargetGuid(inst, override, source);
          if (targetGuidStr === undefined) {
            continue;
          }
          overriddenGuids.add(targetGuidStr);
          set.add(targetGuidStr);
        }
        overrideByInstance.set(inst, set);
      }
      for (const guidStr of overriddenGuids) {
        for (const inst of siblings) {
          const siblingOverrides = overrideByInstance.get(inst);
          if (siblingOverrides?.has(guidStr) === true) {
            continue;
          }
          // This sibling does not override the guid; record the
          // resolved SYMBOL default for it. Resolution may fail
          // for external library references — skip silently in
          // that case (the explicit overrides already capture
          // whatever distinct values exist among siblings).
          try {
            const resolved = source.symbolResolver.resolveInstance(inst);
            const defaultChars = findResolvedTextCharacters(resolved.children, guidStr, source);
            if (defaultChars !== undefined) {
              const set = out.get(guidStr) ?? new Set<string>();
              set.add(defaultChars);
              out.set(guidStr, set);
            }
          } catch {
            // ignore unresolvable references
          }
        }
      }
    }
    for (const child of children) {
      visit(child);
    }
  }
  visit(root);
}

/**
 * Resolve the SYMBOL-relative target of a textData override to the
 * guid of the TEXT descendant the resolver actually applies it to.
 *
 * The override's `guidPath` typically names the SYMBOL author's
 * own descendant guids, but a .fig may carry stale paths (e.g. when
 * a SYMBOL slot was inherited from another file the path stores
 * that file's session id and our SYMBOL body's TEXT has a different
 * guid). The resolver's payload-matching fallback substitutes the
 * SYMBOL's actual TEXT at runtime; this helper mirrors that
 * substitution so registry collectors key by the same guid the
 * runtime resolver will write into.
 */
function resolveOverrideTextTargetGuid(
  instance: FigNode,
  override: FigKiwiSymbolOverride,
  source: FigDocumentContext,
): string | undefined {
  const guids = override.guidPath?.guids;
  if (!guids || guids.length === 0) {
    return undefined;
  }
  const lastGuid = guids[guids.length - 1];
  if (!lastGuid) {
    return undefined;
  }
  const lastKey = guidToString(lastGuid);
  // Fast path: the literal path-tail guid exists somewhere reachable
  // from this INSTANCE's SYMBOL body. The resolver's normal binding
  // path applies and the override keyed off this guid will surface
  // through `propBindings` and `appendResolvedTextProps` naturally.
  if (source.document.nodesByGuid.has(lastKey)) {
    return lastKey;
  }
  // Slow path: the path points at a stale/foreign guid. Resolve the
  // INSTANCE and search for the TEXT descendant whose characters now
  // equal the override's payload — that is the slot the resolver
  // substituted. If exactly one resolved TEXT matches, key by it; if
  // ambiguous or unfound, return undefined and let the override
  // silently drop (the registry's behaviour pre-fix).
  const incomingChars = override.textData?.characters;
  if (typeof incomingChars !== "string") {
    return undefined;
  }
  try {
    const resolved = source.symbolResolver.resolveInstance(instance);
    const matches: string[] = [];
    function visit(nodes: readonly FigNode[]): void {
      for (const node of nodes) {
        if (node.type?.name === "TEXT") {
          const chars = node.textData?.characters;
          if (chars === incomingChars) {
            matches.push(guidToString(node.guid));
          }
        }
        const direct = source.symbolResolver.childrenOfResolvedNode(node);
        if (direct.length > 0) {
          visit(direct);
        }
      }
    }
    visit(resolved.children);
    if (matches.length === 1) {
      return matches[0];
    }
  } catch {
    // ignore unresolvable references
  }
  return undefined;
}

function findResolvedTextCharacters(
  roots: readonly FigNode[],
  guidStr: string,
  source: FigDocumentContext,
  visitedInstances: Set<string> = new Set(),
): string | undefined {
  for (const node of roots) {
    if (node.type?.name === "TEXT" && guidToString(node.guid) === guidStr) {
      const chars = node.textData?.characters;
      if (typeof chars === "string") {
        return chars;
      }
    }
    // The resolver does not attach a `.children` array; walk via the
    // resolver-aware method instead. Materialised INSTANCEs sit at the
    // boundary of their own resolved subtree — re-resolve to descend
    // through them and reach descendants the override targets.
    const direct = source.symbolResolver.childrenOfResolvedNode(node);
    if (direct.length > 0) {
      const inner = findResolvedTextCharacters(direct, guidStr, source, visitedInstances);
      if (inner !== undefined) {
        return inner;
      }
    }
    if (node.type?.name === "INSTANCE") {
      const key = guidToString(node.guid);
      if (visitedInstances.has(key)) {
        continue;
      }
      visitedInstances.add(key);
      try {
        const inner = source.symbolResolver.resolveInstance(node);
        const found = findResolvedTextCharacters(inner.children, guidStr, source, visitedInstances);
        if (found !== undefined) {
          return found;
        }
      } catch {
        // ignore unresolvable references
      }
    }
  }
  return undefined;
}

/**
 * For every INSTANCE descendant of `target` whose referenced SYMBOL
 * belongs to a Variant Set, expose a synthetic variant prop on the
 * outer component so call sites can swap the inner INSTANCE's
 * variant. Figma authors do this with `overriddenSymbolID` overrides
 * on the OUTER INSTANCE (e.g. footer's icon-item INSTANCE swaps the
 * inner BigIcons from "howto" → "FAQ"); without a corresponding
 * React prop, IconItem can only render its SYMBOL-author default
 * variant.
 *
 * Prop default = the variant value the SYMBOL author originally
 * selected (computed from the inner INSTANCE's `symbolID`).
 */
function augmentWithImplicitVariantProps(
  source: FigDocumentContext,
  base: readonly ComponentPropDecl[],
  target: FigNode,
  variants: ReadonlyMap<string, FigNode>,
  documentOverrideTargets: ReadonlySet<string>,
): readonly ComponentPropDecl[] {
  const declared = new Set(base.map((p) => p.defId));
  const out: ComponentPropDecl[] = [...base];
  const seen = new Set<string>();
  const roots: readonly FigNode[] = variants.size === 0 ? [target] : [...findVariantChildren(source, target)];
  for (const root of roots) {
    visitInstanceDescendants(source, root, (instance) => {
      const guidStr = guidToString(instance.guid);
      if (seen.has(guidStr)) {
        return;
      }
      seen.add(guidStr);
      const defId = `${SYNTHETIC_VARIANT_PREFIX}${guidStr}`;
      if (declared.has(defId)) {
        return;
      }
      // Only register a synthetic variant prop when some call site
      // in the entire document overrides this INSTANCE's symbolID.
      // The override may live on an outer INSTANCE in a different
      // SYMBOL body (e.g. icon-item is overridden by call sites in
      // footer), so the check is global. Without any overrides, no
      // consumer needs the swap and the prop would only pollute the
      // signature.
      if (!documentOverrideTargets.has(guidStr)) {
        return;
      }
      const decl = buildSyntheticVariantDecl(source, instance, defId, guidStr);
      if (decl !== undefined) {
        out.push(decl);
      }
    });
  }
  return out;
}

function visitInstanceDescendants(
  source: FigDocumentContext,
  node: FigNode,
  visit: (descendant: FigNode) => void,
): void {
  for (const child of source.document.childrenOf(node)) {
    if (child.type?.name === "INSTANCE") {
      visit(child);
    }
    visitInstanceDescendants(source, child, visit);
  }
}

function buildSyntheticVariantDecl(
  source: FigDocumentContext,
  instance: FigNode,
  defId: string,
  guidStr: string,
): ComponentPropDecl | undefined {
  const symbolGuid = instance.symbolData?.symbolID;
  if (!symbolGuid) {
    return undefined;
  }
  const symbolNode = source.document.nodesByGuid.get(guidToString(symbolGuid));
  if (!symbolNode) {
    return undefined;
  }
  // Variant set root is the SYMBOL's parent when that parent is a
  // variant-set FRAME. Without a variant set, there is no choice to
  // expose, so we skip the synthetic prop entirely.
  const parentGuid = symbolNode.parentIndex?.guid;
  if (!parentGuid) {
    return undefined;
  }
  const parent = source.document.nodesByGuid.get(guidToString(parentGuid));
  if (!parent || !isVariantSetRoot(parent)) {
    return undefined;
  }
  // Enumerate every SYMBOL child of the variant-set root and use its
  // `variantPropSpecs[0].value` (or, when missing, a stable fallback
  // derived from the SYMBOL name) as the variant value the consumer
  // would type from a TypeScript prop.
  const values: string[] = [];
  let defaultValue: string | undefined;
  const siblings = findVariantChildren(source, parent);
  const targetSymbolKey = guidToString(symbolGuid);
  // Use buildVariantMap to mirror how the variant set's own
  // synthetic-variant axis was keyed (handles duplicate value names
  // by suffixing with `-2`, `-3`, …).
  const variantMap = buildVariantMap(source, parent);
  for (const [key, variant] of variantMap) {
    values.push(key);
    if (guidToString(variant.guid) === targetSymbolKey) {
      defaultValue = key;
    }
  }
  if (values.length === 0) {
    return undefined;
  }
  if (defaultValue === undefined) {
    // The instance's symbolID points outside the variant set
    // (deleted variant?). Fall back to the first available key so
    // the prop still has a valid default; the consumer can override.
    defaultValue = values[0];
  }
  void guidStr;
  return {
    kind: "variant",
    name: syntheticVariantPropName(guidToString(instance.guid)),
    defId,
    values,
    defaultValue,
  };
}

function visitTextDescendants(source: FigDocumentContext, node: FigNode, visit: (descendant: FigNode) => void): void {
  visitTextDescendantsInner(source, node, visit, new Set());
}

/**
 * Walk every TEXT descendant under `node`. When the walk hits an
 * INSTANCE, follow `symbolID` and continue inside the referenced
 * SYMBOL's body — INSTANCEs that nest one component inside another
 * (e.g. `icon-item` containing a `button-primary` instance whose
 * own TEXT receives a per-call-site override) need their inner TEXT
 * descendants registered on the *outer* component so the synthetic
 * text prop can carry the per-instance override value across the
 * nested-component boundary.
 *
 * Visited SYMBOL guids are tracked to avoid the cycles a
 * variant-set / cross-referencing SYMBOL graph can introduce.
 */
function visitTextDescendantsInner(
  source: FigDocumentContext,
  node: FigNode,
  visit: (descendant: FigNode) => void,
  visitedSymbolGuids: Set<string>,
): void {
  for (const child of source.document.childrenOf(node)) {
    if (child.type?.name === "TEXT") {
      visit(child);
    }
    visitTextDescendantsInner(source, child, visit, visitedSymbolGuids);
    if (child.type?.name === "INSTANCE") {
      const symbolGuid = child.symbolData?.symbolID;
      if (symbolGuid) {
        const key = guidToString(symbolGuid);
        if (!visitedSymbolGuids.has(key)) {
          visitedSymbolGuids.add(key);
          const symbol = findNodeByGuid(source.document, symbolGuid);
          if (symbol !== undefined) {
            visitTextDescendantsInner(source, symbol, visit, visitedSymbolGuids);
            // Also walk every OTHER variant in the same variant
            // set: a call site at the outer SYMBOL body may swap
            // this INSTANCE's `symbolID` via `overriddenSymbolID`,
            // exposing TEXT descendants that live in a *different*
            // variant's body. Without this, the synthetic text-prop
            // registration misses those TEXTs, and the deep
            // override (e.g. block-features → sub-heading variant
            // swap + TEXT 28:960 to "Management") falls through to
            // the SYMBOL-author default instead of bubbling up to
            // the call site.
            const parentGuid = symbol.parentIndex?.guid;
            if (parentGuid) {
              const parent = findNodeByGuid(source.document, parentGuid);
              if (parent && isVariantSetRoot(parent)) {
                for (const sibling of source.document.childrenOf(parent)) {
                  if (sibling.type?.name !== "SYMBOL") {
                    continue;
                  }
                  const siblingKey = guidToString(sibling.guid);
                  if (visitedSymbolGuids.has(siblingKey)) {
                    continue;
                  }
                  visitedSymbolGuids.add(siblingKey);
                  visitTextDescendantsInner(source, sibling, visit, visitedSymbolGuids);
                }
              }
            }
          }
        }
      }
    }
  }
}

function readTextCharacters(node: FigNode): string | undefined {
  const fromTextData = node.textData?.characters;
  if (typeof fromTextData === "string") {
    return fromTextData;
  }
  return typeof node.characters === "string" ? node.characters : undefined;
}

/**
 * Convert a Figma `componentPropDefs` array plus a sibling-derived
 * variant value list into the generator's typed prop declarations.
 */
function buildPropDecls(
  defs: readonly FigComponentPropDef[] | undefined,
  variants: ReadonlyMap<string, FigNode>,
): readonly ComponentPropDecl[] {
  if (defs === undefined || defs.length === 0) {
    return buildVariantPropDeclFromComponentSet(variants);
  }

  return collapseVariantDecls(
    defs
      .filter((def) => Boolean(def.id) && Boolean(def.name))
      .map((def) => mapPropDef(def, variants))
      .filter((decl): decl is ComponentPropDecl => decl !== undefined),
  );
}

function buildVariantPropDeclFromComponentSet(variants: ReadonlyMap<string, FigNode>): readonly ComponentPropDecl[] {
  if (variants.size === 0) {
    return [];
  }
  const values = [...variants.keys()];
  const defaultValue = values[0];
  if (defaultValue === undefined) {
    throw new Error("fig-to-web: non-empty variant map produced no variant value");
  }
  return [{ kind: "variant", name: "variant", defId: "synthetic", values, defaultValue }];
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
function collapseVariantDecls(decls: readonly ComponentPropDecl[]): readonly ComponentPropDecl[] {
  return decls.reduce<ComponentPropDecl[]>((acc, decl) => {
    if (decl.kind === "variant" && acc.some((existing) => existing.kind === "variant")) {
      return acc;
    }
    return [...acc, decl];
  }, []);
}

function mapPropDef(def: FigComponentPropDef, variants: ReadonlyMap<string, FigNode>): ComponentPropDecl | undefined {
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

function collectInstancesIn(node: FigNode, out: FigNode[], document: FigKiwiDocumentIndex): void {
  collectInstancesWithSymbolBodies(node, out, document, new Set());
}

/**
 * Walk the subtree under `node` and add every INSTANCE we encounter
 * to `out`. When the INSTANCE points at a SYMBOL on disk, also walk
 * the SYMBOL's body — INSTANCEs declared inside a SYMBOL (e.g. the
 * `header` SYMBOL containing `logo-tate`, `menu-sub`, `menu`,
 * `button-icon` instances) are not direct descendants of the page
 * frame, so the page-level walk alone would miss them and the
 * registry would emit empty `<div>`s where those nested components
 * should render. Visited SYMBOL guids are tracked to avoid the
 * cycles a Variant-Set / mutually-referencing SYMBOL graph can form.
 */
function collectInstancesWithSymbolBodies(
  node: FigNode,
  out: FigNode[],
  document: FigKiwiDocumentIndex,
  visitedSymbolGuids: Set<string>,
): void {
  if (node.type.name === "INSTANCE") {
    out.push(node);
    const symbolGuid = node.symbolData?.symbolID;
    if (symbolGuid) {
      const key = guidToString(symbolGuid);
      if (!visitedSymbolGuids.has(key)) {
        visitedSymbolGuids.add(key);
        const symbol = findNodeByGuid(document, symbolGuid);
        if (symbol !== undefined) {
          for (const child of document.childrenOf(symbol)) {
            collectInstancesWithSymbolBodies(child, out, document, visitedSymbolGuids);
          }
        }
      }
    }
  }
  for (const child of document.childrenOf(node)) {
    collectInstancesWithSymbolBodies(child, out, document, visitedSymbolGuids);
  }
}

function canvasSlugFor(source: FigDocumentContext, node: FigNode): string {
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
export function buildRegistry(source: FigDocumentContext, frames: readonly FigNode[]): EmitRegistry {
  const frameRegistry = new Map<string, FrameTarget>();
  const componentRegistry = new Map<string, ComponentTarget>();
  // The React identifier pool is shared between the page-side and
  // component-side registries: a page named "Apps" and a component named
  // "Apps" end up imported into the *same* generated page file, so
  // letting both claim `Apps` produces a JS-level duplicate identifier.
  // Slug pools stay per-registry — page slugs live under `pages/` and
  // component slugs under `components/`, so identical slugs across the
  // two never collide on disk.
  const nameUsed = new Set<string>();
  const frameSlugUsed = new Set<string>();
  const componentSlugUsed = new Set<string>();

  for (const node of frames) {
    const canvasSlug = canvasSlugFor(source, node);
    const baseSlug = toCssSlug(node.name ?? "frame");
    const slugKey = `${canvasSlug}/${baseSlug}`;
    const slug = uniqueId(slugKey, frameSlugUsed).slice(canvasSlug.length + 1);
    const name = uniqueIdent(toPascalCase(node.name ?? "Frame"), nameUsed);
    frameRegistry.set(guidToString(node.guid), {
      node,
      componentName: name,
      filePath: `pages/${canvasSlug}/${slug}.tsx`,
      slug,
      canvasSlug,
    });
  }

  // Precompute the document-wide set of INSTANCE guids that some call
  // site overrides via `overriddenSymbolID`. Components whose
  // descendants are never swapped don't need synthetic variant
  // props on their signature.
  const documentOverrideTargets = collectDocumentOverriddenSymbolIDTargets(source, frames);

  for (const frame of frames) {
    const instances: FigNode[] = [];
    collectInstancesIn(frame, instances, source.document);
    for (const instance of instances) {
      registerInstanceTarget(source, instance, componentRegistry, nameUsed, componentSlugUsed, documentOverrideTargets);
    }
  }

  const imageFillOverrideTargets = collectDocumentImageFillOverrideTargets(source, frames);
  const fontSizeOverrideTargets = collectDocumentFontSizeOverrideTargets(source, frames);
  const visibleOverrideTargets = collectDocumentVisibleOverrideTargets(source, frames);

  return { frames: frameRegistry, components: componentRegistry, imageFillOverrideTargets, fontSizeOverrideTargets, visibleOverrideTargets };
}

/**
 * Descendants any INSTANCE call site in the document toggles
 * `visible` on. SYMBOL bodies emit `display: var(--vis-<guid>, ...)`
 * so wrapper-level CSS can hide the slot per call site.
 */
export function collectDocumentVisibleOverrideTargets(
  source: FigDocumentContext,
  frames: readonly FigNode[],
): ReadonlySet<string> {
  const out = new Set<string>();
  const visited = new Set<string>();
  function visit(node: FigNode): void {
    if (node.type?.name === "INSTANCE") {
      for (const override of node.symbolData?.symbolOverrides ?? []) {
        if (typeof override.visible !== "boolean") {
          continue;
        }
        const guids = override.guidPath?.guids;
        if (!guids || guids.length === 0) {
          continue;
        }
        const targetGuid = guids[guids.length - 1];
        if (!targetGuid) {
          continue;
        }
        out.add(guidToString(targetGuid));
      }
      const symbolGuid = node.symbolData?.symbolID;
      if (symbolGuid) {
        const key = guidToString(symbolGuid);
        if (!visited.has(key)) {
          visited.add(key);
          const symbol = findNodeByGuid(source.document, symbolGuid);
          if (symbol !== undefined) {
            for (const child of source.document.childrenOf(symbol)) {
              visit(child);
            }
          }
        }
      }
    }
    for (const child of source.document.childrenOf(node)) {
      visit(child);
    }
  }
  for (const frame of frames) {
    visit(frame);
  }
  return out;
}

/**
 * TEXT descendants whose `fontSize` is overridden by *some* INSTANCE
 * call site somewhere in the document. The SYMBOL body emit
 * indirects its `font-size` through a CSS variable so the call site
 * can inject the actually-rasterised pixel value (the
 * breakpoint-scaled hero on top-desktop is the canonical case: SYMBOL
 * author=32 px, INSTANCE override=42 px).
 */
export function collectDocumentFontSizeOverrideTargets(
  source: FigDocumentContext,
  frames: readonly FigNode[],
): ReadonlySet<string> {
  const out = new Set<string>();
  const visited = new Set<string>();
  function visit(node: FigNode): void {
    if (node.type?.name === "INSTANCE") {
      for (const override of node.symbolData?.symbolOverrides ?? []) {
        if (typeof override.fontSize !== "number") {
          continue;
        }
        const guids = override.guidPath?.guids;
        if (!guids || guids.length === 0) {
          continue;
        }
        const targetGuid = guids[guids.length - 1];
        if (!targetGuid) {
          continue;
        }
        out.add(guidToString(targetGuid));
      }
      const symbolGuid = node.symbolData?.symbolID;
      if (symbolGuid) {
        const key = guidToString(symbolGuid);
        if (!visited.has(key)) {
          visited.add(key);
          const symbol = findNodeByGuid(source.document, symbolGuid);
          if (symbol !== undefined) {
            for (const child of source.document.childrenOf(symbol)) {
              visit(child);
            }
          }
        }
      }
    }
    for (const child of source.document.childrenOf(node)) {
      visit(child);
    }
  }
  for (const frame of frames) {
    visit(frame);
  }
  return out;
}

export function collectDocumentImageFillOverrideTargets(
  source: FigDocumentContext,
  frames: readonly FigNode[],
): ReadonlySet<string> {
  const out = new Set<string>();
  const visited = new Set<string>();
  function visit(node: FigNode): void {
    if (node.type?.name === "INSTANCE") {
      for (const override of node.symbolData?.symbolOverrides ?? []) {
        const guids = override.guidPath?.guids;
        if (!guids || guids.length === 0) {
          continue;
        }
        const targetGuid = guids[guids.length - 1];
        if (!targetGuid) {
          continue;
        }
        const fps = override.fillPaints;
        if (!fps || fps.length === 0) {
          continue;
        }
        if (!fps.some((fp) => fp.type?.name === "IMAGE")) {
          continue;
        }
        out.add(guidToString(targetGuid));
      }
      const symbolGuid = node.symbolData?.symbolID;
      if (symbolGuid) {
        const key = guidToString(symbolGuid);
        if (!visited.has(key)) {
          visited.add(key);
          const symbol = findNodeByGuid(source.document, symbolGuid);
          if (symbol !== undefined) {
            for (const child of source.document.childrenOf(symbol)) {
              visit(child);
            }
          }
        }
      }
    }
    for (const child of source.document.childrenOf(node)) {
      visit(child);
    }
  }
  for (const frame of frames) {
    visit(frame);
  }
  return out;
}

function collectDocumentOverriddenSymbolIDTargets(
  source: FigDocumentContext,
  frames: readonly FigNode[],
): ReadonlySet<string> {
  const out = new Set<string>();
  const visited = new Set<string>();
  function visit(node: FigNode): void {
    if (node.type?.name === "INSTANCE") {
      for (const override of node.symbolData?.symbolOverrides ?? []) {
        const guids = override.guidPath?.guids;
        if (!guids || guids.length === 0) {
          continue;
        }
        const targetGuid = guids[guids.length - 1];
        if (!targetGuid) {
          continue;
        }
        if (!override.overriddenSymbolID) {
          continue;
        }
        out.add(guidToString(targetGuid));
      }
      const symbolGuid = node.symbolData?.symbolID;
      if (symbolGuid) {
        const key = guidToString(symbolGuid);
        if (!visited.has(key)) {
          visited.add(key);
          const symbol = findNodeByGuid(source.document, symbolGuid);
          if (symbol !== undefined) {
            for (const child of source.document.childrenOf(symbol)) {
              visit(child);
            }
          }
        }
      }
    }
    for (const child of source.document.childrenOf(node)) {
      visit(child);
    }
  }
  for (const frame of frames) {
    visit(frame);
  }
  return out;
}

function registerInstanceTarget(
  source: FigDocumentContext,
  instance: FigNode,
  componentRegistry: Map<string, ComponentTarget>,
  nameUsed: Set<string>,
  componentSlugUsed: Set<string>,
  documentOverrideTargets: ReadonlySet<string>,
): void {
  const target = componentNodeForInstance(source, instance);
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
  const name = uniqueIdent(baseName, nameUsed);
  const variants = buildVariantMap(source, target);
  const baseProps = buildPropDecls(target.componentPropDefs, variants);
  const withText = augmentWithImplicitTextProps(source, baseProps, target, variants);
  const props = augmentWithImplicitVariantProps(source, withText, target, variants, documentOverrideTargets);
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
export function componentTargetForInstance(
  source: FigDocumentContext,
  registry: EmitRegistry,
  instance: FigNode,
): ComponentTarget | undefined {
  const target = componentNodeForInstance(source, instance);
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
  source: FigDocumentContext,
  registry: EmitRegistry,
  instance: FigNode,
): string | undefined {
  const resolved = source.symbolResolver.resolveReferences(instance).effectiveSymbol;
  if (resolved === undefined) {
    return undefined;
  }
  const symbolNode = resolved.node;
  const target = componentTargetForInstance(source, registry, instance);
  if (!target || target.variants.size === 0) {
    return undefined;
  }
  // Match the unique key `buildVariantMap` chose for this SYMBOL by
  // looking it up by guid. Names alone cannot disambiguate when two
  // siblings share a variant value; the map already tracks which
  // SYMBOL ended up at which key, so we just reverse-lookup here.
  const symbolGuidStr = guidToString(resolved.guid);
  for (const [key, variant] of target.variants) {
    if (guidToString(variant.guid) === symbolGuidStr) {
      return key;
    }
  }
  return variantValueOf(symbolNode);
}
