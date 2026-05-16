/**
 * @file Layout smoke tests for GradientPaintControlsView.
 *
 * These tests pin the operational structure that the earlier
 * 6-inputs-in-one-row layout broke: each gradient handle owns its own
 * labelled row with two coordinate inputs, so the user can identify and
 * adjust a specific handle (Start / End / Width / Focal) by name rather
 * than guessing which of six adjacent flex-shrunk inputs belongs to which
 * point.
 */

import { render, screen } from "@testing-library/react";
import { GradientPaintControlsView } from "./GradientPaintControlsView";
import type { GradientHandleView, GradientStopView } from "./paint-view-model";

const stops: readonly GradientStopView[] = [
  { position: 0, hex: "#000000", alpha: 1 },
  { position: 1, hex: "#ffffff", alpha: 1 },
];

const linearHandles: readonly GradientHandleView[] = [
  { x: 0, y: 0.5 },
  { x: 1, y: 0.5 },
  { x: 0, y: 1 },
];

function noop() {}

describe("GradientPaintControlsView", () => {
  it("renders one row per handle with a written label", () => {
    render(
      <GradientPaintControlsView
        labelPrefix="Fill"
        paintIndex={0}
        stops={stops}
        handles={linearHandles}
        onStopChange={noop}
        onAddStop={noop}
        onRemoveStop={noop}
        onHandleChange={noop}
      />,
    );

    expect(screen.getByText("Start")).toBeTruthy();
    expect(screen.getByText("End")).toBeTruthy();
    expect(screen.getByText("Width")).toBeTruthy();
  });

  it("renders X and Y inputs for every handle", () => {
    render(
      <GradientPaintControlsView
        labelPrefix="Fill"
        paintIndex={0}
        stops={stops}
        handles={linearHandles}
        onStopChange={noop}
        onAddStop={noop}
        onRemoveStop={noop}
        onHandleChange={noop}
      />,
    );

    for (let handleIndex = 0; handleIndex < linearHandles.length; handleIndex += 1) {
      expect(
        screen.getByLabelText(`Fill gradient handle ${handleIndex + 1} x 1`),
      ).toBeTruthy();
      expect(
        screen.getByLabelText(`Fill gradient handle ${handleIndex + 1} y 1`),
      ).toBeTruthy();
    }
  });

  it("falls back to a numbered label when there are more handles than named slots", () => {
    const manyHandles: readonly GradientHandleView[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 0.5, y: 0.5 },
    ];

    render(
      <GradientPaintControlsView
        labelPrefix="Fill"
        paintIndex={0}
        stops={stops}
        handles={manyHandles}
        onStopChange={noop}
        onAddStop={noop}
        onRemoveStop={noop}
        onHandleChange={noop}
      />,
    );

    expect(screen.getByText("Handle 5 / 5")).toBeTruthy();
  });
});
