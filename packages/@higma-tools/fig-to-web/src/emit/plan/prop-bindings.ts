/**
 * @file Component-property binding map.
 *
 * Figma's component-property model has three coordinated pieces:
 *
 *   1. SYMBOL / COMPONENT_SET declares typed slots via
 *      `componentPropDefs` (e.g. `{ id, name: "Label", type: TEXT }`).
 *   2. A descendant of the SYMBOL binds itself to a slot via
 *      `componentPropRefs` (Kiwi format, an array of
 *      `{ defID, componentPropNodeField }`) or
 *      `componentPropertyReferences` (string format,
 *      `"<defID>:<fieldName>"`).
 *   3. An INSTANCE supplies the value for a slot via
 *      `componentPropAssignments`.
 *
 * The generator's TEXT emit path needs to know "for this descendant
 * node, which prop drives its visible characters?" so the JSX can
 * read `{label}` instead of the SYMBOL-default literal. Same for
 * VISIBLE bindings (the prop toggles a child's existence).
 *
 * `buildPropBindings` walks every descendant of a `ComponentTarget`
 * (variants included for COMPONENT_SETs) and builds a flat map keyed
 * by node guid string. The map is consulted by the JSX emitter when
 * rendering a TEXT or any conditionally-visible node, and again at
 * the INSTANCE call site when threading `componentPropAssignments`
 * into JSX props.
 */
import type { FigComponentPropRef, FigNode } from "@higma-document-models/fig/types";
import { guidToString } from "@higma-document-models/fig/domain";
import type { ComponentPropDecl, ComponentTarget } from "../types";
import { SYNTHETIC_TEXT_PREFIX } from "./registry";

export type PropBindingField = "TEXT_DATA" | "VISIBLE" | "OVERRIDDEN_SYMBOL_ID";

export type PropBinding = {
  readonly field: PropBindingField;
  readonly decl: ComponentPropDecl;
};

export type PropBindings = ReadonlyMap<string, PropBinding>;

const EMPTY_BINDINGS: PropBindings = new Map();

function defIdString(ref: FigComponentPropRef): string | undefined {
  if (!ref.defID) {
    return undefined;
  }
  return guidToString(ref.defID);
}

function fieldNameOf(ref: FigComponentPropRef): PropBindingField | undefined {
  const name = ref.componentPropNodeField?.name;
  switch (name) {
    case "VISIBLE":
    case "TEXT_DATA":
    case "OVERRIDDEN_SYMBOL_ID":
      return name;
    default:
      return undefined;
  }
}

/**
 * Some files store the binding as a string `"<defID>:<fieldName>"`
 * rather than a Kiwi struct. Parse it back into the same shape.
 *
 * `<defID>` for the string form is the same colon-separated guid the
 * Kiwi struct exposes via `guidToString(ref.defID)`. Authoring tools
 * that serialise this format keep the format stable, so a simple
 * `lastIndexOf(":")` split is robust to the colon already inside the
 * guid.
 */
function parseStringRef(s: string): { defId: string; field: PropBindingField } | undefined {
  const idx = s.lastIndexOf(":");
  if (idx <= 0) {
    return undefined;
  }
  const defId = s.slice(0, idx);
  const fieldName = s.slice(idx + 1);
  if (fieldName !== "VISIBLE" && fieldName !== "TEXT_DATA" && fieldName !== "OVERRIDDEN_SYMBOL_ID") {
    return undefined;
  }
  return { defId, field: fieldName };
}

function declByDefId(target: ComponentTarget): ReadonlyMap<string, ComponentPropDecl> {
  const out = new Map<string, ComponentPropDecl>();
  for (const decl of target.props) {
    if (decl.defId !== "synthetic") {
      out.set(decl.defId, decl);
    }
  }
  return out;
}

function visitDescendants(node: FigNode, visit: (descendant: FigNode) => void): void {
  for (const child of node.children ?? []) {
    if (!child) {
      continue;
    }
    visit(child);
    visitDescendants(child, visit);
  }
}

function rootsOf(target: ComponentTarget): readonly FigNode[] {
  if (target.variants.size === 0) {
    return [target.node];
  }
  // `target.variants` is now keyed by a guid-suffixed unique key, so
  // every authored sibling is present. Walk all of them so the
  // synthetic-text bindings cover descendants of every variant —
  // INSTANCEs that pick the second sibling-with-the-same-name still
  // need their text overrides to land.
  return [...target.variants.values()];
}

/**
 * Build the descendant-guid → PropBinding map for one component
 * target. Returns the empty map when the target has no typed props
 * other than the synthetic variant axis (those are handled at the
 * INSTANCE call site, not on a per-descendant basis).
 *
 * Three sources contribute bindings:
 *   - Kiwi `componentPropRefs[]` on the descendant.
 *   - String `componentPropertyReferences[]` on the descendant.
 *   - Synthetic `text_<guid>` declarations the registry attaches to
 *     every TEXT descendant (so that `instance.symbolData.symbolOverrides`
 *     can supply a per-INSTANCE replacement for any text without the
 *     SYMBOL author having declared a `componentPropDefs` slot).
 */
export function buildPropBindings(target: ComponentTarget): PropBindings {
  const declMap = declByDefId(target);
  const syntheticByGuid = syntheticTextDeclByGuid(target);
  if (declMap.size === 0 && syntheticByGuid.size === 0) {
    return EMPTY_BINDINGS;
  }
  const out = new Map<string, PropBinding>();
  for (const root of rootsOf(target)) {
    visitDescendants(root, (descendant) => {
      const guidStr = guidToString(descendant.guid);
      if (declMap.size > 0) {
        collectKiwiRefs(descendant, declMap, guidStr, out);
        collectStringRefs(descendant, declMap, guidStr, out);
      }
      // Don't overwrite an explicit Kiwi/string ref — the authored
      // typed prop wins. Synthetic text props only fill in the gap
      // where no explicit binding exists.
      if (!out.has(guidStr)) {
        const synthetic = syntheticByGuid.get(guidStr);
        if (synthetic) {
          out.set(guidStr, { field: "TEXT_DATA", decl: synthetic });
        }
      }
    });
  }
  return out;
}

function syntheticTextDeclByGuid(target: ComponentTarget): ReadonlyMap<string, ComponentPropDecl> {
  const out = new Map<string, ComponentPropDecl>();
  for (const decl of target.props) {
    if (decl.defId.startsWith(SYNTHETIC_TEXT_PREFIX)) {
      const guidStr = decl.defId.slice(SYNTHETIC_TEXT_PREFIX.length);
      out.set(guidStr, decl);
    }
  }
  return out;
}

function collectKiwiRefs(
  node: FigNode,
  declMap: ReadonlyMap<string, ComponentPropDecl>,
  guidStr: string,
  out: Map<string, PropBinding>,
): void {
  for (const ref of node.componentPropRefs ?? []) {
    const defId = defIdString(ref);
    const field = fieldNameOf(ref);
    if (!defId || !field) {
      continue;
    }
    const decl = declMap.get(defId);
    if (!decl) {
      continue;
    }
    out.set(guidStr, { field, decl });
  }
}

function collectStringRefs(
  node: FigNode,
  declMap: ReadonlyMap<string, ComponentPropDecl>,
  guidStr: string,
  out: Map<string, PropBinding>,
): void {
  if (out.has(guidStr)) {
    // Kiwi refs already covered this descendant.
    return;
  }
  for (const refStr of node.componentPropertyReferences ?? []) {
    const parsed = parseStringRef(refStr);
    if (!parsed) {
      continue;
    }
    const decl = declMap.get(parsed.defId);
    if (!decl) {
      continue;
    }
    out.set(guidStr, { field: parsed.field, decl });
    return;
  }
}
