/**
 * @file Case `paragraph-resolves-font-stack` — the paragraph host and
 * every inline descendant must route their captured `font-family`
 * value through the injected FontResolver. Picking the first
 * candidate verbatim was the historical drift that produced the
 * `example-com-fullpage` per-glyph halo: `-apple-system` landed in
 * the IR and the WebGL renderer drew with whatever fallback the
 * underlying font engine chose, with metrics that didn't match the
 * captured screenshot.
 *
 * The test fixture uses a host stack
 * (`-apple-system, system-ui, BlinkMacSystemFont, sans-serif`) and a
 * distinct inline-anchor stack (`"Inter", monospace`) so the spec
 * can confirm BOTH paths reach the resolver in source order.
 */
import { asText, normalizeOne, singleChild } from "../case-ir-assertions";
import { recordingFontResolver } from "../../test-font-resolver";
import {
  HOST_FONT_STACK,
  INLINE_FONT_STACK,
  paragraphWithInlineFontOverride,
} from "./fixture";

describe("case paragraph-resolves-font-stack", () => {
  it("invokes the resolver for the host font-family stack", () => {
    const recorder = recordingFontResolver("Resolved Family");
    asText(
      singleChild(
        normalizeOne(paragraphWithInlineFontOverride(), { fontResolver: recorder.resolver }),
      ),
    );
    const sawHostStack = recorder.calls.some((stack) => {
      const first = stack[0];
      return first?.kind === "name" && first.value === "-apple-system";
    });
    expect(sawHostStack).toBe(true);
  });

  it("invokes the resolver for the inline-anchor font-family stack", () => {
    const recorder = recordingFontResolver("Resolved Family");
    asText(
      singleChild(
        normalizeOne(paragraphWithInlineFontOverride(), { fontResolver: recorder.resolver }),
      ),
    );
    const sawInlineStack = recorder.calls.some((stack) => {
      const first = stack[0];
      return first?.kind === "name" && first.value === "Inter";
    });
    expect(sawInlineStack).toBe(true);
  });

  it("never lands the raw first-candidate string on `textStyle.fontFamily`", () => {
    const recorder = recordingFontResolver("Resolved Family");
    const text = asText(
      singleChild(
        normalizeOne(paragraphWithInlineFontOverride(), { fontResolver: recorder.resolver }),
      ),
    );
    expect(text.textStyle.fontFamily).toBe("Resolved Family");
    // Sanity: the raw stack literal must never reach the IR — that's
    // the drift this case exists to prevent.
    expect(text.textStyle.fontFamily).not.toBe(HOST_FONT_STACK);
    expect(text.textStyle.fontFamily).not.toBe(INLINE_FONT_STACK);
    expect(text.textStyle.fontFamily).not.toBe("-apple-system");
  });
});
