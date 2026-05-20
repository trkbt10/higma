/**
 * @file Multi-selection state model used by the layers panel, the
 * canvas hit-testing path, and the inspect panel.
 *
 * Three click behaviours need to stay coherent across both surfaces
 * (the tree on the left and the canvas in the middle):
 *
 *   - Replace: a plain click drops the previous selection and picks
 *     exactly one node.
 *   - Toggle: a Cmd/Ctrl-click flips a node's membership without
 *     touching the rest of the set.
 *   - Range: a Shift-click selects every node between the current
 *     primary and the new target in painter order, inclusive.
 *
 * Painter order is the DFS pre-order produced by `computeNodeBounds`,
 * which is also the order the layers tree paints rows. Driving range
 * selection from one canonical id list keeps the canvas and the tree
 * in agreement: a Shift-click on either surface selects the same run.
 *
 * Keys stored here are `guidToString(node.guid)` values from the Kiwi
 * document. `primaryId` is tracked separately from the membership set so that
 * subsequent Shift-clicks anchor on the *last* explicit pick — the
 * convention every vector tool (Figma, Sketch, Illustrator, Finder)
 * follows. Without that anchor the range would always grow from the
 * first selected node, which feels wrong as soon as the user clicks
 * twice.
 */

export type SelectionState = {
  readonly ids: readonly string[];
  readonly primaryId: string | null;
};

export type SelectionModifiers = {
  readonly meta: boolean;
  readonly shift: boolean;
};

export const EMPTY_SELECTION: SelectionState = { ids: [], primaryId: null };

/** Return whether `id` is present in the current selection. */
export function isIdSelected(state: SelectionState, id: string): boolean {
  return state.ids.includes(id);
}

/** Convert the ordered selection ids into a Set for membership checks. */
export function selectionAsSet(state: SelectionState): ReadonlySet<string> {
  return new Set(state.ids);
}

/** Create a single-id selection with that id as the range anchor. */
export function replaceSelection(id: string): SelectionState {
  return { ids: [id], primaryId: id };
}

/** Clear all selected ids and the range anchor. */
export function clearSelection(): SelectionState {
  return EMPTY_SELECTION;
}

/** Apply a mouse click selection command to the current state. */
export function applyClickSelection(
  state: SelectionState,
  id: string,
  modifiers: SelectionModifiers,
  orderedIds: readonly string[],
): SelectionState {
  if (modifiers.shift && state.primaryId !== null) {
    return computeRangeSelection(state, id, orderedIds);
  }
  if (modifiers.meta) {
    return computeToggleSelection(state, id);
  }
  return replaceSelection(id);
}

/** Drop selection ids that are not available in the current page. */
export function clampSelectionToIds(
  state: SelectionState,
  validIds: ReadonlySet<string>,
): SelectionState {
  const ids = state.ids.filter((id) => validIds.has(id));
  if (ids.length === state.ids.length && (state.primaryId === null || validIds.has(state.primaryId))) {
    return state;
  }
  if (ids.length === 0) {
    return EMPTY_SELECTION;
  }
  return { ids, primaryId: pickClampedPrimary(state.primaryId, ids, validIds) };
}

function pickClampedPrimary(
  previous: string | null,
  remaining: readonly string[],
  validIds: ReadonlySet<string>,
): string | null {
  if (previous !== null && validIds.has(previous)) {
    return previous;
  }
  return remaining[remaining.length - 1] ?? null;
}

function computeRangeSelection(
  state: SelectionState,
  id: string,
  orderedIds: readonly string[],
): SelectionState {
  const anchor = state.primaryId;
  if (anchor === null) {
    return replaceSelection(id);
  }
  const a = orderedIds.indexOf(anchor);
  const b = orderedIds.indexOf(id);
  // Either endpoint missing from the painter-order list — fall back to
  // a plain replace rather than emit a partial / empty range that
  // surprises the user.
  if (a < 0 || b < 0) {
    return replaceSelection(id);
  }
  const [start, end] = a <= b ? [a, b] : [b, a];
  const ids = orderedIds.slice(start, end + 1);
  // Anchor on the just-clicked id so a follow-up shift-click extends
  // from this end of the run rather than the original primary.
  return { ids, primaryId: id };
}

function computeToggleSelection(state: SelectionState, id: string): SelectionState {
  const idx = state.ids.indexOf(id);
  if (idx < 0) {
    return { ids: [...state.ids, id], primaryId: id };
  }
  const ids = [...state.ids.slice(0, idx), ...state.ids.slice(idx + 1)];
  if (ids.length === 0) {
    return EMPTY_SELECTION;
  }
  if (state.primaryId === id) {
    // Demote primary to the last surviving id so that a follow-up
    // shift-click still has a valid anchor inside the selection.
    return { ids, primaryId: ids[ids.length - 1] ?? null };
  }
  return { ids, primaryId: state.primaryId };
}
