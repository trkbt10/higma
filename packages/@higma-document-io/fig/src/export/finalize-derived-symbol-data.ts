/**
 * @file Finalize `derivedSymbolData` on every INSTANCE in a document.
 *
 * `derivedSymbolData` is a load-bearing field on INSTANCE nodes: when
 * an INSTANCE is resized relative to its linked SYMBOL, Figma expects
 * a pre-computed array of `SymbolOverride` entries that describe the
 * adjusted transform/size for every descendant child whose layout
 * resolves under the new instance size.
 *
 * Real Figma exports always carry this data; .fig files that lack it
 * for resized instances either render slowly (Figma falls back to
 * full constraint resolution at render time) or render wrong (the
 * "SYMBOL-shaped INSTANCE" bug). Phase 1 reducer actions create
 * INSTANCEs that may be resized after the fact, so this finalize pass
 * has to run at export time — it cannot be the responsibility of the
 * individual `PROMOTE_TO_INSTANCE` action handler because subsequent
 * `UPDATE_NODE` resize actions would invalidate any value computed at
 * promotion time.
 */

import type {
  FigDesignDocument,
  FigDesignNode,
  FigPage,
} from "@higma-document-models/fig/domain";
import { computeDerivedSymbolData } from "@higma-document-models/fig/node-factory";

function isDerivedUnchanged<T>(current: T | undefined, desired: T | undefined): boolean {
  if (desired === undefined) return current === undefined;
  return current === desired;
}

function finalizeChildren(
  children: readonly FigDesignNode[] | undefined,
  components: ReadonlyMap<string, FigDesignNode>,
): { readonly children: readonly FigDesignNode[] | undefined; readonly changed: boolean } {
  if (children === undefined) {
    return { children: undefined, changed: false };
  }
  const next: FigDesignNode[] = [];
  let changed = false;
  for (const child of children) {
    const updated = finalizeNode(child, components);
    if (updated !== child) {
      changed = true;
    }
    next.push(updated);
  }
  return changed ? { children: next, changed: true } : { children, changed: false };
}

function finalizeNode(
  node: FigDesignNode,
  components: ReadonlyMap<string, FigDesignNode>,
): FigDesignNode {
  const childResult = finalizeChildren(node.children, components);

  if (node.type !== "INSTANCE" || node.symbolId === undefined) {
    return childResult.changed ? { ...node, children: childResult.children } : node;
  }

  const symbol = components.get(node.symbolId);
  if (!symbol) {
    return childResult.changed ? { ...node, children: childResult.children } : node;
  }

  const derived = computeDerivedSymbolData(symbol, node.size, components);
  const desiredDerived = derived.length === 0 ? undefined : derived;
  const derivedUnchanged = isDerivedUnchanged(node.derivedSymbolData, desiredDerived);

  if (!childResult.changed && derivedUnchanged) {
    return node;
  }

  return {
    ...node,
    children: childResult.children,
    derivedSymbolData: desiredDerived,
  };
}

/**
 * Walk every node in every page and recompute `derivedSymbolData` on
 * INSTANCEs. Pure function; preserves reference identity of nodes that
 * do not change.
 */
export function finalizeDerivedSymbolData(doc: FigDesignDocument): FigDesignDocument {
  const components = doc.components;
  let docChanged = false;
  const pages: FigPage[] = doc.pages.map((page) => {
    const result = finalizeChildren(page.children, components);
    if (!result.changed) {
      return page;
    }
    docChanged = true;
    return { ...page, children: result.children as readonly FigDesignNode[] };
  });
  return docChanged ? { ...doc, pages } : doc;
}
