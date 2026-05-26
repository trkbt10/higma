/** @file Fig editor operation surface Kiwi node selectors and snapshots. */
import { getNodeType, guidToString, isFigGuid } from "@higma-document-models/fig/domain";
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import type { FigEditorContextValue } from "../context/FigEditorContext";
import {
  requireFigEditorOperationSurfaceGuid,
  resolveFigEditorOperationSurfaceGuidInput,
} from "./fig-editor-operation-surface-guid";
import type {
  FigEditorOperationSurfaceGuidInput,
  FigEditorOperationSurfaceDocumentSnapshot,
  FigEditorOperationSurfaceNodeQuery,
  FigEditorOperationSurfaceNodeSelector,
  FigEditorOperationSurfaceNodeSnapshot,
  FigEditorOperationSurfaceSymbolResolutionSnapshot,
} from "./fig-editor-operation-surface-types";

function isGuidSelector(selector: FigEditorOperationSurfaceNodeSelector): selector is FigEditorOperationSurfaceGuidInput {
  return typeof selector === "string" || isFigGuid(selector);
}

function isObjectGuidSelector(
  selector: FigEditorOperationSurfaceNodeSelector,
): selector is { readonly guid: FigEditorOperationSurfaceGuidInput } {
  return typeof selector === "object" && selector !== null && "guid" in selector;
}

/** Read one Kiwi node by FigGuid from the editor document index. */
export function figEditorOperationSurfaceNodeByGuid(
  editor: FigEditorContextValue,
  guid: FigGuid,
  owner: string,
): FigNode {
  const key = guidToString(guid);
  const node = editor.context.document.nodesByGuid.get(key);
  if (node === undefined) {
    throw new Error(`${owner}: Kiwi node ${key} is not present`);
  }
  return node;
}

/** Return a Kiwi GUID key for a node that must carry a GUID. */
export function figEditorOperationSurfaceNodeGuidKey(node: FigNode, owner: string): string {
  return guidToString(requireFigEditorOperationSurfaceGuid(node.guid, owner));
}

function nodeMatchesParent(node: FigNode, parentGuid: FigGuid | undefined): boolean {
  if (parentGuid === undefined) {
    return true;
  }
  const parent = node.parentIndex?.guid;
  if (parent === undefined) {
    return false;
  }
  return guidToString(parent) === guidToString(parentGuid);
}

function isNodeInCanvas(editor: FigEditorContextValue, node: FigNode, pageGuid: FigGuid | undefined): boolean {
  if (pageGuid === undefined) {
    return true;
  }
  if (getNodeType(node) === "CANVAS") {
    return figEditorOperationSurfaceNodeGuidKey(node, "isNodeInCanvas") === guidToString(pageGuid);
  }
  const parentGuid = node.parentIndex?.guid;
  if (parentGuid === undefined) {
    return false;
  }
  const parent = figEditorOperationSurfaceNodeByGuid(editor, parentGuid, "isNodeInCanvas");
  return isNodeInCanvas(editor, parent, pageGuid);
}

function nodeMatchesQuery(editor: FigEditorContextValue, node: FigNode, query: FigEditorOperationSurfaceNodeQuery): boolean {
  if (query.name !== undefined && node.name !== query.name) {
    return false;
  }
  if (query.type !== undefined && getNodeType(node) !== query.type) {
    return false;
  }
  const parentGuid = resolveOptionalOperationSurfaceGuidInput(
    query.parentGuid,
    "node query parentGuid",
  );
  if (!nodeMatchesParent(node, parentGuid)) {
    return false;
  }
  const pageGuid = resolveOptionalOperationSurfaceGuidInput(
    query.pageGuid,
    "node query pageGuid",
  );
  return isNodeInCanvas(editor, node, pageGuid);
}

function resolveOptionalOperationSurfaceGuidInput(
  input: FigEditorOperationSurfaceGuidInput | undefined,
  owner: string,
): FigGuid | undefined {
  if (input === undefined) {
    return undefined;
  }
  return resolveFigEditorOperationSurfaceGuidInput(input, owner);
}

function hasNodeQueryField(query: FigEditorOperationSurfaceNodeQuery): boolean {
  return (
    query.name !== undefined ||
    query.type !== undefined ||
    query.parentGuid !== undefined ||
    query.pageGuid !== undefined
  );
}

/** Find Kiwi nodes by exact editor operation surface query fields. */
export function figEditorOperationSurfaceFindNodesByQuery(
  editor: FigEditorContextValue,
  query: FigEditorOperationSurfaceNodeQuery | undefined,
): readonly FigNode[] {
  if (query === undefined) {
    return editor.context.document.nodeChanges;
  }
  if (!hasNodeQueryField(query)) {
    throw new Error("figEditorOperationSurfaceFindNodesByQuery requires at least one exact query field");
  }
  return editor.context.document.nodeChanges.filter((node) => nodeMatchesQuery(editor, node, query));
}

/** Find Kiwi nodes by GUID or exact query selector. */
export function figEditorOperationSurfaceFindNodesBySelector(
  editor: FigEditorContextValue,
  selector: FigEditorOperationSurfaceNodeSelector,
  owner: string,
): readonly FigNode[] {
  if (isGuidSelector(selector)) {
    return [figEditorOperationSurfaceNodeByGuid(editor, resolveFigEditorOperationSurfaceGuidInput(selector, owner), owner)];
  }
  if (isObjectGuidSelector(selector)) {
    return [figEditorOperationSurfaceNodeByGuid(editor, resolveFigEditorOperationSurfaceGuidInput(selector.guid, owner), owner)];
  }
  return figEditorOperationSurfaceFindNodesByQuery(editor, selector);
}

/** Require one exact Kiwi node from a operation surface selector. */
export function figEditorOperationSurfaceRequireSingleNode(
  editor: FigEditorContextValue,
  selector: FigEditorOperationSurfaceNodeSelector,
  owner: string,
): FigNode {
  const nodes = figEditorOperationSurfaceFindNodesBySelector(editor, selector, owner);
  if (nodes.length !== 1) {
    throw new Error(`${owner} requires exactly one Kiwi node; matched ${nodes.length}`);
  }
  const node = nodes[0];
  if (node === undefined) {
    throw new Error(`${owner} matched no Kiwi node`);
  }
  return node;
}

/** Snapshot a Kiwi node for browser automation without exposing live mutation. */
export function figEditorOperationSurfaceNodeSnapshot(
  editor: FigEditorContextValue,
  node: FigNode,
): FigEditorOperationSurfaceNodeSnapshot {
  const guid = requireFigEditorOperationSurfaceGuid(node.guid, "figEditorOperationSurfaceNodeSnapshot");
  const parentGuid = node.parentIndex?.guid;
  return {
    guid: { ...guid },
    guidKey: guidToString(guid),
    name: node.name,
    type: getNodeType(node),
    parentGuid: parentGuid === undefined ? undefined : { ...parentGuid },
    parentGuidKey: parentGuid === undefined ? undefined : guidToString(parentGuid),
    childGuidKeys: editor.context.document.childrenOf(node).map((child) => figEditorOperationSurfaceNodeGuidKey(child, "figEditorOperationSurfaceNodeSnapshot child")),
    node: structuredClone(node),
  };
}

/** Require the currently active Kiwi CANVAS page. */
export function figEditorOperationSurfaceRequireActivePage(editor: FigEditorContextValue): FigNode {
  if (editor.activePage === undefined) {
    throw new Error("Fig editor operation surface requires an active CANVAS");
  }
  return editor.activePage;
}

/** Resolve the GUID for one exact operation surface node selector. */
export function figEditorOperationSurfaceResolveSelectorGuid(
  editor: FigEditorContextValue,
  selector: FigEditorOperationSurfaceNodeSelector,
  owner: string,
): FigGuid {
  return requireFigEditorOperationSurfaceGuid(figEditorOperationSurfaceRequireSingleNode(editor, selector, owner).guid, owner);
}

/** Snapshot the full Kiwi document visible to the editor. */
export function figEditorOperationSurfaceDocumentSnapshot(editor: FigEditorContextValue): FigEditorOperationSurfaceDocumentSnapshot {
  return {
    kiwiDocumentRevision: editor.kiwiDocumentRevision,
    kiwiDocumentMutation: editor.kiwiDocumentMutation,
    activePageGuidKey: editor.activePageGuid === undefined ? undefined : guidToString(editor.activePageGuid),
    selectedGuidKeys: editor.selectedGuids.map(guidToString),
    pageGuidKeys: editor.pages.map((page) => figEditorOperationSurfaceNodeGuidKey(page, "figEditorOperationSurfaceDocumentSnapshot page")),
    nodeCount: editor.context.document.nodeChanges.length,
    nodes: editor.context.document.nodeChanges.map((node) => figEditorOperationSurfaceNodeSnapshot(editor, node)),
  };
}

function figEditorOperationSurfaceResolvedDescendantNames(
  node: FigNode,
  childrenOf: (node: FigNode) => readonly FigNode[],
): readonly string[] {
  const names = node.name === undefined ? [] : [node.name];
  return [
    ...names,
    ...childrenOf(node).flatMap((child) => figEditorOperationSurfaceResolvedDescendantNames(child, childrenOf)),
  ];
}

function figEditorOperationSurfaceResolvedInstanceDescendantNames(
  editor: FigEditorContextValue,
  node: FigNode,
  hasEffectiveSymbol: boolean,
): readonly string[] {
  if (getNodeType(node) !== "INSTANCE" || !hasEffectiveSymbol) {
    return [];
  }
  const resolved = editor.context.symbolResolver.resolveInstance(node);
  return [
    ...figEditorOperationSurfaceResolvedDescendantNames(resolved.node, editor.context.symbolResolver.childrenOfResolvedNode),
    ...resolved.children.flatMap((child) => (
      figEditorOperationSurfaceResolvedDescendantNames(child, editor.context.symbolResolver.childrenOfResolvedNode)
    )),
  ];
}

/** Snapshot SymbolResolver output for one selected INSTANCE node. */
export function figEditorOperationSurfaceSymbolResolutionSnapshot(
  editor: FigEditorContextValue,
  selector: FigEditorOperationSurfaceNodeSelector,
): FigEditorOperationSurfaceSymbolResolutionSnapshot {
  const node = figEditorOperationSurfaceRequireSingleNode(editor, selector, "symbolResolution");
  const guid = requireFigEditorOperationSurfaceGuid(node.guid, "symbolResolution");
  const resolution = editor.context.symbolResolver.resolveReferences(node);
  return {
    instanceGuidKey: guidToString(guid),
    effectiveSymbolGuidKey: resolution.effectiveSymbol === undefined ? undefined : guidToString(resolution.effectiveSymbol.guid),
    effectiveSymbolName: resolution.effectiveSymbol?.node.name,
    resolvedDescendantNames: figEditorOperationSurfaceResolvedInstanceDescendantNames(
      editor,
      node,
      resolution.effectiveSymbol !== undefined,
    ),
    dependencyGuidKeys: resolution.allDependencyGuids.map(guidToString),
  };
}
