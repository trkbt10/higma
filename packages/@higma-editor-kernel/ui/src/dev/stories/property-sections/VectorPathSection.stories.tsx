/** @file VectorPathSectionView stories. */

import { useState, useMemo } from "react";
import {
  VectorPathSectionView,
  type PathEditableCommand,
  type PathEditableCommandType,
  type VectorPathItemView,
  type WindingRuleId,
} from "../../../property-sections";
import type { ComponentEntry, Story } from "../../types";

const COMMAND_PARAM_COUNT: Record<PathEditableCommandType, number> = {
  M: 2,
  L: 2,
  Q: 4,
  C: 6,
  Z: 0,
};

function normalizeValues(type: PathEditableCommandType, values: readonly number[]): readonly number[] {
  const count = COMMAND_PARAM_COUNT[type];
  return Array.from({ length: count }, (_, index) => values[index] ?? 0);
}

function parsePathData(data: string): readonly PathEditableCommand[] | undefined {
  const tokens = data.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi);
  if (!tokens) {
    return [];
  }
  return parseTokens(tokens, 0, []);
}

function parseTokens(
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
  return parseTokens(tokens, index + count + 1, [...commands, { type, values: values.map(Number) }]);
}

function serializePathData(commands: readonly PathEditableCommand[]): string {
  return commands
    .map((command) => [command.type, ...normalizeValues(command.type, command.values)].join(" "))
    .join(" ");
}

function insertBeforeClose(
  commands: readonly PathEditableCommand[],
  insertion: PathEditableCommand,
): readonly PathEditableCommand[] {
  const closeIndex = commands.findIndex((c) => c.type === "Z");
  if (closeIndex === -1) {
    return [...commands, insertion];
  }
  return [...commands.slice(0, closeIndex), insertion, ...commands.slice(closeIndex)];
}

type RawPath = { winding: WindingRuleId; raw: string };

function Interactive() {
  const [paths, setPaths] = useState<readonly RawPath[]>([
    { winding: "NONZERO", raw: "M 0 0 L 100 0 L 100 100 L 0 100 Z" },
  ]);

  const items: readonly VectorPathItemView[] = useMemo(
    () => paths.map((path) => ({
      winding: path.winding,
      raw: path.raw,
      commands: parsePathData(path.raw),
    })),
    [paths],
  );

  const updatePath = (index: number, updater: (path: RawPath) => RawPath) => {
    setPaths((current) => current.map((path, i) => i === index ? updater(path) : path));
  };

  return (
    <div style={{ width: 360 }}>
      <VectorPathSectionView
        paths={items}
        onAddPath={() => setPaths((current) => [...current, { winding: "NONZERO", raw: "M 0 0 L 100 0 L 100 100 L 0 100 Z" }])}
        onRemovePath={(index) => setPaths((current) => current.filter((_, i) => i !== index))}
        onWindingChange={(index, winding) => updatePath(index, (path) => ({ ...path, winding }))}
        onRawChange={(index, raw) => updatePath(index, (path) => ({ ...path, raw }))}
        onCommandTypeChange={(index, commandIndex, nextType) => updatePath(index, (path) => {
          const commands = parsePathData(path.raw) ?? [];
          const next = commands.map((cmd, i) => i === commandIndex ? { type: nextType, values: normalizeValues(nextType, cmd.values) } : cmd);
          return { ...path, raw: serializePathData(next) };
        })}
        onCommandValueChange={(index, commandIndex, valueIndex, value) => updatePath(index, (path) => {
          const commands = parsePathData(path.raw) ?? [];
          const next = commands.map((cmd, i) => {
            if (i !== commandIndex) { return cmd; }
            const values = [...normalizeValues(cmd.type, cmd.values)];
            values[valueIndex] = value;
            return { ...cmd, values };
          });
          return { ...path, raw: serializePathData(next) };
        })}
        onAddPoint={(index) => updatePath(index, (path) => {
          const commands = parsePathData(path.raw) ?? [];
          const insertion: PathEditableCommand = { type: "L", values: [100, 100] };
          return { ...path, raw: serializePathData(insertBeforeClose(commands, insertion)) };
        })}
        onAddCubic={(index) => updatePath(index, (path) => {
          const commands = parsePathData(path.raw) ?? [];
          const insertion: PathEditableCommand = { type: "C", values: [25, 25, 75, 75, 100, 100] };
          return { ...path, raw: serializePathData(insertBeforeClose(commands, insertion)) };
        })}
      />
    </div>
  );
}

const interactive: Story = { name: "Interactive", render: () => <Interactive /> };

export const VectorPathSectionStories: ComponentEntry = {
  name: "VectorPathSection",
  description: "Vector path raw + structured command editor.",
  stories: [interactive],
};
