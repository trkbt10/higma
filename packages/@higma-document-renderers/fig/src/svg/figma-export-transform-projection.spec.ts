/** @file Tests for SVG export transform projection. */

import { projectFigmaExportTransforms } from "./figma-export-transform-projection";
import type { SvgElementNode, SvgNode } from "./element-primitives";

function requireElement(node: SvgNode, name: string): SvgElementNode {
  if (node.kind !== "element") {
    throw new Error(`expected <${name}> element`);
  }
  if (node.name !== name) {
    throw new Error(`expected <${name}> element, got <${node.name}>`);
  }
  return node;
}

describe("projectFigmaExportTransforms", () => {
  it("keeps preserved geometry translations as transforms instead of rewriting rect x/y", () => {
    const root: SvgNode = {
      kind: "element",
      name: "svg",
      attrs: {},
      children: [{
        kind: "element",
        name: "g",
        attrs: { transform: "translate(447 364)" },
        children: [{
          kind: "element",
          name: "rect",
          attrs: { x: 0, y: 0, width: 114.142, height: 248, fill: "#f2f2f7" },
          children: [],
          selfClosing: true,
          transformProjection: "preserve",
        }],
        selfClosing: false,
      }],
      selfClosing: false,
    };

    const projectedRoot = requireElement(projectFigmaExportTransforms(root), "svg");
    const rectNode = requireElement(projectedRoot.children[0], "rect");

    expect(rectNode.attrs.transform).toBe("translate(447 364)");
    expect(rectNode.attrs.x).toBe(0);
    expect(rectNode.attrs.y).toBe(0);
  });

  it("prepends inherited translation to scaled user-space def geometry", () => {
    const root: SvgNode = {
      kind: "element",
      name: "svg",
      attrs: {},
      children: [{
        kind: "element",
        name: "g",
        attrs: { transform: "translate(10 20)" },
        children: [{
          kind: "element",
          name: "defs",
          attrs: {},
          children: [{
            kind: "element",
            name: "clipPath",
            attrs: { id: "clip-1" },
            children: [{
              kind: "element",
              name: "path",
              attrs: { d: "M0 0L1 0L1 1Z", transform: "scale(0.004)" },
              children: [],
              selfClosing: true,
            }],
            selfClosing: false,
          }],
          selfClosing: false,
        }],
        selfClosing: false,
      }],
      selfClosing: false,
    };

    const projectedRoot = requireElement(projectFigmaExportTransforms(root), "svg");
    const defsNode = requireElement(projectedRoot.children[0], "defs");
    const clipPathNode = requireElement(defsNode.children[0], "clipPath");
    const pathNode = requireElement(clipPathNode.children[0], "path");

    expect(pathNode.attrs.transform).toBe("translate(10 20) scale(0.004)");
  });

  it("keeps object-bounding-box image pattern transforms in pattern coordinates", () => {
    const root: SvgNode = {
      kind: "element",
      name: "svg",
      attrs: {},
      children: [{
        kind: "element",
        name: "g",
        attrs: { transform: "translate(120 40)" },
        children: [{
          kind: "element",
          name: "defs",
          attrs: {},
          children: [{
            kind: "element",
            name: "pattern",
            attrs: {
              id: "img-1",
              patternContentUnits: "objectBoundingBox",
              width: 1,
              height: 1,
            },
            children: [{
              kind: "element",
              name: "image",
              attrs: {
                href: "data:image/png;base64,AA==",
                width: 250,
                height: 250,
                transform: "scale(0.004)",
              },
              children: [],
              selfClosing: true,
            }],
            selfClosing: false,
          }],
          selfClosing: false,
        }],
        selfClosing: false,
      }],
      selfClosing: false,
    };

    const projectedRoot = requireElement(projectFigmaExportTransforms(root), "svg");
    const defsNode = requireElement(projectedRoot.children[0], "defs");
    const patternNode = requireElement(defsNode.children[0], "pattern");
    const imageNode = requireElement(patternNode.children[0], "image");

    expect(imageNode.attrs.transform).toBe("scale(0.004)");
  });

  it("preserves rotate and scale operations when translating gradient transforms", () => {
    const root: SvgNode = {
      kind: "element",
      name: "svg",
      attrs: {},
      children: [{
        kind: "element",
        name: "g",
        attrs: { transform: "translate(10 20)" },
        children: [{
          kind: "element",
          name: "defs",
          attrs: {},
          children: [{
            kind: "element",
            name: "linearGradient",
            attrs: {
              id: "lg-1",
              gradientUnits: "userSpaceOnUse",
              gradientTransform: "translate(-4.8417396511106325 -7.757561183531565) rotate(90) scale(85.78275332671902 41.245438803508655)",
            },
            children: [],
            selfClosing: false,
          }],
          selfClosing: false,
        }],
        selfClosing: false,
      }],
      selfClosing: false,
    };

    const projectedRoot = requireElement(projectFigmaExportTransforms(root), "svg");
    const defsNode = requireElement(projectedRoot.children[0], "defs");
    const gradientNode = requireElement(defsNode.children[0], "linearGradient");

    expect(gradientNode.attrs.gradientTransform).toBe("translate(5.15826034889 12.2424388165) rotate(90) scale(85.7827533267 41.2454388035)");
  });
});
