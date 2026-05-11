/**
 * @file Case `modal-style-centred-dialog` — multi-entry viewport-layer
 * lift. Two `position: fixed` siblings (scrim + dialog) must both
 * surface in `viewportLayer` with their captured geometry.
 */
import { normalizeViewport } from "../../../src/normalize";
import { synthViewport } from "../../synth-snapshot";
import { staticFontResolver } from "../../test-font-resolver";
import {
  DIALOG_RECT,
  DIALOG_TITLE,
  SCRIM_RECT,
  VIEWPORT,
  modalScrimAndDialog,
} from "./fixture";

describe("case modal-style-centred-dialog", () => {
  const ir = normalizeViewport(
    synthViewport({ viewport: VIEWPORT, children: modalScrimAndDialog() }),
    { fontResolver: staticFontResolver() },
  );

  it("lifts both fixed siblings out of the static root", () => {
    if (ir.root.kind !== "frame") {
      throw new Error("expected root frame");
    }
    expect(ir.root.children).toHaveLength(0);
  });

  it("registers exactly two viewport-layer entries (scrim + dialog)", () => {
    expect(ir.viewportLayer).toHaveLength(2);
  });

  it("preserves the scrim's full-viewport geometry", () => {
    const scrim = ir.viewportLayer[0]!;
    expect(scrim.box.width).toBe(SCRIM_RECT.width);
    expect(scrim.box.height).toBe(SCRIM_RECT.height);
  });

  it("preserves the dialog's centred geometry", () => {
    const dialog = ir.viewportLayer[1]!;
    expect(dialog.box.x).toBe(DIALOG_RECT.x);
    expect(dialog.box.y).toBe(DIALOG_RECT.y);
    expect(dialog.box.width).toBe(DIALOG_RECT.width);
    expect(dialog.box.height).toBe(DIALOG_RECT.height);
  });

  it("collapses the dialog title to a TEXT carrying the heading", () => {
    const dialog = ir.viewportLayer[1]!;
    if (dialog.kind !== "frame") {
      throw new Error("expected dialog frame");
    }
    const title = dialog.children[0];
    if (!title || title.kind !== "text") {
      throw new Error("expected dialog title text");
    }
    expect(title.characters).toBe(DIALOG_TITLE);
  });
});
