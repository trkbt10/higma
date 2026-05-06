/** @file WebGL viewport resource preparation status model. */

export type WebGLViewportPreparationPhase =
  | "scheduled"
  | "precompiling"
  | "preparing-resources"
  | "rendering"
  | "ready";

export type WebGLViewportPreparationStatus = {
  readonly phase: WebGLViewportPreparationPhase;
  readonly completedSteps: number;
  readonly totalSteps: number;
  readonly label: string;
};

const TOTAL_STEPS = 3;

const STATUS_BY_PHASE: Record<WebGLViewportPreparationPhase, WebGLViewportPreparationStatus> = {
  scheduled: {
    phase: "scheduled",
    completedSteps: 0,
    totalSteps: TOTAL_STEPS,
    label: "Scheduling WebGL resources",
  },
  precompiling: {
    phase: "precompiling",
    completedSteps: 1,
    totalSteps: TOTAL_STEPS,
    label: "Compiling WebGL programs",
  },
  "preparing-resources": {
    phase: "preparing-resources",
    completedSteps: 2,
    totalSteps: TOTAL_STEPS,
    label: "Uploading WebGL resources",
  },
  rendering: {
    phase: "rendering",
    completedSteps: 3,
    totalSteps: TOTAL_STEPS,
    label: "Rendering WebGL frame",
  },
  ready: {
    phase: "ready",
    completedSteps: TOTAL_STEPS,
    totalSteps: TOTAL_STEPS,
    label: "WebGL frame ready",
  },
};

/** Resolve the display status for a WebGL viewport preparation phase. */
export function getWebGLViewportPreparationStatus(
  phase: WebGLViewportPreparationPhase,
): WebGLViewportPreparationStatus {
  return STATUS_BY_PHASE[phase];
}
