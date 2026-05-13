/**
 * @file Round-trip spec for the `shapes` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "shapes",
  canvasName: "Shapes",
  frameNames: [
    "ellipse-basic",
    "ellipse-circle",
    "ellipse-arc",
    "ellipse-donut",
    "line-horizontal",
    "line-diagonal",
    "line-styled",
    "star-5point",
    "star-8point",
    "star-sharp",
    "polygon-triangle",
    "polygon-hexagon",
    "polygon-octagon",
    "rect-rounded",
    "rect-pill",
    "shapes-mixed",
  ],
  diffCapPct: {
    "ellipse-basic": 0.09,
    "ellipse-circle": 0.09,
    "ellipse-arc": 0.09,
    "ellipse-donut": 0.09,
    "line-horizontal": 0.09,
    "line-diagonal": 0.86,
    "line-styled": 0.09,
    "star-5point": 0.09,
    "star-8point": 0.09,
    "star-sharp": 0.09,
    "polygon-triangle": 0.09,
    "polygon-hexagon": 0.09,
    "polygon-octagon": 0.09,
    "rect-rounded": 0.09,
    "rect-pill": 0.09,
    "shapes-mixed": 1.4,
  },
});
