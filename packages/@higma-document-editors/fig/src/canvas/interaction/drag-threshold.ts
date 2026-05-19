/** @file Pointer drag threshold predicate. */

/** Return true when a pointer move exceeds the explicit pixel threshold. */
export function exceedsThreshold({
  startClientX,
  startClientY,
  clientX,
  clientY,
  thresholdPx,
}: {
  readonly startClientX: number;
  readonly startClientY: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly thresholdPx: number;
}): boolean {
  return Math.hypot(clientX - startClientX, clientY - startClientY) > thresholdPx;
}
