/**
 * @file Selectable list row — single source of truth for any panel that
 * renders a vertical list of selectable items (Pages, Layers, future
 * Variables / Assets / etc.).
 *
 * Why a single source of truth
 * ----------------------------
 * The Pages list and the Layers tree both render the same shape: a
 * vertically-stacked list of selectable items with hover, keyboard
 * focus, selection, and drag-reorder affordances. Without a SoT, each
 * panel grew its own row implementation. Symptoms operators saw:
 *
 *   - Row heights diverged.
 *   - Border-radius on Pages rows curved the focus outline and the
 *     drop-indicator into rounded "stickers" — the "挿入罫線にRが
 *     かかっている" critique.
 *   - Selection / hover colour families diverged.
 *
 * Styling contract
 * ----------------
 * The row's appearance lives entirely in `SelectableListRow.module.css`.
 * Consumers
 *   1. apply `LIST_ROW_CLASS_NAME` (the CSS-Module hashed class) to
 *      the row element,
 *   2. spread `listRowDataAttributes(state)` onto it to communicate
 *      the row's visual state — drop-before / drop-after / dragging.
 *      Active state is communicated via the row's `aria-selected`
 *      attribute (which the consumer must set anyway for the row's
 *      ARIA semantics — there is no separate "selected" data attribute
 *      that duplicates it).
 *
 * No imperative `document.createElement` style injection, no `<style>`
 * JSX, no side-effect CSS imports, no class-name branching at the
 * call site. The CSS Module import returns a usable object (the class
 * map), so the import is JS-used, not side-effect-only.
 *
 * Design choices
 * --------------
 *   - **Zero border-radius**. Documented in the .module.css file.
 *   - **Fixed height (28px)**. Matches react-editor-ui's
 *     `size-layer-item-height` default so a Pages list and a Layers
 *     tree placed in the same panel align on a 28px grid. Exposed as
 *     `LIST_ROW_HEIGHT_PX` for consumers that need to size containers.
 *   - **Inline padding only**. Vertical centering uses
 *     `align-items: center` on the row's flex axis; no vertical
 *     padding means the 28px height is exact, not approximate.
 *   - **Selection tint = `selection.primary @ 12%`**, **hover =
 *     `selection.primary @ 6%`** — see the .module.css for the
 *     literal alpha values.
 *   - **Focus-visible = 2px solid `selection.primary` outline at
 *     `outline-offset: -1px`**. WCAG 2.4.7 needs ≥ 3:1 against
 *     adjacent colours; `#0066ff` vs panel white is 4.94:1.
 *   - **Drop indicator = inset `box-shadow` 2px** drawn via
 *     `[data-drop="before"]` / `[data-drop="after"]` selectors. With
 *     border-radius 0 the shadow draws a true horizontal line at the
 *     row's edge.
 */

import styles from "./SelectableListRow.module.css";

/** Fixed row height in pixels. Matches the .module.css `.row` height. */
export const LIST_ROW_HEIGHT_PX = 28;

/**
 * Class name applied to every list row. The CSS Module hashes this so
 * the rules in `SelectableListRow.module.css` apply only to consumers
 * that import this constant — there is no global `.higuma-list-row`
 * leaking into unrelated DOM.
 */
export const LIST_ROW_CLASS_NAME: string = styles.row;

/** Visual-state inputs the row composes from. */
export type ListRowVisualState = {
  /** Cursor is hovering over a row that would receive a drop above it. */
  readonly dropBefore: boolean;
  /** Cursor is hovering over a row that would receive a drop below it. */
  readonly dropAfter: boolean;
  /** This row is the source of an in-progress drag. */
  readonly dragging: boolean;
};

/**
 * Attribute set the consumer spreads onto the row's JSX element so
 * the CSS Module's `[data-drop]` / `[data-dragging]` selectors fire.
 * Active state is read from `aria-selected` directly — the consumer
 * already sets that for ARIA semantics and there is no need to
 * duplicate it as a data attribute.
 *
 * The returned shape uses `undefined` for the "off" state so React
 * omits the attribute entirely rather than rendering `data-drop=""`,
 * which would still match `[data-drop]` (presence-only selectors).
 */
export type ListRowDataAttributes = {
  readonly "data-drop"?: "before" | "after";
  readonly "data-dragging"?: "true";
};

export function listRowDataAttributes(state: ListRowVisualState): ListRowDataAttributes {
  return {
    "data-drop": state.dropBefore ? "before" : state.dropAfter ? "after" : undefined,
    "data-dragging": state.dragging ? "true" : undefined,
  };
}
