/**
 * @file VS Code-themed loading overlay for the WebGL viewport.
 *
 * Same status model as the editor's overlay, but every colour comes
 * from `--vscode-*` custom properties so the overlay blends with the
 * active theme. The overlay is mounted in DOM order *after* the
 * canvas so it sits on top, and `pointer-events: none` keeps the
 * stage's mousemove/click handlers fully active beneath it.
 */

import type { WebGLViewportPreparationStatus } from "@higma-document-renderers/fig/webgl/preparation-status";

type Props = {
  readonly status: WebGLViewportPreparationStatus;
};

/** Render the WebGL preparation progress overlay. */
export function WebGLLoadingOverlay({ status }: Props) {
  const progressPercent = (status.completedSteps / status.totalSteps) * 100;
  return (
    <div
      role="status"
      aria-label={status.label}
      data-webgl-loading="true"
      data-webgl-loading-phase={status.phase}
      className="higma-fig-webgl-loading"
    >
      <div className="higma-fig-webgl-loading__panel">
        <span className="higma-fig-webgl-loading__label">{status.label}…</span>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={status.totalSteps}
          aria-valuenow={status.completedSteps}
          aria-label="WebGL resource preparation progress"
          className="higma-fig-webgl-loading__track"
        >
          <div
            data-webgl-loading-progress="true"
            className="higma-fig-webgl-loading__bar"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
