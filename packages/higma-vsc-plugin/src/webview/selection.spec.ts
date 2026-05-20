/**
 * @file Unit specs for selection-state operations.
 */

import {
  EMPTY_SELECTION,
  applyClickSelection,
  clampSelectionToIds,
  replaceSelection,
} from "./selection";

const A = "a";
const B = "b";
const C = "c";
const D = "d";
const ORDER = [A, B, C, D];

describe("applyClickSelection", () => {
  it("plain click replaces the selection and sets primary", () => {
    const next = applyClickSelection(EMPTY_SELECTION, A, { meta: false, shift: false }, ORDER);
    expect(next.ids).toEqual([A]);
    expect(next.primaryId).toBe(A);
  });

  it("plain click on a different node replaces a multi-selection", () => {
    const start = { ids: [A, B, C], primaryId: C } as const;
    const next = applyClickSelection(start, D, { meta: false, shift: false }, ORDER);
    expect(next.ids).toEqual([D]);
    expect(next.primaryId).toBe(D);
  });

  it("meta-click adds an unselected node and promotes it to primary", () => {
    const start = replaceSelection(A);
    const next = applyClickSelection(start, B, { meta: true, shift: false }, ORDER);
    expect(next.ids).toEqual([A, B]);
    expect(next.primaryId).toBe(B);
  });

  it("meta-click removes a selected non-primary without changing primary", () => {
    const start = { ids: [A, B, C], primaryId: C } as const;
    const next = applyClickSelection(start, B, { meta: true, shift: false }, ORDER);
    expect(next.ids).toEqual([A, C]);
    expect(next.primaryId).toBe(C);
  });

  it("meta-click that removes the primary demotes primary to the last surviving id", () => {
    const start = { ids: [A, B, C], primaryId: C } as const;
    const next = applyClickSelection(start, C, { meta: true, shift: false }, ORDER);
    expect(next.ids).toEqual([A, B]);
    expect(next.primaryId).toBe(B);
  });

  it("meta-click on the lone selected node clears the selection", () => {
    const start = replaceSelection(A);
    const next = applyClickSelection(start, A, { meta: true, shift: false }, ORDER);
    expect(next.ids).toEqual([]);
    expect(next.primaryId).toBeNull();
  });

  it("shift-click selects the inclusive range between primary and target in painter order", () => {
    const start = replaceSelection(A);
    const next = applyClickSelection(start, C, { meta: false, shift: true }, ORDER);
    expect(next.ids).toEqual([A, B, C]);
    expect(next.primaryId).toBe(C);
  });

  it("shift-click works backwards (target precedes primary)", () => {
    const start = replaceSelection(D);
    const next = applyClickSelection(start, B, { meta: false, shift: true }, ORDER);
    expect(next.ids).toEqual([B, C, D]);
    expect(next.primaryId).toBe(B);
  });

  it("shift-click without an anchor falls back to a plain replace", () => {
    const next = applyClickSelection(EMPTY_SELECTION, B, { meta: false, shift: true }, ORDER);
    expect(next.ids).toEqual([B]);
    expect(next.primaryId).toBe(B);
  });

  it("shift then shift extends from the just-clicked end", () => {
    const first = applyClickSelection(replaceSelection(A), C, { meta: false, shift: true }, ORDER);
    const second = applyClickSelection(first, D, { meta: false, shift: true }, ORDER);
    expect(second.ids).toEqual([C, D]);
    expect(second.primaryId).toBe(D);
  });
});

describe("clampSelectionToIds", () => {
  it("keeps the state when every id is still valid", () => {
    const start = { ids: [A, B], primaryId: B } as const;
    const next = clampSelectionToIds(start, new Set([A, B, C]));
    expect(next).toBe(start);
  });

  it("drops invalid ids and demotes primary if the primary disappeared", () => {
    const start = { ids: [A, B, C], primaryId: B } as const;
    const next = clampSelectionToIds(start, new Set([A, C]));
    expect(next.ids).toEqual([A, C]);
    expect(next.primaryId).toBe(C);
  });

  it("returns the empty selection when no id remains", () => {
    const start = { ids: [A, B], primaryId: B } as const;
    const next = clampSelectionToIds(start, new Set([C]));
    expect(next.ids).toEqual([]);
    expect(next.primaryId).toBeNull();
  });
});
