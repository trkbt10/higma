/**
 * @file Site editor render surface tests.
 */

import { createSiteEditorTestDocument } from "../spec/shared/site-editor-test-fixture";
import type { FigNode } from "@higma-document-models/fig/types";
import { createSiteEditorWorkspace, createSiteFigRenderSurface } from "./site-editor-workspace";

function collectNodeNames(nodes: readonly FigNode[]): readonly string[] {
  return nodes.flatMap((node) => {
    if (node.name === undefined) {
      throw new Error("expected named fig node in site editor fixture");
    }
    if (node.children === undefined) {
      return [node.name];
    }
    const children = node.children.flatMap((child) => {
      if (child === null || child === undefined) {
        return [];
      }
      return [child];
    });
    const childNames = collectNodeNames(children);
    return [node.name, ...childNames];
  });
}

describe("createSiteFigRenderSurface", () => {
  it("filters the fig renderer input to active breakpoint variant subtrees", () => {
    const document = createSiteEditorTestDocument();
    const workspace = createSiteEditorWorkspace(document);
    const mobileSurface = createSiteFigRenderSurface(document, {
      activeSurfaceId: null,
      activeBreakpointName: "Mobile",
      breakpointVariants: workspace.breakpointVariants,
    });
    const names = collectNodeNames(mobileSurface.nodes);

    expect(names).toContain("Mobile");
    expect(names).toContain("Mobile Articles");
    expect(names).not.toContain("Desktop");
    expect(names).not.toContain("Tablet");
    expect(names).not.toContain("Articles");
    expect(names).not.toContain("Tablet Articles");
  });

  it("filters the fig renderer input to the active site surface and breakpoint", () => {
    const document = createSiteEditorTestDocument();
    const workspace = createSiteEditorWorkspace(document);
    const activeSurface = workspace.surfaces.find((surface) => surface.label === "Case Study Page");
    if (!activeSurface) {
      throw new Error("Expected test fixture to expose a Case Study Page surface");
    }
    const tabletSurface = createSiteFigRenderSurface(document, {
      activeSurfaceId: activeSurface.id,
      activeBreakpointName: "Tablet",
      breakpointVariants: workspace.breakpointVariants,
    });
    const names = collectNodeNames(tabletSurface.nodes);

    expect(names).toContain("Tablet");
    expect(names).toContain("Tablet Articles");
    expect(names).not.toContain("Desktop");
    expect(names).not.toContain("Mobile");
    expect(names).not.toContain("Articles");
    expect(names).not.toContain("Mobile Articles");
  });
});
