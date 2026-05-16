/** @file Vector path editing section adapter. */

import { useCallback, useMemo } from "react";
import type { FigDesignNode } from "@higma-document-models/fig/domain";
import type { FigVectorPath } from "@higma-document-models/fig/types";
import {
  VectorPathSectionView,
  type PathEditableCommand,
  type PathEditableCommandType,
  type VectorPathItemView,
  type WindingRuleId,
} from "@higma-editor-kernel/ui/property-sections";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { createPropertyPrimaryUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";

type VectorPathSectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly dispatch: (action: FigEditorAction) => void;
};

const COMMAND_PARAM_COUNT: Record<PathEditableCommandType, number> = {
  M: 2,
  L: 2,
  Q: 4,
  C: 6,
  Z: 0,
};

function windingName(path: FigVectorPath): WindingRuleId {
  const rule = path.windingRule;
  if (!rule) { return "NONZERO"; }
  const name = typeof rule === "string" ? rule : rule.name;
  return name === "EVENODD" ? "EVENODD" : "NONZERO";
}

function makePath(): FigVectorPath {
  return {
    windingRule: "NONZERO",
    data: "M 0 0 L 100 0 L 100 100 L 0 100 Z",
  };
}

function normalizeCommandValues(type: PathEditableCommandType, values: readonly number[]): readonly number[] {
  const count = COMMAND_PARAM_COUNT[type];
  return Array.from({ length: count }, (_, index) => values[index] ?? 0);
}

function parsePathData(data: string): readonly PathEditableCommand[] | undefined {
  const tokens = data.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi);
  if (!tokens) {
    return [];
  }
  return parsePathTokens(tokens, 0, []);
}

function parsePathTokens(
  tokens: readonly string[],
  index: number,
  commands: readonly PathEditableCommand[],
): readonly PathEditableCommand[] | undefined {
  if (index >= tokens.length) {
    return commands;
  }
  const type = tokens[index]?.toUpperCase() as PathEditableCommandType | undefined;
  if (!type || COMMAND_PARAM_COUNT[type] === undefined) {
    return undefined;
  }
  const count = COMMAND_PARAM_COUNT[type];
  const values = tokens.slice(index + 1, index + 1 + count);
  if (values.length !== count || values.some((token) => /[A-Za-z]/.test(token))) {
    return undefined;
  }
  const command: PathEditableCommand = { type, values: values.map(Number) };
  return parsePathTokens(tokens, index + count + 1, [...commands, command]);
}

function serializePathData(commands: readonly PathEditableCommand[]): string {
  return commands
    .map((command) => [command.type, ...normalizeCommandValues(command.type, command.values)].join(" "))
    .join(" ");
}

function insertCommand(commands: readonly PathEditableCommand[], command: PathEditableCommand): readonly PathEditableCommand[] {
  const closeIndex = commands.findIndex((c) => c.type === "Z");
  if (closeIndex === -1) {
    return [...commands, command];
  }
  return [...commands.slice(0, closeIndex), command, ...commands.slice(closeIndex)];
}

function replaceCommandType(
  commands: readonly PathEditableCommand[],
  commandIndex: number,
  nextType: PathEditableCommandType,
): readonly PathEditableCommand[] {
  return commands.map((cmd, i) => {
    if (i !== commandIndex) {
      return cmd;
    }
    return { type: nextType, values: normalizeCommandValues(nextType, cmd.values) };
  });
}

/** Edits SVG path data stored on VECTOR-like fig nodes. */
export function VectorPathSection({ node, target, dispatch }: VectorPathSectionProps) {
  const paths = node.vectorPaths ?? [];

  const updatePaths = useCallback(
    (updater: (paths: readonly FigVectorPath[]) => readonly FigVectorPath[]) => {
      dispatch(createPropertyPrimaryUpdateAction({
        target,
        updater: (current) => ({ ...current, vectorPaths: updater(current.vectorPaths ?? []) }),
      }));
    },
    [dispatch, target],
  );

  const updatePath = useCallback(
    (index: number, updater: (path: FigVectorPath) => FigVectorPath) => {
      updatePaths((current) => current.map((path, i) => i === index ? updater(path) : path));
    },
    [updatePaths],
  );

  const items: readonly VectorPathItemView[] = useMemo(
    () => paths.map((path) => ({
      winding: windingName(path),
      raw: path.data ?? "",
      commands: parsePathData(path.data ?? ""),
    })),
    [paths],
  );

  return (
    <VectorPathSectionView
      paths={items}
      onAddPath={() => updatePaths((current) => [...current, makePath()])}
      onRemovePath={(index) => updatePaths((current) => current.filter((_, i) => i !== index))}
      onWindingChange={(index, winding) => updatePath(index, (current) => ({ ...current, windingRule: winding }))}
      onRawChange={(index, raw) => updatePath(index, (current) => ({ ...current, data: raw }))}
      onCommandTypeChange={(index, commandIndex, nextType) => updatePath(index, (current) => {
        const commands = parsePathData(current.data ?? "") ?? [];
        return { ...current, data: serializePathData(replaceCommandType(commands, commandIndex, nextType)) };
      })}
      onCommandValueChange={(index, commandIndex, valueIndex, value) => updatePath(index, (current) => {
        const commands = parsePathData(current.data ?? "") ?? [];
        const nextCommands = commands.map((cmd, i) => {
          if (i !== commandIndex) { return cmd; }
          const values = [...normalizeCommandValues(cmd.type, cmd.values)];
          values[valueIndex] = value;
          return { ...cmd, values };
        });
        return { ...current, data: serializePathData(nextCommands) };
      })}
      onAddPoint={(index) => updatePath(index, (current) => {
        const commands = parsePathData(current.data ?? "") ?? [];
        return { ...current, data: serializePathData(insertCommand(commands, { type: "L", values: [100, 100] })) };
      })}
      onAddCubic={(index) => updatePath(index, (current) => {
        const commands = parsePathData(current.data ?? "") ?? [];
        return { ...current, data: serializePathData(insertCommand(commands, { type: "C", values: [25, 25, 75, 75, 100, 100] })) };
      })}
    />
  );
}
