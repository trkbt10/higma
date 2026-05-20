/** @file Static contract checks for WebGL consumption of RenderTree nodes. */

import type {
  RenderNode,
  RenderTree,
  StrokeRendering,
} from "../../scene-graph";
import { createWebGLPathFillPlan } from "../fill/render-path-fill-plan";

export type WebGLRenderTreeContractIssue = {
  readonly nodeId: string;
  readonly nodeType: RenderNode["type"];
  readonly message: string;
};

export type WebGLRenderTreeContractStats = {
  readonly nodes: number;
  readonly groups: number;
  readonly frames: number;
  readonly rects: number;
  readonly ellipses: number;
  readonly paths: number;
  readonly texts: number;
  readonly images: number;
  readonly pathContours: number;
  readonly pathFillInstructions: number;
  readonly clippedFrames: number;
  readonly strokeRenderings: number;
  readonly glyphTexts: number;
  readonly lineTexts: number;
  readonly issues: readonly WebGLRenderTreeContractIssue[];
};

type MutableStats = {
  nodes: number;
  groups: number;
  frames: number;
  rects: number;
  ellipses: number;
  paths: number;
  texts: number;
  images: number;
  pathContours: number;
  pathFillInstructions: number;
  clippedFrames: number;
  strokeRenderings: number;
  glyphTexts: number;
  lineTexts: number;
  issues: WebGLRenderTreeContractIssue[];
};

function emptyStats(): MutableStats {
  return {
    nodes: 0,
    groups: 0,
    frames: 0,
    rects: 0,
    ellipses: 0,
    paths: 0,
    texts: 0,
    images: 0,
    pathContours: 0,
    pathFillInstructions: 0,
    clippedFrames: 0,
    strokeRenderings: 0,
    glyphTexts: 0,
    lineTexts: 0,
    issues: [],
  };
}

function addIssue(stats: MutableStats, node: RenderNode, message: string): void {
  stats.issues.push({ nodeId: node.id, nodeType: node.type, message });
}

function countStrokeRendering(stats: MutableStats, strokeRendering: StrokeRendering | undefined): void {
  if (strokeRendering) {
    stats.strokeRenderings += 1;
  }
}

function auditFrame(node: Extract<RenderNode, { type: "frame" }>, stats: MutableStats): void {
  stats.frames += 1;
  if (node.width <= 0 || node.height <= 0) {
    addIssue(stats, node, "frame dimensions must be positive");
  }
  if (node.sourceFills.length !== node.source.fills.length) {
    addIssue(stats, node, "frame sourceFills must mirror source.fills");
  }
  if (node.sourceStroke !== node.source.stroke) {
    addIssue(stats, node, "frame sourceStroke must mirror source.stroke");
  }
  if (node.sourceSurfaceShape !== node.source.surfaceShape) {
    addIssue(stats, node, "frame sourceSurfaceShape must mirror source.surfaceShape");
  }
  countStrokeRendering(stats, node.background?.strokeRendering);
  if (node.childClipId) {
    stats.clippedFrames += 1;
    const hasClipDef = node.defs.some((def) => def.type === "clip-path" && def.id === node.childClipId);
    if (!hasClipDef) {
      addIssue(stats, node, "childClipId must resolve to a local clip-path def");
    }
  }
}

function auditRect(node: Extract<RenderNode, { type: "rect" }>, stats: MutableStats): void {
  stats.rects += 1;
  if (node.width <= 0 || node.height <= 0) {
    addIssue(stats, node, "rect dimensions must be positive");
  }
  if (node.sourceFills.length !== node.source.fills.length) {
    addIssue(stats, node, "rect sourceFills must mirror source.fills");
  }
  if (node.sourceStroke !== node.source.stroke) {
    addIssue(stats, node, "rect sourceStroke must mirror source.stroke");
  }
  countStrokeRendering(stats, node.strokeRendering);
}

function auditEllipse(node: Extract<RenderNode, { type: "ellipse" }>, stats: MutableStats): void {
  stats.ellipses += 1;
  if (node.rx <= 0 || node.ry <= 0) {
    addIssue(stats, node, "ellipse radii must be positive");
  }
  if (node.sourceFills.length !== node.source.fills.length) {
    addIssue(stats, node, "ellipse sourceFills must mirror source.fills");
  }
  if (node.sourceStroke !== node.source.stroke) {
    addIssue(stats, node, "ellipse sourceStroke must mirror source.stroke");
  }
  countStrokeRendering(stats, node.strokeRendering);
}

function auditPath(node: Extract<RenderNode, { type: "path" }>, stats: MutableStats): void {
  stats.paths += 1;
  const plan = createWebGLPathFillPlan(node);
  stats.pathContours += node.paths.length;
  stats.pathFillInstructions += plan.length;
  if (plan.length !== node.paths.length) {
    addIssue(stats, node, "path fill plan must preserve RenderPathContour cardinality");
  }
  node.paths.forEach((renderPath, index) => {
    const instruction = plan[index];
    if (!instruction) {
      addIssue(stats, node, `missing WebGL fill instruction for path contour ${index}`);
      return;
    }
    const expectedFillRule = renderPath.fillRule ?? "nonzero";
    if (instruction.fillRule !== expectedFillRule) {
      addIssue(stats, node, `path contour ${index} fillRule differs from RenderTree`);
    }
  });
  if (node.sourceFills.length !== node.source.fills.length) {
    addIssue(stats, node, "path sourceFills must mirror source.fills");
  }
  if (node.sourceStroke !== node.source.stroke) {
    addIssue(stats, node, "path sourceStroke must mirror source.stroke");
  }
  countStrokeRendering(stats, node.strokeRendering);
}

function auditText(node: Extract<RenderNode, { type: "text" }>, stats: MutableStats): void {
  stats.texts += 1;
  if (node.height <= 0) {
    addIssue(stats, node, "text height must be positive");
  }
  if (node.content.mode === "glyphs") {
    stats.glyphTexts += 1;
    const totalDLength = node.content.runs.reduce((acc, r) => acc + r.d.length, 0);
    if (totalDLength > 0 && node.width <= 0) {
      addIssue(stats, node, "glyph text with path data must have positive width");
    }
    if (totalDLength === 0 && node.sourceTextLineLayout === undefined) {
      addIssue(stats, node, "glyph text must have path data or explicit line-layout resolution before WebGL rendering");
    }
    return;
  }
  stats.lineTexts += 1;
  addIssue(stats, node, "WebGL requires glyph text; RenderTextLines must be resolved before WebGL rendering");
  if (node.content.layout.lines.length === 0) {
    addIssue(stats, node, "line text must expose at least one layout line");
  }
  const hasVisibleText = node.content.layout.lines.some((line) => line.text.trim().length > 0);
  if (hasVisibleText && node.width <= 0) {
    addIssue(stats, node, "line text with visible characters must have positive width");
  }
}

function auditImage(node: Extract<RenderNode, { type: "image" }>, stats: MutableStats): void {
  stats.images += 1;
  if (node.width <= 0 || node.height <= 0) {
    addIssue(stats, node, "image dimensions must be positive");
  }
  if (node.sourceImageHash.length === 0) {
    addIssue(stats, node, "image must expose sourceImageHash for WebGL texture lookup");
  }
  if (node.sourceData.length === 0) {
    addIssue(stats, node, "image must expose sourceData for WebGL texture creation");
  }
}

function auditNode(node: RenderNode, stats: MutableStats): void {
  stats.nodes += 1;
  switch (node.type) {
    case "group":
      stats.groups += 1;
      for (const child of node.children) {
        auditNode(child, stats);
      }
      break;
    case "frame":
      auditFrame(node, stats);
      for (const child of node.children) {
        auditNode(child, stats);
      }
      break;
    case "rect":
      auditRect(node, stats);
      break;
    case "ellipse":
      auditEllipse(node, stats);
      break;
    case "path":
      auditPath(node, stats);
      break;
    case "text":
      auditText(node, stats);
      break;
    case "image":
      auditImage(node, stats);
      break;
  }
}

/** Audit a RenderTree for WebGL SoT consumption invariants. */
export function auditWebGLRenderTreeContract(renderTree: RenderTree): WebGLRenderTreeContractStats {
  const stats = emptyStats();
  for (const child of renderTree.children) {
    auditNode(child, stats);
  }
  return stats;
}
