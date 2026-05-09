/** @file Canvas status overlay for WebGL viewport resource preparation. */

import type { ViewportLayerFrame } from "../layout/viewport-render-plan";
import type { WebGLViewportPreparationStatus } from "@higma-document-renderers/fig/webgl/preparation-status";

type FigWebGLViewportLoadingOverlayProps = {
  readonly frame: ViewportLayerFrame;
  readonly status: WebGLViewportPreparationStatus;
};

/** Render visible progress for WebGL resource preparation. */
export function FigWebGLViewportLoadingOverlay({ frame, status }: FigWebGLViewportLoadingOverlayProps) {
  const progressPercent = (status.completedSteps / status.totalSteps) * 100;

  return (
    <div
      role="status"
      aria-label={status.label}
      data-webgl-loading="true"
      data-webgl-loading-phase={status.phase}
      style={{
        position: "absolute",
        left: frame.left,
        top: frame.top,
        width: frame.width,
        height: frame.height,
        display: "grid",
        placeItems: "center",
        background: "rgba(247, 249, 252, 0.92)",
        color: "#1f2937",
        fontSize: 13,
        fontFamily: "inherit",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "grid",
          gap: 8,
          width: "min(260px, calc(100% - 48px))",
        }}
      >
        <div>{status.label}</div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={status.totalSteps}
          aria-valuenow={status.completedSteps}
          aria-label="WebGL resource preparation progress"
          style={{
            height: 4,
            overflow: "hidden",
            background: "#d1d5db",
          }}
        >
          <div
            data-webgl-loading-progress="true"
            style={{
              width: `${progressPercent}%`,
              height: "100%",
              background: "#2563eb",
            }}
          />
        </div>
      </div>
    </div>
  );
}
