#!/usr/bin/env bun
/**
 * @file Quick probe — dump the structural skeleton of a `.fig` fixture
 * so we can reason about which fields the emitter will encounter
 * before wiring it through the full visual round-trip.
 *
 *   bun run scripts/probe-fig.ts cases/<name>/source.fig
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createFigDocumentContext } from "@higma-document-io/fig/context";
import type { FigNode } from "@higma-document-models/fig/types";
import type { FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";

function readEnumName(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "name" in value) {
    const named = (value as { name?: unknown }).name;
    return typeof named === "string" ? named : undefined;
  }
  return undefined;
}

function formatStrokeWeight(weight: unknown): string {
  if (typeof weight === "object" && weight !== null) {
    return JSON.stringify(weight);
  }
  return String(weight);
}

function formatTransform(t: Record<string, number>): string {
  const a = (t.m00 ?? 1).toFixed(3);
  const b = (t.m01 ?? 0).toFixed(3);
  const c = (t.m02 ?? 0).toFixed(3);
  const d = (t.m10 ?? 0).toFixed(3);
  const e = (t.m11 ?? 1).toFixed(3);
  const f = (t.m12 ?? 0).toFixed(3);
  return ` t=[${a},${b},${c};${d},${e},${f}]`;
}

type ProbedStop = {
  readonly position?: number;
  readonly color?: { readonly r?: number; readonly g?: number; readonly b?: number; readonly a?: number };
};

function formatStop(s: ProbedStop): string {
  const r = (s.color?.r ?? 0).toFixed(2);
  const g = (s.color?.g ?? 0).toFixed(2);
  const b = (s.color?.b ?? 0).toFixed(2);
  const a = (s.color?.a ?? 1).toFixed(2);
  return `(@${(s.position ?? 0).toFixed(2)} rgba=${r},${g},${b},${a})`;
}

function describePaint(p: unknown): string {
  if (!p || typeof p !== "object") {
    return "?";
  }
  const obj = p as Record<string, unknown>;
  const type = readEnumName(obj.type) ?? "?";
  const visible = obj.visible === false ? " hidden" : "";
  const t = obj.transform as Record<string, number> | undefined;
  const tStr = t ? formatTransform(t) : "";
  const stopsRaw = obj.stops as ReadonlyArray<ProbedStop> | undefined;
  const stopsStr = stopsRaw && stopsRaw.length > 0 ? ` stops=[${stopsRaw.map(formatStop).join(",")}]` : "";
  return `${type}${visible}${tStr}${stopsStr}`;
}

function walk(node: FigNode, childrenOf: FigKiwiDocumentIndex["childrenOf"], depth = 0): void {
  const ind = "  ".repeat(depth);
  const props: string[] = [];
  if (node.size) {
    props.push(`size=${node.size.x}×${node.size.y}`);
  }
  if (node.fillPaints?.length) {
    props.push(`fills=[${node.fillPaints.map(describePaint).join(",")}]`);
  }
  if (node.strokePaints?.length) {
    props.push(`strokes=[${node.strokePaints.map(describePaint).join(",")}]`);
  }
  if (node.strokeWeight !== undefined) {
    const sw = formatStrokeWeight(node.strokeWeight);
    props.push(`strokeW=${sw}`);
  }
  if (node.strokeAlign !== undefined) {
    props.push(`strokeAlign=${readEnumName(node.strokeAlign) ?? "?"}`);
  }
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    props.push(`r=${node.cornerRadius}`);
  }
  if (node.effects?.length) {
    const summary = node.effects.map((e) => {
      const tname = readEnumName(e.type) ?? "?";
      const r = (e as { radius?: number }).radius ?? 0;
      const ox = (e as { offset?: { x?: number } }).offset?.x ?? 0;
      const oy = (e as { offset?: { y?: number } }).offset?.y ?? 0;
      const ca = (e as { color?: { a?: number } }).color?.a ?? 0;
      return `${tname}(r=${r} dx=${ox} dy=${oy} a=${ca})`;
    });
    props.push(`effects=[${summary.join(",")}]`);
  }
  if (node.dashPattern?.length) {
    props.push(`dash=[${node.dashPattern.join(",")}]`);
  }
  if (node.opacity !== undefined && node.opacity !== 1) {
    props.push(`o=${node.opacity}`);
  }
  if (typeof node.cornerSmoothing === "number" && node.cornerSmoothing > 0) {
    props.push(`cornerSmoothing=${node.cornerSmoothing}`);
  }
  const padU = node.stackPadding;
  const padH = node.stackHorizontalPadding;
  const padV = node.stackVerticalPadding;
  const padR = node.stackPaddingRight;
  const padB = node.stackPaddingBottom;
  if (padU !== undefined || padH !== undefined || padV !== undefined || padR !== undefined || padB !== undefined) {
    props.push(`pad=[u${padU ?? "?"},h${padH ?? "?"},v${padV ?? "?"},r${padR ?? "?"},b${padB ?? "?"}]`);
  }
  if (node.stackSpacing !== undefined) {
    props.push(`stackSpacing=${node.stackSpacing}`);
  }
  if (node.stackMode !== undefined) {
    props.push(`stackMode=${readEnumName(node.stackMode) ?? "?"}`);
  }
  if (node.frameMaskDisabled !== undefined) {
    props.push(`frameMaskDisabled=${node.frameMaskDisabled}`);
  }
  if (node.clipsContent !== undefined) {
    props.push(`clipsContent=${node.clipsContent}`);
  }
  if (node.transform) {
    const m00 = node.transform.m00 ?? 1;
    const m10 = node.transform.m10 ?? 0;
    props.push(`xy=${node.transform.m02 ?? 0},${node.transform.m12 ?? 0}`);
    if (Math.abs(m10) > 1e-6 || Math.abs(m00 - 1) > 1e-6) {
      props.push(`m=[${m00.toFixed(3)},${(node.transform.m01 ?? 0).toFixed(3)},${m10.toFixed(3)},${(node.transform.m11 ?? 1).toFixed(3)}]`);
    }
  }
  console.log(`${ind}${node.type.name} "${node.name ?? ""}" ${props.join(" ")}`);
  for (const child of childrenOf(node)) {
    walk(child, childrenOf, depth + 1);
  }
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    process.stderr.write("usage: bun run scripts/probe-fig.ts <path-to-fig>\n");
    process.exit(2);
  }
  const figPath = resolve(process.cwd(), arg);
  const bytes = new Uint8Array(await readFile(figPath));
  const ctx = await createFigDocumentContext(bytes);
  const doc = ctx.document.roots.find((r) => r.type.name === "DOCUMENT");
  if (!doc) {
    throw new Error("no DOCUMENT root");
  }
  for (const canvas of ctx.document.childrenOf(doc)) {
    if (canvas.type.name !== "CANVAS") {
      continue;
    }
    if (canvas.internalOnly === true) {
      continue;
    }
    console.log(`# CANVAS "${canvas.name}"`);
    for (const child of ctx.document.childrenOf(canvas)) {
      walk(child, ctx.document.childrenOf);
    }
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
