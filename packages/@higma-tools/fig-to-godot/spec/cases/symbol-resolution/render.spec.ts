/**
 * @file Round-trip spec for the `symbol-resolution` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "symbol-resolution",
  canvasName: "Components",
  frameNames: [
    "icon-badge-nesting",
  ],
  diffCapPct: {
    "icon-badge-nesting": 0.5,
  },
});
