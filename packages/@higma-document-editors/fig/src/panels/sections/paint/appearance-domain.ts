/** @file Shared appearance mutation inputs. */
import type { FigNode } from "@higma-document-models/fig/types";

export type AppearanceNodePatch = Pick<FigNode, "fillPaints" | "strokePaints" | "effects" | "opacity" | "visible">;
