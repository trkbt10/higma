/**
 * @file Round-trip spec for the `decoration-combo` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "decoration-combo",
  canvasName: "Decoration Combos",
  frameNames: [
    "solid-stroke-radius-shadow",
    "bool-gradient-union",
    "bool-gradient-subtract-shadow",
    "bool-rounded-operands",
    "clip-shadow",
    "grad-opacity",
    "grad-blur",
    "grad-shadow-drop",
    "grad-shadow-inner",
    "grad-multi-effect",
    "realistic-card",
    "realistic-avatar",
    "realistic-badge",
    "grad-stroke-radius",
    "grad-radius-pill",
    "grad-radius-card",
    "grad-radius-linear",
    "clip-gradient-rounded",
    "instance-inherit-decoration",
    "instance-gradient-override",
  ],
  diffCapPct: {
    "solid-stroke-radius-shadow": 3.1,
    "bool-gradient-union": 24.62,
    "bool-gradient-subtract-shadow": 14,
    "bool-rounded-operands": 0.5,
    "clip-shadow": 2.2,
    "grad-opacity": 8,
    "grad-blur": 24,
    "grad-shadow-drop": 4.5,
    "grad-shadow-inner": 4.8,
    "grad-multi-effect": 19,
    "realistic-card": 4.2,
    "realistic-avatar": 1.7,
    "realistic-badge": 7.4,
    "grad-stroke-radius": 2,
    "grad-radius-pill": 0.5,
    "grad-radius-card": 0.5,
    "grad-radius-linear": 0.5,
    "clip-gradient-rounded": 9.7,
    "instance-inherit-decoration": 0.4,
    "instance-gradient-override": 0.5,
  },
});
