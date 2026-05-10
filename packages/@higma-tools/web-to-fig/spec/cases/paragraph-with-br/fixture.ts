/**
 * @file `paragraph-with-br` — `<p>line one<br>line two</p>`.
 *
 * `<br>` forces a line break inside an inline flow. A faithful IR
 * represents this either as a literal `\n` in the characters string
 * or as some equivalent run boundary. The browser captures `<br>` as
 * a child element with empty text — a normaliser that ignores it
 * concatenates "line oneline two" with no break.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const EXPECTED_TEXT_WITH_BREAK = "line one\nline two";

/** `<p>line one<br>line two</p>` — `<br>` should produce a literal newline. */
export function paragraphWithBr(): RawElement {
  return synthEl({
    id: "p",
    tag: "p",
    rect: { x: 0, y: 0, width: 200, height: 48 },
    styleOverrides: { color: "rgb(0, 0, 0)", "font-size": "16px" },
    textFragments: ["line one", "line two"],
    children: [
      synthEl({
        id: "p/br",
        tag: "br",
        rect: { x: 0, y: 0, width: 0, height: 16 },
        styleOverrides: { display: "inline" },
        text: "",
      }),
    ],
  });
}
