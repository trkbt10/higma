/**
 * @file Round-trip spec for the `effects` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "effects",
  canvasName: "Page 1",
  frameNames: [
    "shadow-drop-basic",
    "shadow-drop-offset",
    "shadow-drop-multi",
    "shadow-drop-color",
    "shadow-inner",
    "blur-layer",
    "opacity-50",
    "shadow-shapes",
    "effects-combined",
  ],
  // Caps mirror the SwiftUI peer (`fig-to-swiftui/spec/cases/effects`)
  // where SwiftUI's native `.shadow()`/`.blur()` modifiers + ImageRenderer
  // hold 0.5% on shadows and 2% on blur. Godot has no gaussian-shadow
  // primitive in StyleBoxFlat (only `shadow_size` rectangle extension),
  // so the implementation pre-rasterizes shadows in CPU. The contract
  // here is "the pre-raster matches the WebGL reference within the same
  // tolerances SwiftUI matches" — failures below indicate real
  // implementation gaps, not loose caps.
  diffCapPct: {
    "shadow-drop-basic": 0.5,
    "shadow-drop-offset": 0.5,
    "shadow-drop-multi": 0.5,
    "shadow-drop-color": 0.5,
    "shadow-inner": 0.5,
    "blur-layer": 2,
    "opacity-50": 0.09,
    "shadow-shapes": 0.5,
    "effects-combined": 0.5,
  },
});
