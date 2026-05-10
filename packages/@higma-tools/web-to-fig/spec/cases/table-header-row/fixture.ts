/**
 * @file `table-header-row` — `<table><thead><tr><th></th></tr></thead><tbody><tr><td>...`.
 *
 * Adds the `<thead>` / `<tbody>` semantic groupings. Each is a
 * `display: table-{header,row}-group`. The IR tree mirrors the DOM
 * shape: table → thead → tr → th, plus tbody → tr → td.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

/** `<table>` with a `<thead>`/`<tbody>` separation and a bold header cell. */
export function tableWithHeaderRow(): RawElement {
  const headerCell = synthEl({
    id: "table/thead/tr/th",
    tag: "th",
    rect: { x: 0, y: 0, width: 100, height: 30 },
    styleOverrides: { display: "table-cell", "font-weight": "700" },
    text: "Name",
  });
  const headerRow = synthEl({
    id: "table/thead/tr",
    tag: "tr",
    rect: { x: 0, y: 0, width: 100, height: 30 },
    styleOverrides: { display: "table-row" },
    children: [headerCell],
  });
  const thead = synthEl({
    id: "table/thead",
    tag: "thead",
    rect: { x: 0, y: 0, width: 100, height: 30 },
    styleOverrides: { display: "table-header-group" },
    children: [headerRow],
  });
  const bodyCell = synthEl({
    id: "table/tbody/tr/td",
    tag: "td",
    rect: { x: 0, y: 30, width: 100, height: 30 },
    styleOverrides: { display: "table-cell" },
    text: "Alice",
  });
  const bodyRow = synthEl({
    id: "table/tbody/tr",
    tag: "tr",
    rect: { x: 0, y: 30, width: 100, height: 30 },
    styleOverrides: { display: "table-row" },
    children: [bodyCell],
  });
  const tbody = synthEl({
    id: "table/tbody",
    tag: "tbody",
    rect: { x: 0, y: 30, width: 100, height: 30 },
    styleOverrides: { display: "table-row-group" },
    children: [bodyRow],
  });
  return synthEl({
    id: "table",
    tag: "table",
    rect: { x: 0, y: 0, width: 100, height: 60 },
    styleOverrides: { display: "table" },
    children: [thead, tbody],
  });
}
