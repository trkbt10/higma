/** @file Canvas pointer drag threshold helpers. */

import { isDragThresholdExceeded } from "@higma-editor-kernel/core/drag-utils";

type ExceedsThresholdOptions = {
  readonly startClientX: number;
  readonly startClientY: number;
  readonly clientX: number;
  readonly clientY: number;
};

/** Return whether a pointer has moved far enough to start a drag operation. */
export function exceedsThreshold(
  { startClientX, startClientY, clientX, clientY }: ExceedsThresholdOptions,
): boolean {
  return isDragThresholdExceeded({
    startX: startClientX,
    startY: startClientY,
    currentX: clientX,
    currentY: clientY,
  });
}
