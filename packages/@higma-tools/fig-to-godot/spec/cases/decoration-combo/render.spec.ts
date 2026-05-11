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
  // Caps target SwiftUI-peer level: 0.5% on effect-bearing fixtures,
  // 2% on blur (where gaussian discretisation between renderers
  // legitimately leaks). Failures below the cap indicate genuine
  // gaps between the fig-to-godot pre-raster pipeline and the WebGL
  // reference — they should be solved by implementation work, NOT
  // by raising the cap.
  diffCapPct: {
    "solid-stroke-radius-shadow": 0.5,
    "bool-gradient-union": 0.05,
    "bool-gradient-subtract-shadow": 0.05,
    "bool-rounded-operands": 0.5,
    "clip-shadow": 0.5,
    "grad-opacity": 0.5,
    "grad-blur": 2,
    "grad-shadow-drop": 0.5,
    "grad-shadow-inner": 0.5,
    "grad-multi-effect": 0.5,
    "realistic-card": 0.5,
    "realistic-avatar": 0.5,
    "realistic-badge": 0.5,
    "grad-stroke-radius": 0.1,
    "grad-radius-pill": 0.5,
    "grad-radius-card": 0.5,
    "grad-radius-linear": 0.5,
    "clip-gradient-rounded": 0.1,
    "instance-inherit-decoration": 0.4,
    "instance-gradient-override": 0.5,
  },
});
