/**
 * @file `flex-justify-space-between` — apply `justify-content:
 * space-between` to a `RawElement` already configured as a flex row.
 * Composes on top of `flex-row-gap`.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { withFlexRowGap } from "../flex-row-gap/fixture";

/** Apply `justify-content: space-between` on top of the flex-row-gap shape. */
export function withFlexRowSpaceBetween(parent: RawElement): RawElement {
  const flexed = withFlexRowGap(parent);
  return {
    ...flexed,
    computedStyle: {
      ...flexed.computedStyle,
      "justify-content": "space-between",
    },
  };
}
