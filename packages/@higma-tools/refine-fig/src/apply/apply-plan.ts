/** @file Apply a RefinePlan to a loaded Kiwi fig document. */

import {
  guidToString,
  indexFigKiwiDocument,
  type LoadedFigFile,
} from "@higma-document-models/fig/domain";
import {
  BLEND_MODE_VALUES,
  NODE_TYPE_VALUES,
  PAINT_TYPE_VALUES,
  STACK_ALIGN_VALUES,
  STACK_MODE_VALUES,
  STROKE_ALIGN_VALUES,
  STROKE_JOIN_VALUES,
  STYLE_TYPE_VALUES,
} from "@higma-document-models/fig/constants";
import {
  createFigBuilderStateFromDocument,
  nextNodeGuid,
  nextPageGuid,
} from "@higma-document-models/fig/builder";
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import type {
  ActionBindFillStyle,
  ActionBindTextStyle,
  ActionCreateFillStyleDefinition,
  ActionCreateTextStyleDefinition,
  ActionEnsureInternalCanvas,
  ActionGroupAsVariantSet,
  ActionPromoteIconCluster,
  ActionPromoteVectorCluster,
  ActionRename,
  ActionSetLayout,
  PlanAction,
  StyleDefinitionRef,
  RefinePlan,
} from "../plan";

export type ApplySummary = {
  readonly internalCanvasCreated: boolean;
  readonly fillStyleDefinitionsCreated: number;
  readonly textStyleDefinitionsCreated: number;
  readonly fillBound: number;
  readonly textBound: number;
  readonly clustersPromoted: number;
  readonly instancesRewritten: number;
  readonly vectorClustersPromoted: number;
  readonly vectorInstancesRewritten: number;
  readonly variantSetsCreated: number;
  readonly layoutsApplied: number;
  readonly renamed: number;
  readonly skipped: readonly { readonly action: PlanAction; readonly reason: string }[];
};

export type ApplyResult = ApplySummary & {
  readonly loaded: LoadedFigFile;
};

export type ApplyContext = {
  readonly internalCanvasGuid: string | undefined;
  readonly userCanvasGuid: string | undefined;
  readonly fillTemplateGuid: string | undefined;
  readonly textTemplateGuid: string | undefined;
};

const ZERO_SUMMARY: ApplySummary = {
  internalCanvasCreated: false,
  fillStyleDefinitionsCreated: 0,
  textStyleDefinitionsCreated: 0,
  fillBound: 0,
  textBound: 0,
  clustersPromoted: 0,
  instancesRewritten: 0,
  vectorClustersPromoted: 0,
  vectorInstancesRewritten: 0,
  variantSetsCreated: 0,
  layoutsApplied: 0,
  renamed: 0,
  skipped: [],
};

const CREATED_PHASE = { value: 0, name: "CREATED" } as const;
const NORMAL_BLEND = { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" } as const;
const REQUIRED_SHAPE_STROKE_FIELDS = {
  strokeWeight: 0,
  strokeAlign: { value: STROKE_ALIGN_VALUES.INSIDE, name: "INSIDE" },
  strokeJoin: { value: STROKE_JOIN_VALUES.MITER, name: "MITER" },
} as const;

type MutableApplySummary = {
  -readonly [Key in keyof Omit<ApplySummary, "skipped">]: ApplySummary[Key];
} & {
  skipped: { action: PlanAction; reason: string }[];
};

/** Mutation state for applying a plan directly to the Kiwi nodeChanges array. */
type ApplyState = {
  readonly nodes: FigNode[];
  readonly positions: Map<string, number>;
  readonly removed: Set<string>;
  readonly summary: MutableApplySummary;
  readonly documentGuid: FigGuid;
  readonly tokenGuids: Map<string, FigGuid>;
  readonly promotedSymbols: Map<string, FigGuid>;
  readonly builder: ReturnType<typeof createFigBuilderStateFromDocument>;
  readonly internalCanvasGuid: { value: FigGuid | undefined };
};

/** Apply a refinement plan by mutating the loaded Kiwi nodeChanges document. */
export function applyPlan(loaded: LoadedFigFile, plan: RefinePlan, ctx: ApplyContext): ApplyResult {
  if (plan.actions.length === 0) {
    return { loaded, ...ZERO_SUMMARY };
  }
  const document = indexFigKiwiDocument(loaded.nodeChanges);
  const state: ApplyState = {
    nodes: loaded.nodeChanges.slice(),
    positions: positionsByGuid(loaded.nodeChanges),
    removed: new Set<string>(),
    summary: { ...ZERO_SUMMARY, skipped: [] },
    documentGuid: requiredDocumentGuid(document.nodeChanges),
    tokenGuids: new Map<string, FigGuid>(),
    promotedSymbols: new Map<string, FigGuid>(),
    builder: createFigBuilderStateFromDocument({
      document,
      nodeSessionID: 1,
      pageSessionID: 0,
      minimumNodeLocalID: 1,
      minimumPageLocalID: 1,
    }),
    internalCanvasGuid: { value: ctx.internalCanvasGuid ? guidFromPlanKey(ctx.internalCanvasGuid) : undefined },
  };
  for (const action of plan.actions) {
    applyAction(state, action);
  }
  return {
    loaded: { ...loaded, nodeChanges: state.nodes.filter((node) => !state.removed.has(requiredNodeKey(node))) },
    ...state.summary,
  };
}

function applyAction(state: ApplyState, action: PlanAction): void {
  switch (action.kind) {
    case "ensure-internal-canvas":
      applyEnsureInternalCanvas(state, action);
      return;
    case "create-fill-style-definition":
      applyCreateFillStyleDefinition(state, action);
      return;
    case "create-text-style-definition":
      applyCreateTextStyleDefinition(state, action);
      return;
    case "bind-fill-style":
      applyBindFillStyle(state, action);
      return;
    case "bind-text-style":
      applyBindTextStyle(state, action);
      return;
    case "promote-icon-cluster":
      applyPromoteIconCluster(state, action);
      return;
    case "promote-vector-cluster":
      applyPromoteVectorCluster(state, action);
      return;
    case "group-as-variant-set":
      applyGroupAsVariantSet(state, action);
      return;
    case "set-layout":
      applySetLayout(state, action);
      return;
    case "rename":
      applyRename(state, action);
      return;
  }
}

function applyEnsureInternalCanvas(state: ApplyState, action: ActionEnsureInternalCanvas): void {
  if (state.internalCanvasGuid.value !== undefined) {
    return;
  }
  const guid = nextPageGuid(state.builder.pageGuidCounter);
  state.internalCanvasGuid.value = guid;
  appendNode(state, {
    guid,
    phase: CREATED_PHASE,
    type: { value: NODE_TYPE_VALUES.CANVAS, name: "CANVAS" },
    name: action.name,
    parentIndex: { guid: state.documentGuid, position: `refine-${guidToString(guid)}` },
    internalOnly: true,
  });
  state.summary.internalCanvasCreated = true;
}

function applyCreateFillStyleDefinition(state: ApplyState, action: ActionCreateFillStyleDefinition): void {
  const guid = nextNodeGuid(state.builder.nodeGuidCounter);
  state.tokenGuids.set(action.token, guid);
  appendNode(state, {
    guid,
    phase: CREATED_PHASE,
    type: { value: NODE_TYPE_VALUES.FRAME, name: "FRAME" },
    name: action.name,
    ...REQUIRED_SHAPE_STROKE_FIELDS,
    parentIndex: parentIndexForInternalCanvas(state, guid),
    styleType: { value: STYLE_TYPE_VALUES.FILL, name: "FILL" },
    fillPaints: [
      {
        type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
        color: action.color,
        opacity: action.color.a,
        visible: true,
        blendMode: NORMAL_BLEND,
      },
    ],
  });
  state.summary.fillStyleDefinitionsCreated += 1;
}

function applyCreateTextStyleDefinition(state: ApplyState, action: ActionCreateTextStyleDefinition): void {
  const guid = nextNodeGuid(state.builder.nodeGuidCounter);
  state.tokenGuids.set(action.token, guid);
  appendNode(state, {
    guid,
    phase: CREATED_PHASE,
    type: { value: NODE_TYPE_VALUES.FRAME, name: "FRAME" },
    name: action.name,
    ...REQUIRED_SHAPE_STROKE_FIELDS,
    parentIndex: parentIndexForInternalCanvas(state, guid),
    styleType: { value: STYLE_TYPE_VALUES.TEXT, name: "TEXT" },
    fontName: { family: action.fontFamily, style: action.fontStyle, postscript: "" },
    fontSize: action.fontSize,
    fontWeight: action.fontWeight,
  });
  state.summary.textStyleDefinitionsCreated += 1;
}

function applyBindFillStyle(state: ApplyState, action: ActionBindFillStyle): void {
  const node = requiredNode(state, action.nodeGuid);
  replaceNode(state, { ...node, styleIdForFill: { guid: resolveStyleDefinitionGuid(state, action.styleDefinition) } });
  state.summary.fillBound += 1;
}

function applyBindTextStyle(state: ApplyState, action: ActionBindTextStyle): void {
  const node = requiredNode(state, action.nodeGuid);
  replaceNode(state, { ...node, styleIdForText: { guid: resolveStyleDefinitionGuid(state, action.styleDefinition) } });
  state.summary.textBound += 1;
}

function applyPromoteIconCluster(state: ApplyState, action: ActionPromoteIconCluster): void {
  const exemplar = requiredNode(state, action.exemplarGuid);
  const symbolGuid = requiredGuid(exemplar.guid, action.exemplarGuid);
  replaceNode(state, {
    ...exemplar,
    type: { value: NODE_TYPE_VALUES.SYMBOL, name: "SYMBOL" },
    name: action.clusterName,
  });
  state.promotedSymbols.set(action.clusterId, symbolGuid);
  for (const memberGuid of action.memberGuids) {
    if (memberGuid === action.exemplarGuid) {
      continue;
    }
    const member = requiredNode(state, memberGuid);
    replaceNode(state, {
      ...member,
      type: { value: NODE_TYPE_VALUES.INSTANCE, name: "INSTANCE" },
      name: action.clusterName,
      symbolData: { ...member.symbolData, symbolID: symbolGuid },
    });
    removeDescendants(state, memberGuid);
    state.summary.instancesRewritten += 1;
  }
  state.summary.clustersPromoted += 1;
}

function applyPromoteVectorCluster(state: ApplyState, action: ActionPromoteVectorCluster): void {
  const exemplar = requiredNode(state, action.exemplarGuid);
  const symbolGuid = nextNodeGuid(state.builder.nodeGuidCounter);
  const childGuid = nextNodeGuid(state.builder.nodeGuidCounter);
  appendNode(state, {
    guid: symbolGuid,
    phase: CREATED_PHASE,
    type: { value: NODE_TYPE_VALUES.SYMBOL, name: "SYMBOL" },
    name: action.clusterName,
    ...REQUIRED_SHAPE_STROKE_FIELDS,
    size: exemplar.size,
    parentIndex: parentIndexForInternalCanvas(state, symbolGuid),
  });
  appendNode(state, {
    ...exemplar,
    guid: childGuid,
    parentIndex: { guid: symbolGuid, position: "vector" },
  });
  for (const memberGuid of action.memberGuids) {
    const member = requiredNode(state, memberGuid);
    replaceNode(state, {
      ...member,
      type: { value: NODE_TYPE_VALUES.INSTANCE, name: "INSTANCE" },
      name: action.clusterName,
      symbolData: { ...member.symbolData, symbolID: symbolGuid },
    });
    state.summary.vectorInstancesRewritten += 1;
  }
  state.promotedSymbols.set(action.clusterId, symbolGuid);
  state.summary.vectorClustersPromoted += 1;
}

function applyGroupAsVariantSet(state: ApplyState, action: ActionGroupAsVariantSet): void {
  const firstVariant = action.variants[0];
  if (firstVariant === undefined) {
    state.summary.skipped.push({ action, reason: "variant set has no variants" });
    return;
  }
  const firstSymbolGuid = requiredPromotedSymbol(state, firstVariant.clusterId);
  const firstSymbol = requiredNode(state, guidToString(firstSymbolGuid));
  const setGuid = nextNodeGuid(state.builder.nodeGuidCounter);
  const propDefId = nextNodeGuid(state.builder.nodeGuidCounter);
  appendNode(state, {
    guid: setGuid,
    phase: CREATED_PHASE,
    type: { value: NODE_TYPE_VALUES.FRAME, name: "FRAME" },
    name: action.setName,
    ...REQUIRED_SHAPE_STROKE_FIELDS,
    parentIndex: firstSymbol.parentIndex ?? parentIndexForInternalCanvas(state, setGuid),
    isStateGroup: true,
    componentPropDefs: [
      {
        id: propDefId,
        name: action.propertyName,
        type: { value: 4, name: "VARIANT" },
        sortPosition: "0",
      },
    ],
  });
  action.variants.forEach((variant, index) => {
    const symbolGuid = requiredPromotedSymbol(state, variant.clusterId);
    const symbol = requiredNode(state, guidToString(symbolGuid));
    replaceNode(state, {
      ...symbol,
      name: `${action.propertyName}=${variant.propertyValue}`,
      parentIndex: { guid: setGuid, position: `variant-${index}` },
      variantPropSpecs: [{ propDefId, value: variant.propertyValue }],
    });
  });
  state.summary.variantSetsCreated += 1;
}

function applySetLayout(state: ApplyState, action: ActionSetLayout): void {
  const node = requiredNode(state, action.nodeGuid);
  replaceNode(state, {
    ...node,
    stackMode: { value: STACK_MODE_VALUES[action.layoutMode], name: action.layoutMode },
    stackSpacing: action.itemSpacing,
    stackVerticalPadding: action.paddingTop,
    stackHorizontalPadding: action.paddingLeft,
    stackPaddingRight: action.paddingRight,
    stackPaddingBottom: action.paddingBottom,
    stackCounterAlignItems: {
      value: STACK_ALIGN_VALUES[action.counterAxisAlign],
      name: action.counterAxisAlign,
    },
  });
  state.summary.layoutsApplied += 1;
}

function applyRename(state: ApplyState, action: ActionRename): void {
  const node = requiredNode(state, action.nodeGuid);
  replaceNode(state, { ...node, name: action.newName });
  state.summary.renamed += 1;
}

function positionsByGuid(nodes: readonly FigNode[]): Map<string, number> {
  const positions = new Map<string, number>();
  nodes.forEach((node, index) => {
    const guid = node.guid;
    if (guid !== undefined) {
      positions.set(guidToString(guid), index);
    }
  });
  return positions;
}

function requiredDocumentGuid(nodes: readonly FigNode[]): FigGuid {
  for (const node of nodes) {
    if (node.type?.name !== "DOCUMENT") {
      continue;
    }
    return requiredGuid(node.guid, "DOCUMENT");
  }
  throw new Error("applyPlan: loaded fig document has no DOCUMENT node");
}

function appendNode(state: ApplyState, node: FigNode): void {
  state.positions.set(requiredNodeKey(node), state.nodes.length);
  state.nodes.push(node);
}

function replaceNode(state: ApplyState, node: FigNode): void {
  const key = requiredNodeKey(node);
  const position = state.positions.get(key);
  if (position === undefined) {
    throw new Error(`applyPlan: cannot replace missing node ${key}`);
  }
  state.nodes[position] = node;
}

function requiredNode(state: ApplyState, guidKey: string): FigNode {
  const position = state.positions.get(guidKey);
  if (position === undefined) {
    throw new Error(`applyPlan: missing node ${guidKey}`);
  }
  return state.nodes[position]!;
}

function requiredPromotedSymbol(state: ApplyState, clusterId: string): FigGuid {
  const guid = state.promotedSymbols.get(clusterId);
  if (guid === undefined) {
    throw new Error(`applyPlan: variant set references unpromoted cluster "${clusterId}"`);
  }
  return guid;
}

function requiredNodeKey(node: FigNode): string {
  return guidToString(requiredGuid(node.guid, node.name ?? "node"));
}

function requiredGuid(guid: FigGuid | undefined, owner: string): FigGuid {
  if (guid === undefined) {
    throw new Error(`applyPlan: ${owner} is missing guid`);
  }
  return guid;
}

function guidFromPlanKey(value: string): FigGuid {
  const parts = value.split(":");
  if (parts.length !== 2) {
    throw new Error(`applyPlan: invalid GUID "${value}"`);
  }
  const sessionID = Number(parts[0]);
  const localID = Number(parts[1]);
  if (!Number.isInteger(sessionID) || !Number.isInteger(localID)) {
    throw new Error(`applyPlan: invalid GUID "${value}"`);
  }
  return { sessionID, localID };
}

function resolveStyleDefinitionGuid(state: ApplyState, ref: StyleDefinitionRef): FigGuid {
  if (ref.kind === "existing") {
    return guidFromPlanKey(ref.guid);
  }
  const guid = state.tokenGuids.get(ref.token);
  if (guid === undefined) {
    throw new Error(`applyPlan: unresolved style token "${ref.token}"`);
  }
  return guid;
}

function parentIndexForInternalCanvas(state: ApplyState, childGuid: FigGuid): FigNode["parentIndex"] {
  const canvasGuid = state.internalCanvasGuid.value;
  if (canvasGuid === undefined) {
    throw new Error("applyPlan: action requires an Internal Only Canvas GUID");
  }
  return { guid: canvasGuid, position: `refine-${guidToString(childGuid)}` };
}

function removeDescendants(state: ApplyState, parentGuidKey: string): void {
  const children = state.nodes.filter((node) => {
    const parent = node.parentIndex?.guid;
    return parent !== undefined && guidToString(parent) === parentGuidKey;
  });
  for (const child of children) {
    const key = requiredNodeKey(child);
    state.removed.add(key);
    removeDescendants(state, key);
  }
}
