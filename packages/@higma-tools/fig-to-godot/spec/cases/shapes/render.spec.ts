/**
 * @file Round-trip spec for the `shapes` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "shapes",
  canvasName: "Shapes Canvas",
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
    "ellipse-basic": 3.594,
    "ellipse-circle": 0.09,
    "ellipse-arc": 24.188,
    "ellipse-donut": 12.162,
    "line-horizontal": 5.75,
    "line-diagonal": 2.096,
    "line-styled": 6.142,
    "star-5point": 16.992,
    "star-8point": 16.978,
    "star-sharp": 16.992,
    "polygon-triangle": 20.254,
    "polygon-hexagon": 20.254,
    "polygon-octagon": 20.254,
    "rect-rounded": 0.09,
    "rect-pill": 0.09,
    "shapes-mixed": 15.004,
  },
});
