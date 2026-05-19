/** @file CanvasArea layout contract tests. */

import { render } from "@testing-library/react";
import { CanvasArea } from "./CanvasArea";

function expectZeroStyle(value: string): void {
  expect(["0", "0px"]).toContain(value);
}

describe("CanvasArea", () => {
  it("passes a non-collapsing flex container to the canvas host", () => {
    const { container } = render(
      <CanvasArea>
        <div data-testid="canvas-host">Canvas</div>
      </CanvasArea>,
    );
    const root = container.firstElementChild as HTMLElement | null;
    const wrapper = root?.querySelector("[data-testid='canvas-host']")?.parentElement;

    if (root === null || wrapper === undefined || wrapper === null) {
      throw new Error("CanvasArea did not render the canvas wrapper");
    }

    expect(root.style.width).toBe("100%");
    expect(root.style.height).toBe("100%");
    expectZeroStyle(root.style.minWidth);
    expectZeroStyle(root.style.minHeight);
    expect(wrapper.style.flex).toBe("1 1 0%");
    expectZeroStyle(wrapper.style.minWidth);
    expectZeroStyle(wrapper.style.minHeight);
  });
});
