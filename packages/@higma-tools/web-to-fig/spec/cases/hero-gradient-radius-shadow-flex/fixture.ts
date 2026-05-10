/**
 * @file Tier-2 case `hero-gradient-radius-shadow-flex` — paints the
 * card with a *gradient* instead of a solid bg, layering the same
 * radius / shadow / flex on top. Distinct from `card-...-flex` so a
 * regression in the gradient path doesn't hide behind a passing solid
 * card; Tier-2 cases stay parallel siblings rather than a single
 * monolithic composite.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { baseDiv } from "../box-leaf/fixture";
import { withUniformRadius } from "../corner-radius-uniform/fixture";
import { withFlexColumn } from "../flex-column/fixture";
import { withLinearGradient } from "../gradient-linear/fixture";
import { withDropShadow } from "../shadow-drop/fixture";

/** Compose: linear gradient bg + uniform radius + drop shadow + flex column. */
export function heroPanel(): RawElement {
  return withFlexColumn(
    withDropShadow(
      withUniformRadius(
        withLinearGradient(
          baseDiv({ rect: { x: 0, y: 0, width: 800, height: 400 } }),
        ),
      ),
    ),
  );
}
