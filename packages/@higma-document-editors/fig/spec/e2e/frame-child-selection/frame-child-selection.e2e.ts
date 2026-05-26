/** @file Browser coverage for selecting elements inside frames. */

import { expect, test } from "@playwright/test";
import {
  clickNodeAt,
  FRAME,
  FRAME_CHILD,
  openEditor,
  selectionBoxPageBounds,
} from "../shared/fig-editor-harness";

const INNER_FRAME = { guidKey: "1:10", pageX: 548, pageY: 322, width: 160, height: 110 };

test.describe("Fig editor frame hit testing", () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page, "?renderer=svg");
  });

  test("selects a child element inside a frame instead of letting the frame absorb the click", async ({ page }) => {
    await clickNodeAt(page, FRAME, { x: 0.86, y: 0.84 });
    await expect.poll(() => selectionBoxPageBounds(page)).toEqual(FRAME);

    await clickNodeAt(page, INNER_FRAME, { x: 0.9, y: 0.86 });
    await expect.poll(() => selectionBoxPageBounds(page)).toEqual(INNER_FRAME);

    await clickNodeAt(page, FRAME_CHILD, { x: 0.5, y: 0.5 });
    await expect.poll(() => selectionBoxPageBounds(page)).toEqual(FRAME_CHILD);
  });
});
