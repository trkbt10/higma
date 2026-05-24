/** @file Tests for Fig editor user intent resolution. */

import type { FigCreationMode } from "../FigEditorContext";
import { resolveFigUserIntent } from "./user-intent";

describe("resolveFigUserIntent", () => {
  it("keeps select mode as selection intent", () => {
    expect(resolveFigUserIntent("select")).toEqual({ kind: "select", mode: "select" });
  });

  it("keeps pen mode as path-edit intent", () => {
    expect(resolveFigUserIntent("pen")).toEqual({ kind: "path-edit", mode: "pen" });
  });

  it("maps active selected FigNode drag transform to selected FigNode drag transform intent", () => {
    expect(resolveFigUserIntent({
      mode: "select",
      selectedFigNodeDragTransformActive: true,
    })).toEqual({ kind: "selected-fig-node-drag-transform", mode: "select" });
  });

  it.each<FigCreationMode>([
    "frame",
    "rectangle",
    "ellipse",
    "line",
    "star",
    "polygon",
    "text",
  ])("maps %s mode to creation intent", (mode) => {
    expect(resolveFigUserIntent(mode)).toEqual({ kind: "create", mode });
  });
});
