/** @file Domain symbol override path and application helpers. */

import type { FigStrokeWeight } from "../types";
import { guidToNodeId } from "./node-id";
import { guidToString } from "./raw-node-tree";
import type {
  MutableFigDesignNode,
  SymbolOverride,
  SymbolOverrideFieldKey,
} from "./document";

/** Check whether a SymbolOverride's guidPath is valid. */
export function isValidOverridePath(override: SymbolOverride): boolean {
  const gp = override.guidPath;
  return gp != null && gp.guids != null && gp.guids.length > 0;
}

/** Check whether a SymbolOverride targets a specific node. */
export function isSelfOverride(override: SymbolOverride, nodeId: string): boolean {
  const guids = override.guidPath?.guids;
  if (!guids || guids.length !== 1) { return false; }
  return guidToString(guids[0]) === nodeId;
}

/** Convert a SymbolOverride's guidPath to "sessionID:localID" strings. */
export function overridePathToIds(override: SymbolOverride): readonly string[] {
  return override.guidPath.guids.map(guidToString);
}

const SYMBOL_OVERRIDE_FIELD_KEY_SET = {
  fillPaints: true, strokePaints: true, backgroundPaints: true,
  visible: true, opacity: true, effects: true,
  transform: true, size: true,
  fillGeometry: true, strokeGeometry: true,
  cornerRadius: true, rectangleCornerRadii: true,
  rectangleTopLeftCornerRadius: true, rectangleTopRightCornerRadius: true,
  rectangleBottomLeftCornerRadius: true, rectangleBottomRightCornerRadius: true,
  strokeWeight: true, strokeJoin: true, strokeCap: true, strokeDashes: true,
  borderTopWeight: true, borderRightWeight: true, borderBottomWeight: true, borderLeftWeight: true,
  clipsContent: true, cornerSmoothing: true, blendMode: true,
  derivedTextData: true,
  styleIdForFill: true, styleIdForStrokeFill: true,
  stackPositioning: true,
  name: true, locked: true,
  overriddenSymbolID: true,
  componentPropertyAssignments: true,
} satisfies Record<SymbolOverrideFieldKey, true>;

function isOverrideFieldKey(key: string): key is SymbolOverrideFieldKey {
  return key in SYMBOL_OVERRIDE_FIELD_KEY_SET;
}

/** Iterate override field names that actually have a defined value. */
export function* overrideFieldKeys(override: SymbolOverride): Generator<SymbolOverrideFieldKey> {
  for (const key of Object.keys(SYMBOL_OVERRIDE_FIELD_KEY_SET)) {
    if (!isOverrideFieldKey(key)) { continue; }
    if (override[key] === undefined) { continue; }
    yield key;
  }
}

function cornerRadiusIndex(key: SymbolOverrideFieldKey): number {
  if (key === "rectangleTopLeftCornerRadius") {
    return 0;
  }
  if (key === "rectangleTopRightCornerRadius") {
    return 1;
  }
  if (key === "rectangleBottomRightCornerRadius") {
    return 2;
  }
  return 3;
}

function strokeWeightSide(key: SymbolOverrideFieldKey): keyof NonNullable<MutableFigDesignNode["individualStrokeWeights"]> {
  if (key === "borderTopWeight") {
    return "top";
  }
  if (key === "borderRightWeight") {
    return "right";
  }
  if (key === "borderBottomWeight") {
    return "bottom";
  }
  return "left";
}

function rectangleCornerRadiiForOverride(target: MutableFigDesignNode): [number, number, number, number] {
  if (target.rectangleCornerRadii) {
    const [topLeft, topRight, bottomRight, bottomLeft] = target.rectangleCornerRadii;
    return [topLeft, topRight, bottomRight, bottomLeft];
  }
  const cornerRadius = target.cornerRadius ?? 0;
  return [cornerRadius, cornerRadius, cornerRadius, cornerRadius];
}

/** Apply override properties to a mutable FigDesignNode. */
export function applyOverrideToNode(
  target: MutableFigDesignNode,
  override: SymbolOverride,
  options?: { skipDerivedTextData?: boolean },
): void {
  for (const key of overrideFieldKeys(override)) {
    switch (key) {
      case "fillPaints": {
        const value = override.fillPaints;
        if (value !== undefined) { target.fills = value; }
        break;
      }
      case "strokePaints": {
        const value = override.strokePaints;
        if (value !== undefined) { target.strokes = value; }
        break;
      }
      case "backgroundPaints":
        break;
      case "visible": {
        const value = override.visible;
        if (value !== undefined) { target.visible = value; }
        break;
      }
      case "opacity": {
        const value = override.opacity;
        if (value !== undefined) { target.opacity = value; }
        break;
      }
      case "effects": {
        const value = override.effects;
        if (value !== undefined) { target.effects = value; }
        break;
      }
      case "cornerRadius": {
        target.cornerRadius = override.cornerRadius;
        break;
      }
      case "rectangleCornerRadii": {
        target.rectangleCornerRadii = override.rectangleCornerRadii;
        break;
      }
      case "blendMode": {
        target.blendMode = override.blendMode;
        break;
      }
      case "strokeWeight": {
        const value = override.strokeWeight;
        if (value !== undefined) { target.strokeWeight = value; }
        break;
      }
      case "strokeJoin": {
        target.strokeJoin = override.strokeJoin;
        break;
      }
      case "strokeCap": {
        target.strokeCap = override.strokeCap;
        break;
      }
      case "clipsContent": {
        target.clipsContent = override.clipsContent;
        break;
      }
      case "cornerSmoothing": {
        target.cornerSmoothing = override.cornerSmoothing;
        break;
      }
      case "transform": {
        const value = override.transform;
        if (value !== undefined) { target.transform = value; }
        break;
      }
      case "size": {
        const value = override.size;
        if (value !== undefined) { target.size = value; }
        break;
      }
      case "fillGeometry": {
        target.fillGeometry = override.fillGeometry;
        break;
      }
      case "strokeGeometry": {
        target.strokeGeometry = override.strokeGeometry;
        break;
      }
      case "derivedTextData": {
        if (!options?.skipDerivedTextData) {
          target.derivedTextData = override.derivedTextData;
        }
        break;
      }
      case "componentPropertyAssignments": {
        const incoming = override.componentPropertyAssignments;
        if (incoming === undefined) { break; }
        const existing = target.componentPropertyAssignments;
        if (!existing || existing.length === 0) {
          target.componentPropertyAssignments = incoming;
        } else {
          const incomingDefIds = new Set(incoming.map((assignment) => assignment.defId));
          target.componentPropertyAssignments = [
            ...existing.filter((assignment) => !incomingDefIds.has(assignment.defId)),
            ...incoming,
          ];
        }
        break;
      }
      case "styleIdForFill": {
        target.styleIdForFill = override.styleIdForFill;
        break;
      }
      case "styleIdForStrokeFill": {
        target.styleIdForStrokeFill = override.styleIdForStrokeFill;
        break;
      }
      case "rectangleTopLeftCornerRadius":
      case "rectangleTopRightCornerRadius":
      case "rectangleBottomLeftCornerRadius":
      case "rectangleBottomRightCornerRadius": {
        const value = override[key];
        if (typeof value !== "number") { break; }
        const radii = rectangleCornerRadiiForOverride(target);
        const index = cornerRadiusIndex(key);
        radii[index] = value;
        target.rectangleCornerRadii = radii;
        break;
      }
      case "borderTopWeight":
      case "borderRightWeight":
      case "borderBottomWeight":
      case "borderLeftWeight": {
        const value = override[key];
        if (typeof value !== "number") { break; }
        const base = uniformStrokeWeight(target.strokeWeight);
        const strokeWeights = target.individualStrokeWeights ?? { top: base, right: base, bottom: base, left: base };
        const side = strokeWeightSide(key);
        target.individualStrokeWeights = { ...strokeWeights, [side]: value };
        break;
      }
      case "stackPositioning": {
        const value = override.stackPositioning;
        if (value === undefined) { break; }
        const layoutConstraints = target.layoutConstraints ?? {};
        target.layoutConstraints = { ...layoutConstraints, stackPositioning: value };
        break;
      }
      case "strokeDashes": {
        target.strokeDashes = override.strokeDashes;
        break;
      }
      case "name": {
        const value = override.name;
        if (value !== undefined) { target.name = value; }
        break;
      }
      case "overriddenSymbolID": {
        const guid = override.overriddenSymbolID;
        if (guid) {
          target.symbolId = guidToNodeId(guid);
        }
        break;
      }
      case "locked":
        break;
    }
  }
}

function uniformStrokeWeight(strokeWeight: FigStrokeWeight | undefined): number {
  if (strokeWeight == null) { return 0; }
  if (typeof strokeWeight === "number") { return strokeWeight; }
  if (typeof strokeWeight === "object" && "value" in strokeWeight && typeof strokeWeight.value === "number") {
    return strokeWeight.value;
  }
  return 0;
}
