/** @file WebGL render surface sizing tests. */

import { syncWebGLCanvasRenderSurface, type WebGLCanvasRenderSurface } from "./render-surface";

function makeSurface(): WebGLCanvasRenderSurface {
  return {
    width: 0,
    height: 0,
    style: {
      width: "",
      height: "",
    },
  };
}

describe("syncWebGLCanvasRenderSurface", () => {
  it("sets backing and CSS size on the first render", () => {
    const canvas = makeSurface();

    syncWebGLCanvasRenderSurface({ canvas, width: 101.2, height: 50, pixelRatio: 2 });

    expect(canvas).toEqual({
      width: 203,
      height: 100,
      style: {
        width: "101.2px",
        height: "50px",
      },
    });
  });

  it("does not reassign an unchanged backing surface during viewport-only rerenders", () => {
    const assignments: string[] = [];
    const canvas = {
      widthValue: 200,
      heightValue: 100,
      style: {
        width: "100px",
        height: "50px",
      },
      get width(): number {
        return this.widthValue;
      },
      set width(value: number) {
        assignments.push(`width:${value}`);
        this.widthValue = value;
      },
      get height(): number {
        return this.heightValue;
      },
      set height(value: number) {
        assignments.push(`height:${value}`);
        this.heightValue = value;
      },
    };

    syncWebGLCanvasRenderSurface({ canvas, width: 100, height: 50, pixelRatio: 2 });

    expect(assignments).toEqual([]);
  });
});
