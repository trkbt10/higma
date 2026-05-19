/** @file WebGL viewport loading status overlay. */
import type { CSSProperties } from "react";
import type { WebGLViewportPreparationStatus } from "@higma-document-renderers/fig/webgl/preparation-status";

export type FigWebGLViewportLoadingOverlayProps = {
  readonly status: WebGLViewportPreparationStatus;
};

const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
  pointerEvents: "none",
  color: "#334155",
  font: "12px system-ui, sans-serif",
  background: "rgba(255, 255, 255, 0.72)",
};

const progressStyle: CSSProperties = {
  width: 160,
  height: 3,
};

/** Render a small status overlay until the WebGL pipeline is ready. */
export function FigWebGLViewportLoadingOverlay({ status }: FigWebGLViewportLoadingOverlayProps) {
  if (status.phase === "ready") {
    return null;
  }
  return (
    <div
      style={overlayStyle}
      data-webgl-loading="true"
      data-webgl-loading-phase={status.phase}
    >
      <progress
        aria-label="WebGL resource preparation progress"
        aria-valuemin={0}
        aria-valuemax={status.totalSteps}
        aria-valuenow={status.completedSteps}
        max={status.totalSteps}
        value={status.completedSteps}
        style={progressStyle}
      />
    </div>
  );
}
