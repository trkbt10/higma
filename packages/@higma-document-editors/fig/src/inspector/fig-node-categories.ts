/** @file Kiwi node category labels for inspector UI. */
import { getNodeType } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import type { NodeCategoryRegistry } from "@higma-editor-kernel/core/inspector-types";

export type FigNodeCategory = "page" | "component" | "instance" | "text" | "shape" | "container";

export const FIG_LEGEND_ORDER: readonly FigNodeCategory[] = [
  "page",
  "container",
  "component",
  "instance",
  "text",
  "shape",
];

export const FIG_NODE_CATEGORY_REGISTRY: NodeCategoryRegistry = {
  categories: {
    page: { color: "#0ea5e9", label: "Page" },
    container: { color: "#2563eb", label: "Container" },
    component: { color: "#8b5cf6", label: "Component" },
    instance: { color: "#a855f7", label: "Instance" },
    text: { color: "#16a34a", label: "Text" },
    shape: { color: "#f97316", label: "Shape" },
  },
  getCategory(nodeType) {
    switch (nodeType) {
      case "CANVAS":
        return "page";
      case "SYMBOL":
        return "component";
      case "INSTANCE":
        return "instance";
      case "TEXT":
        return "text";
      case "FRAME":
      case "GROUP":
      case "SECTION":
        return "container";
      default:
        return "shape";
    }
  },
  fallback: { color: "#64748b", label: "Unknown" },
};

/** Classify a Kiwi node into the inspector's compact category set. */
export function classifyFigNode(node: FigNode): FigNodeCategory {
  const type = getNodeType(node);
  if (type === "CANVAS") {
    return "page";
  }
  if (type === "SYMBOL") {
    return "component";
  }
  if (type === "INSTANCE") {
    return "instance";
  }
  if (type === "TEXT") {
    return "text";
  }
  if (type === "FRAME" || type === "GROUP" || type === "SECTION") {
    return "container";
  }
  return "shape";
}
