/**
 * @file Tier-2 case `card-solid-radius-border-shadow-flex` — composes
 * five primitives to produce a "card with content stack" shape:
 *
 *   `withFlexColumn` ∘ `withDropShadow` ∘ `withUniformBorder`
 *     ∘ `withUniformRadius` ∘ `withSolidBg` ∘ `baseDiv`
 *
 * The fixture is exported so the case spec can import it; this is the
 * first composite that's meaningful enough to be reused (e.g. a
 * future Tier-3 "card-grid" could `withFlexRowGap(card)`).
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { baseDiv } from "../box-leaf/fixture";
import { withUniformBorder } from "../border-uniform/fixture";
import { withUniformRadius } from "../corner-radius-uniform/fixture";
import { withFlexColumn } from "../flex-column/fixture";
import { withDropShadow } from "../shadow-drop/fixture";
import { withSolidBg } from "../solid-bg/fixture";

/** Compose: solid bg + uniform radius + uniform border + drop shadow + flex column. */
export function elevatedCard(): RawElement {
  // Apply primitives in source order. Last applied wins for any
  // computedStyle key two helpers touch — none of these helpers
  // overlap on the same key in this composition.
  return withFlexColumn(
    withDropShadow(
      withUniformBorder(
        withUniformRadius(
          withSolidBg(
            baseDiv({ rect: { x: 0, y: 0, width: 320, height: 200 } }),
          ),
        ),
      ),
    ),
  );
}
