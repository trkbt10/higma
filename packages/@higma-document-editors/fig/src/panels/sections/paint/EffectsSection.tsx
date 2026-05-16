/** @file Effects property section adapter. */

import { useCallback } from "react";
import type { FigDesignNode } from "@higma-document-models/fig/domain";
import type { BlendMode, FigEffect, FigEffectType } from "@higma-document-models/fig/types";
import { figColorToHex } from "@higma-document-models/fig/color";
import {
  EffectsSectionView,
  type BlendModeId,
  type EffectTypeId,
  type EffectView,
} from "@higma-editor-kernel/ui/property-sections";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { createPropertyTargetUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";
import {
  EffectListOp,
  EffectOp,
  getEffectTypeName,
  type EffectOperation,
} from "./effect-domain";
import { applyAppearanceOperation, AppearanceOp } from "./appearance-domain";

type EffectsSectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly dispatch: (action: FigEditorAction) => void;
};

function toEffectTypeId(type: FigEffectType): EffectTypeId {
  if (type === "LAYER_BLUR") {
    return "FOREGROUND_BLUR";
  }
  return type as EffectTypeId;
}

function toEffectView(effect: FigEffect): EffectView {
  const type = toEffectTypeId(getEffectTypeName(effect));
  const color = effect.color ?? { r: 0, g: 0, b: 0, a: 0.25 };
  const blendModeName: string = effect.blendMode ?? "NORMAL";
  return {
    type,
    visible: effect.visible !== false,
    radius: effect.radius ?? 0,
    offsetX: effect.offset?.x ?? 0,
    offsetY: effect.offset?.y ?? 0,
    spread: effect.spread ?? 0,
    blendMode: blendModeName as BlendModeId,
    hex: figColorToHex(color),
    opacity: color.a,
    showShadowBehindNode: effect.showShadowBehindNode !== false,
  };
}

/** Panel section for viewing and editing visual effects on a Figma node. */
export function EffectsSection({ node, target, dispatch }: EffectsSectionProps) {
  const effects = node.effects;

  const applyEffectOperationAt = useCallback(
    (index: number, operation: EffectOperation) => {
      dispatch(createPropertyTargetUpdateAction({
        target,
        updater: (n) => applyAppearanceOperation(n, AppearanceOp.effects(EffectListOp.update(index, operation))),
      }));
    },
    [dispatch, target],
  );

  const addEffect = useCallback(() => {
    dispatch(createPropertyTargetUpdateAction({
      target,
      updater: (n) => applyAppearanceOperation(n, AppearanceOp.effects(EffectListOp.add("DROP_SHADOW"))),
    }));
  }, [dispatch, target]);

  const removeEffect = useCallback((index: number) => {
    dispatch(createPropertyTargetUpdateAction({
      target,
      updater: (n) => applyAppearanceOperation(n, AppearanceOp.effects(EffectListOp.remove(index))),
    }));
  }, [dispatch, target]);

  const handleChange = useCallback((index: number, next: EffectView) => {
    const current = effects[index];
    if (!current) {
      return;
    }
    const previous = toEffectView(current);
    if (previous.type !== next.type) {
      applyEffectOperationAt(index, EffectOp.setType(next.type as FigEffectType));
      return;
    }
    if (previous.visible !== next.visible) {
      applyEffectOperationAt(index, EffectOp.setVisible(next.visible));
      return;
    }
    if (previous.radius !== next.radius) {
      applyEffectOperationAt(index, EffectOp.setRadius(next.radius));
      return;
    }
    if (previous.offsetX !== next.offsetX) {
      applyEffectOperationAt(index, EffectOp.setOffsetX(next.offsetX));
      return;
    }
    if (previous.offsetY !== next.offsetY) {
      applyEffectOperationAt(index, EffectOp.setOffsetY(next.offsetY));
      return;
    }
    if (previous.spread !== next.spread) {
      applyEffectOperationAt(index, EffectOp.setSpread(next.spread));
      return;
    }
    if (previous.blendMode !== next.blendMode) {
      applyEffectOperationAt(index, EffectOp.setBlendMode(next.blendMode as BlendMode));
      return;
    }
    if (previous.hex !== next.hex) {
      applyEffectOperationAt(index, EffectOp.setColor(next.hex));
      return;
    }
    if (previous.opacity !== next.opacity) {
      applyEffectOperationAt(index, EffectOp.setOpacity(next.opacity));
      return;
    }
    if (previous.showShadowBehindNode !== next.showShadowBehindNode) {
      applyEffectOperationAt(index, EffectOp.setShadowBehindNode(next.showShadowBehindNode));
      return;
    }
  }, [effects, applyEffectOperationAt]);

  return (
    <EffectsSectionView
      effects={effects.map(toEffectView)}
      onAdd={addEffect}
      onRemove={removeEffect}
      onChange={handleChange}
    />
  );
}
