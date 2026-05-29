/** @file React-independent WebGL viewport renderer controller. */

import {
  createNodeId,
  findSceneGraphNode,
  type KiwiSceneGraphMutation,
  type SceneGraph,
  type SceneGraphNodeTranslation,
  type SceneNode,
  type SceneNodeId,
} from "@higma-document-renderers/fig/scene-graph";
import {
  createWebGLFigmaRenderer,
  type WebGLFigmaRendererInstance,
  type WebGLFigmaRendererMetrics,
  type WebGLRenderFrameReason,
} from "../renderer/renderer";
import {
  getWebGLViewportPreparationStatus,
  type WebGLViewportPreparationStatus,
} from "../scene/preparation-status";
import { resolveWebGLViewportPixelRatio } from "../scene/viewport-pixel-ratio";

export type WebGLViewportRendererControllerInput = {
  readonly canvas: HTMLCanvasElement | null;
  readonly sceneGraph: SceneGraph | null;
  readonly renderOptions?: {
    readonly exportSettings?: Parameters<typeof createWebGLFigmaRenderer>[0]["exportSettings"];
  };
  /** Most recent Kiwi document mutation supplied by the embedding editor store. */
  readonly kiwiDocumentMutation: KiwiSceneGraphMutation;
  /** CSS-pixel scale (1 == 100%). Combines with devicePixelRatio. */
  readonly viewportScale: number;
  /** Monotonic viewport transform revision supplied by the embedding surface. */
  readonly viewportRevision?: number;
  /** True while the embedding surface is actively changing the viewport through user input. */
  readonly viewportInteractionActive?: boolean;
  /** Monotonic revision for high-frequency SceneGraph operation previews, such as selected node movement. */
  readonly sceneGraphInteractionRevision?: number;
  /** True while a high-frequency SceneGraph operation preview is active. */
  readonly sceneGraphInteractionActive?: boolean;
  /** One active editor operation preview applied during rendering without changing the SceneGraph root reference. */
  readonly sceneGraphNodeTranslation?: SceneGraphNodeTranslation;
  /**
   * Explicitly deferred first initialization. Use only when the embedding
   * surface intentionally prioritizes an already-committed loading surface.
   */
  readonly initializationDelayMs?: number;
  readonly onMetrics?: (canvas: HTMLCanvasElement, metrics: WebGLFigmaRendererMetrics) => void;
  readonly onSnapshot?: (snapshot: WebGLViewportRendererControllerSnapshot) => void;
  readonly errorContext: string;
};

export type WebGLViewportRendererControllerSnapshot = {
  readonly pixelRatio: number;
  readonly isReady: boolean;
  readonly status: WebGLViewportPreparationStatus;
  readonly inputRevision: number;
  readonly inputSceneViewport: WebGLViewportSceneViewport | undefined;
  readonly inputKiwiDocumentMutationRevision: number | undefined;
  readonly inputKiwiDocumentMutationChangedGuidKeys: readonly string[];
  readonly renderRevision: number;
  readonly lastRenderedSceneViewport: WebGLViewportSceneViewport | undefined;
  readonly lastRenderedKiwiDocumentMutationRevision: number | undefined;
  readonly lastRenderedKiwiDocumentMutationChangedGuidKeys: readonly string[];
};

export type WebGLViewportSceneViewport = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type WebGLViewportRendererScheduler = {
  readonly requestAnimationFrame: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrame: (id: number) => void;
  readonly requestIdleCallback: ((callback: IdleRequestCallback) => number) | undefined;
  readonly cancelIdleCallback: ((id: number) => void) | undefined;
  readonly setTimeout: (callback: () => void, delayMs: number) => number;
  readonly clearTimeout: (id: number) => void;
  readonly devicePixelRatio: () => number;
  readonly subscribeDevicePixelRatioChange: (listener: () => void) => () => void;
};

export type WebGLViewportRendererGlobalThisSchedulerHost = {
  readonly requestAnimationFrame: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrame: (id: number) => void;
  readonly requestIdleCallback?: (callback: IdleRequestCallback) => number;
  readonly cancelIdleCallback?: (id: number) => void;
  readonly setTimeout: (callback: () => void, delayMs: number) => number;
  readonly clearTimeout: (id: number) => void;
  readonly devicePixelRatio: number;
  readonly matchMedia: (query: string) => MediaQueryList;
  readonly addEventListener: (type: "resize", listener: () => void) => void;
  readonly removeEventListener: (type: "resize", listener: () => void) => void;
};

export type WebGLViewportRendererController = {
  readonly update: (input: WebGLViewportRendererControllerInput) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => WebGLViewportRendererControllerSnapshot;
  readonly dispose: () => void;
};

type PendingPrepare = {
  readonly scene: SceneGraph;
  readonly pixelRatio: number;
};

type LatestRender = {
  readonly scene: SceneGraph;
  readonly pixelRatio: number;
};

export type WebGLViewportPresentedSceneGraphFrame = {
  readonly scene: SceneGraph;
  readonly pixelRatio: number;
  readonly kiwiDocumentMutation: KiwiSceneGraphMutation;
  readonly frameReason: WebGLRenderFrameReason;
  readonly transientNodeTranslation: SceneGraphNodeTranslation | undefined;
};

export type WebGLViewportRenderSchedulingInput = {
  readonly viewportMotionRender: boolean;
  readonly sceneGraphInteractionRender: boolean;
  readonly sceneGraphInteractionActive: boolean;
};

export type WebGLViewportRenderSchedulingDecision = {
  readonly frameReason: WebGLRenderFrameReason;
  readonly scheduleSettledAfterViewportMotion: boolean;
};

export type WebGLSceneGraphInteractionRenderRevisionInput = {
  readonly previousRevision: number | undefined;
  readonly currentRevision: number | undefined;
  readonly sceneGraphInteractionActive: boolean;
  readonly hasPresentedFrame: boolean;
};

export type WebGLViewportInputSynchronousRenderInput = {
  readonly hasPresentedFrame: boolean;
  readonly viewportMotionRender: boolean;
  readonly sceneGraphInteractionRender: boolean;
  readonly kiwiDocumentMutationRender: boolean;
};

export type WebGLKiwiDocumentMutationRenderInput = {
  readonly lastRenderedScene: SceneGraph | null;
  readonly lastRenderedKiwiDocumentMutationRevision: number | undefined;
  readonly inputSceneGraph: SceneGraph;
  readonly inputKiwiDocumentMutation: KiwiSceneGraphMutation;
};

type SettledRenderSchedule = {
  readonly kind: "idle-callback";
  readonly id: number;
} | {
  readonly kind: "animation-frame";
  readonly id: number;
};

type DevicePixelRatioMediaQuery = {
  readonly media: MediaQueryList;
  readonly listener: () => void;
};

const EMPTY_KIWI_DOCUMENT_MUTATION_GUID_KEYS: readonly string[] = Object.freeze([]);

/** Resolve quality and settled follow-up scheduling for one WebGL viewport render request. */
export function resolveWebGLViewportRenderSchedulingDecision({
  viewportMotionRender,
  sceneGraphInteractionRender,
  sceneGraphInteractionActive,
}: WebGLViewportRenderSchedulingInput): WebGLViewportRenderSchedulingDecision {
  if (sceneGraphInteractionRender && sceneGraphInteractionActive) {
    return {
      frameReason: "scene-graph-interaction",
      scheduleSettledAfterViewportMotion: false,
    };
  }
  if (viewportMotionRender) {
    // The viewport changed since the last frame (the real "motion" signal — no
    // interaction flag or timeout). Present a cheap frame now (pan region-copy
    // or, for a scale change, a lossy scaled blit of the cached settled frame)
    // and schedule ONE high-fidelity settled render. requestIdleCallback
    // coalesces, so during a rapid pan/zoom burst each motion frame cancels and
    // reschedules the settle; it runs once the burst goes idle, recomputing the
    // final pixelRatio and repainting effects.
    return {
      frameReason: "viewport-motion",
      scheduleSettledAfterViewportMotion: true,
    };
  }
  return {
    frameReason: "settled",
    scheduleSettledAfterViewportMotion: false,
  };
}

/** Return whether a SceneGraph interaction revision requires an interactive WebGL frame. */
export function shouldRenderWebGLSceneGraphInteractionRevision({
  previousRevision,
  currentRevision,
  sceneGraphInteractionActive,
  hasPresentedFrame,
}: WebGLSceneGraphInteractionRenderRevisionInput): boolean {
  if (currentRevision === undefined) {
    return false;
  }
  if (previousRevision === undefined) {
    return sceneGraphInteractionActive && hasPresentedFrame;
  }
  return previousRevision !== currentRevision;
}

/** Return whether one input update must render before the next animation-frame boundary. */
export function shouldRenderWebGLViewportInputSynchronously({
  hasPresentedFrame,
  viewportMotionRender,
  sceneGraphInteractionRender,
  kiwiDocumentMutationRender,
}: WebGLViewportInputSynchronousRenderInput): boolean {
  if (!hasPresentedFrame) {
    return false;
  }
  return viewportMotionRender || sceneGraphInteractionRender || kiwiDocumentMutationRender;
}

/** Return whether a Kiwi document mutation changed the renderer input SceneGraph. */
export function shouldRenderWebGLKiwiDocumentMutation({
  lastRenderedScene,
  lastRenderedKiwiDocumentMutationRevision,
  inputSceneGraph,
  inputKiwiDocumentMutation,
}: WebGLKiwiDocumentMutationRenderInput): boolean {
  if (lastRenderedKiwiDocumentMutationRevision === undefined) {
    return false;
  }
  if (inputKiwiDocumentMutation.revision === lastRenderedKiwiDocumentMutationRevision) {
    return false;
  }
  return lastRenderedScene !== inputSceneGraph;
}

const INITIAL_CONTROLLER_SNAPSHOT: WebGLViewportRendererControllerSnapshot = {
  pixelRatio: 1,
  isReady: false,
  status: getWebGLViewportPreparationStatus("scheduled"),
  inputRevision: 0,
  inputSceneViewport: undefined,
  inputKiwiDocumentMutationRevision: undefined,
  inputKiwiDocumentMutationChangedGuidKeys: EMPTY_KIWI_DOCUMENT_MUTATION_GUID_KEYS,
  renderRevision: 0,
  lastRenderedSceneViewport: undefined,
  lastRenderedKiwiDocumentMutationRevision: undefined,
  lastRenderedKiwiDocumentMutationChangedGuidKeys: EMPTY_KIWI_DOCUMENT_MUTATION_GUID_KEYS,
};

function requireFinitePositiveDevicePixelRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`WebGL viewport renderer controller requires positive devicePixelRatio, got ${value}`);
  }
  return value;
}

function sameSnapshot(
  left: WebGLViewportRendererControllerSnapshot,
  right: WebGLViewportRendererControllerSnapshot,
): boolean {
  return left.pixelRatio === right.pixelRatio &&
    left.isReady === right.isReady &&
    left.status === right.status &&
    left.inputRevision === right.inputRevision &&
    sceneViewportEquals(left.inputSceneViewport, right.inputSceneViewport) &&
    left.inputKiwiDocumentMutationRevision === right.inputKiwiDocumentMutationRevision &&
    left.inputKiwiDocumentMutationChangedGuidKeys === right.inputKiwiDocumentMutationChangedGuidKeys &&
    left.renderRevision === right.renderRevision &&
    sceneViewportEquals(left.lastRenderedSceneViewport, right.lastRenderedSceneViewport) &&
    left.lastRenderedKiwiDocumentMutationRevision === right.lastRenderedKiwiDocumentMutationRevision &&
    left.lastRenderedKiwiDocumentMutationChangedGuidKeys === right.lastRenderedKiwiDocumentMutationChangedGuidKeys;
}

/** Return whether React subscribers need to re-render for one controller snapshot transition. */
export function shouldNotifyWebGLViewportRendererSubscribers(
  left: WebGLViewportRendererControllerSnapshot,
  right: WebGLViewportRendererControllerSnapshot,
): boolean {
  return left.pixelRatio !== right.pixelRatio ||
    left.isReady !== right.isReady ||
    left.status !== right.status;
}

function snapshotForPhase(
  previous: WebGLViewportRendererControllerSnapshot,
  phase: WebGLViewportPreparationStatus["phase"],
): WebGLViewportRendererControllerSnapshot {
  return {
    ...previous,
    isReady: phase === "ready",
    status: getWebGLViewportPreparationStatus(phase),
  };
}

function snapshotWithPixelRatio(
  previous: WebGLViewportRendererControllerSnapshot,
  pixelRatio: number,
): WebGLViewportRendererControllerSnapshot {
  return {
    ...previous,
    pixelRatio,
  };
}

function snapshotAfterCompletedRender(
  previous: WebGLViewportRendererControllerSnapshot,
  scene: SceneGraph,
  kiwiDocumentMutation: KiwiSceneGraphMutation,
): WebGLViewportRendererControllerSnapshot {
  return {
    ...previous,
    isReady: true,
    status: getWebGLViewportPreparationStatus("ready"),
    renderRevision: previous.renderRevision + 1,
    lastRenderedSceneViewport: readSceneGraphViewport(scene),
    lastRenderedKiwiDocumentMutationRevision: kiwiDocumentMutation.revision,
    lastRenderedKiwiDocumentMutationChangedGuidKeys: kiwiDocumentMutation.changedGuidKeys,
  };
}

function snapshotAfterControllerInput(
  previous: WebGLViewportRendererControllerSnapshot,
  input: WebGLViewportRendererControllerInput,
): WebGLViewportRendererControllerSnapshot {
  return {
    ...previous,
    inputRevision: previous.inputRevision + 1,
    inputSceneViewport: input.sceneGraph === null ? undefined : readSceneGraphViewport(input.sceneGraph),
    inputKiwiDocumentMutationRevision: input.kiwiDocumentMutation.revision,
    inputKiwiDocumentMutationChangedGuidKeys: input.kiwiDocumentMutation.changedGuidKeys,
  };
}

function readSceneGraphViewport(scene: SceneGraph): WebGLViewportSceneViewport {
  const viewport = scene.viewport;
  if (viewport === undefined) {
    throw new Error("WebGL viewport renderer controller requires SceneGraph.viewport");
  }
  return {
    x: viewport.x,
    y: viewport.y,
    width: viewport.width,
    height: viewport.height,
  };
}

function sceneViewportEquals(
  left: WebGLViewportSceneViewport | undefined,
  right: WebGLViewportSceneViewport | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height;
}

function sceneNodeIdToGuidKey(id: SceneNodeId): string {
  return id;
}

function requireSceneNodeById(scene: SceneGraph, id: SceneNodeId, owner: string): SceneNode {
  const node = findSceneGraphNode(scene, id);
  if (node === undefined) {
    throw new Error(`${owner}: SceneNode ${id} is not present`);
  }
  return node;
}

function arrayBufferViewEquals(left: ArrayBufferView, right: ArrayBufferView): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  const leftBytes = new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
  const rightBytes = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
  return leftBytes.every((byte, index) => byte === rightBytes[index]);
}

function arraysEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => sceneGraphPresentationValueEquals(value, right[index]));
}

function objectEntriesEqual(left: object, right: object): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  const rightRecord = Object.fromEntries(rightEntries);
  return leftEntries.every(([key, value]) => sceneGraphPresentationValueEquals(value, rightRecord[key]));
}

function sceneGraphPresentationValueEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (left === null || right === null) {
    return false;
  }
  if (ArrayBuffer.isView(left) || ArrayBuffer.isView(right)) {
    return ArrayBuffer.isView(left) && ArrayBuffer.isView(right) && arrayBufferViewEquals(left, right);
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && arraysEqual(left, right);
  }
  if (typeof left === "object" || typeof right === "object") {
    return typeof left === "object" && typeof right === "object" && objectEntriesEqual(left, right);
  }
  return false;
}

function sceneNodeFieldsExceptTransformEqual(left: SceneNode, right: SceneNode): boolean {
  const leftEntries = Object.entries(left).filter(([key]) => key !== "transform");
  const rightEntries = Object.entries(right).filter(([key]) => key !== "transform");
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  const rightRecord = Object.fromEntries(rightEntries);
  return leftEntries.every(([key, value]) => sceneGraphPresentationValueEquals(value, rightRecord[key]));
}

function sceneNodeTransformEqualsTranslated(
  previous: SceneNode,
  committed: SceneNode,
  translation: SceneGraphNodeTranslation,
): boolean {
  return previous.transform.m00 === committed.transform.m00 &&
    previous.transform.m01 === committed.transform.m01 &&
    previous.transform.m10 === committed.transform.m10 &&
    previous.transform.m11 === committed.transform.m11 &&
    previous.transform.m02 + translation.dx === committed.transform.m02 &&
    previous.transform.m12 + translation.dy === committed.transform.m12;
}

function sceneGraphTargetNodeMatchesCommittedTranslation(
  previousScene: SceneGraph,
  committedScene: SceneGraph,
  translation: SceneGraphNodeTranslation,
): boolean {
  const previousNode = requireSceneNodeById(
    previousScene,
    translation.nodeId,
    "WebGL committed transform presentation previous scene",
  );
  const committedNode = requireSceneNodeById(
    committedScene,
    translation.nodeId,
    "WebGL committed transform presentation committed scene",
  );
  return previousNode.type === committedNode.type &&
    sceneNodeFieldsExceptTransformEqual(previousNode, committedNode) &&
    sceneNodeTransformEqualsTranslated(previousNode, committedNode, translation);
}

/** Return whether a previous translated interaction frame exactly represents the committed Kiwi transform. */
export function canPresentCommittedSceneGraphFromPreviousTranslatedInteractionFrame({
  previousFrame,
  committedScene,
  committedPixelRatio,
  committedKiwiDocumentMutation,
  committedSceneGraphNodeTranslation,
}: {
  readonly previousFrame: WebGLViewportPresentedSceneGraphFrame | null;
  readonly committedScene: SceneGraph;
  readonly committedPixelRatio: number;
  readonly committedKiwiDocumentMutation: KiwiSceneGraphMutation;
  readonly committedSceneGraphNodeTranslation: SceneGraphNodeTranslation | undefined;
}): boolean {
  if (previousFrame === null) {
    return false;
  }
  if (previousFrame.frameReason !== "scene-graph-interaction") {
    return false;
  }
  const previousTranslation = previousFrame.transientNodeTranslation;
  if (previousTranslation === undefined || committedSceneGraphNodeTranslation !== undefined) {
    return false;
  }
  if (committedKiwiDocumentMutation.scope !== "node-content") {
    return false;
  }
  if (committedKiwiDocumentMutation.changedGuidKeys.length !== 1) {
    return false;
  }
  if (committedKiwiDocumentMutation.changedGuidKeys[0] !== sceneNodeIdToGuidKey(previousTranslation.nodeId)) {
    return false;
  }
  if (previousFrame.pixelRatio !== committedPixelRatio) {
    return false;
  }
  if (!sceneViewportEquals(readSceneGraphViewport(previousFrame.scene), readSceneGraphViewport(committedScene))) {
    return false;
  }
  return sceneGraphTargetNodeMatchesCommittedTranslation(previousFrame.scene, committedScene, previousTranslation);
}

/** Return whether one global object exposes the scheduling APIs required by the WebGL viewport renderer. */
export function hasWebGLViewportRendererGlobalThisSchedulerHost(
  host: unknown,
): host is WebGLViewportRendererGlobalThisSchedulerHost {
  if (typeof host !== "object" || host === null) {
    return false;
  }
  const candidate = host as Record<string, unknown>;
  return typeof candidate.requestAnimationFrame === "function" &&
    typeof candidate.cancelAnimationFrame === "function" &&
    typeof candidate.setTimeout === "function" &&
    typeof candidate.clearTimeout === "function" &&
    typeof candidate.devicePixelRatio === "number" &&
    typeof candidate.matchMedia === "function" &&
    typeof candidate.addEventListener === "function" &&
    typeof candidate.removeEventListener === "function";
}

/** Create a scheduler from one explicit global object. */
export function createWebGLViewportRendererGlobalThisScheduler(
  host: WebGLViewportRendererGlobalThisSchedulerHost,
): WebGLViewportRendererScheduler {
  function subscribeDevicePixelRatioChange(listener: () => void): () => void {
    const resizeListener = (): void => listener();
    host.addEventListener("resize", resizeListener);

    const mediaQueryRef: { value: DevicePixelRatioMediaQuery | null } = { value: null };
    const updateMediaQuery = (): void => {
      const current = mediaQueryRef.value;
      if (current !== null) {
          current.media.removeEventListener("change", current.listener);
      }
      const media = host.matchMedia(`(resolution: ${host.devicePixelRatio}dppx)`);
      const mediaListener = (): void => {
        listener();
        updateMediaQuery();
      };
      media.addEventListener("change", mediaListener);
      mediaQueryRef.value = { media, listener: mediaListener };
    };
    updateMediaQuery();

    return () => {
      host.removeEventListener("resize", resizeListener);
      const current = mediaQueryRef.value;
      if (current !== null) {
        current.media.removeEventListener("change", current.listener);
      }
      mediaQueryRef.value = null;
    };
  }

  return {
    requestAnimationFrame: (callback) => host.requestAnimationFrame(callback),
    cancelAnimationFrame: (id) => host.cancelAnimationFrame(id),
    requestIdleCallback: host.requestIdleCallback?.bind(host),
    cancelIdleCallback: host.cancelIdleCallback?.bind(host),
    setTimeout: (callback, delayMs) => host.setTimeout(callback, delayMs),
    clearTimeout: (id) => host.clearTimeout(id),
    devicePixelRatio: () => requireFinitePositiveDevicePixelRatio(host.devicePixelRatio),
    subscribeDevicePixelRatioChange,
  };
}

function validateInitializationDelayMs(
  value: number | undefined,
  errorContext: string,
): void {
  if (value === undefined) {
    return;
  }
  if (Number.isFinite(value) && value >= 0) {
    return;
  }
  throw new Error(`${errorContext} requires a non-negative initializationDelayMs when provided`);
}

/** Create the UI-library-independent controller for one WebGL viewport canvas. */
export function createWebGLViewportRendererController(
  scheduler: WebGLViewportRendererScheduler,
): WebGLViewportRendererController {
  const listeners = new Set<() => void>();
  const snapshotRef = { value: INITIAL_CONTROLLER_SNAPSHOT };
  const inputRef = { value: null as WebGLViewportRendererControllerInput | null };
  const rendererRef = { value: null as WebGLFigmaRendererInstance | null };
  const initializeTimerRef = { value: null as number | null };
  const settledRenderScheduleRef = { value: null as SettledRenderSchedule | null };
  const prepareRunningRef = { value: false };
  const pendingPrepareRef = { value: null as PendingPrepare | null };
  const latestRenderRef = { value: null as LatestRender | null };
  const previousPresentedFrameRef = { value: null as WebGLViewportPresentedSceneGraphFrame | null };
  const hasPresentedFrameRef = { value: false };
  const lastAppliedPixelRatioRef = { value: null as number | null };
  const previousViewportRevisionRef = { value: undefined as number | undefined };
  const previousSceneGraphInteractionRevisionRef = { value: undefined as number | undefined };
  const scheduledRenderFrameRef = { value: null as number | null };
  const scheduledRenderViewportMotionRef = { value: false };
  const scheduledRenderSceneGraphInteractionRef = { value: false };
  const disposedRef = { value: false };

  function publishSnapshot(next: WebGLViewportRendererControllerSnapshot): void {
    const previous = snapshotRef.value;
    if (sameSnapshot(previous, next)) {
      return;
    }
    snapshotRef.value = next;
    currentInput()?.onSnapshot?.(next);
    if (!shouldNotifyWebGLViewportRendererSubscribers(previous, next)) {
      return;
    }
    for (const listener of listeners) {
      listener();
    }
  }

  function setPhase(phase: WebGLViewportPreparationStatus["phase"]): void {
    if (disposedRef.value) {
      return;
    }
    publishSnapshot(snapshotForPhase(snapshotRef.value, phase));
  }

  function setPhaseUntilFirstPresentedFrame(phase: WebGLViewportPreparationStatus["phase"]): void {
    if (hasPresentedFrameRef.value) {
      return;
    }
    setPhase(phase);
  }

  function setPixelRatioSnapshot(pixelRatio: number): void {
    publishSnapshot(snapshotWithPixelRatio(snapshotRef.value, pixelRatio));
  }

  function cancelInitializationSchedule(): void {
    if (initializeTimerRef.value !== null) {
      scheduler.clearTimeout(initializeTimerRef.value);
      initializeTimerRef.value = null;
    }
  }

  function cancelIdleCallbackSchedule(schedule: SettledRenderSchedule): boolean {
    if (schedule.kind !== "idle-callback") {
      return false;
    }
    if (scheduler.cancelIdleCallback === undefined) {
      throw new Error("WebGL viewport renderer controller cannot cancel missing idle callback scheduler");
    }
    scheduler.cancelIdleCallback(schedule.id);
    return true;
  }

  function cancelSettledRenderSchedule(): void {
    const schedule = settledRenderScheduleRef.value;
    if (schedule === null) {
      return;
    }
    if (!cancelIdleCallbackSchedule(schedule)) {
      scheduler.cancelAnimationFrame(schedule.id);
    }
    settledRenderScheduleRef.value = null;
  }

  function cancelScheduledRenderFrame(): void {
    if (scheduledRenderFrameRef.value === null) {
      return;
    }
    scheduler.cancelAnimationFrame(scheduledRenderFrameRef.value);
    scheduledRenderFrameRef.value = null;
    scheduledRenderViewportMotionRef.value = false;
    scheduledRenderSceneGraphInteractionRef.value = false;
  }

  function currentInput(): WebGLViewportRendererControllerInput | null {
    return inputRef.value;
  }

  function writeMetrics(renderer: WebGLFigmaRendererInstance): void {
    const input = currentInput();
    if (input === null || input.onMetrics === undefined || input.canvas === null) {
      return;
    }
    input.onMetrics(input.canvas, renderer.getMetrics());
  }

  function createRenderer(input: WebGLViewportRendererControllerInput, pixelRatio: number): WebGLFigmaRendererInstance {
    if (input.canvas === null) {
      throw new Error(`${input.errorContext} requires a canvas before creating WebGL renderer`);
    }
    setPhaseUntilFirstPresentedFrame("precompiling");
    const renderer = createWebGLFigmaRenderer({
      canvas: input.canvas,
      antialias: true,
      pixelRatio,
      backgroundColor: { r: 0, g: 0, b: 0, a: 0 },
      exportSettings: input.renderOptions?.exportSettings,
    });
    renderer.precompileResources();
    rendererRef.value = renderer;
    return renderer;
  }

  function pixelRatioForScene(scene: SceneGraph, holdForViewportMotion: boolean): number {
    const input = currentInput();
    if (input === null) {
      throw new Error("WebGL viewport renderer controller requires input before resolving pixelRatio");
    }
    // While the viewport is moving (this frame is a viewport-motion frame),
    // keep the last applied pixelRatio so a zoom that crosses a quantization
    // bucket does not call renderer.setPixelRatio (which would discard the
    // settled-frame cache the in-gesture scaled blit reads from). The deferred
    // settled render is NOT a viewport-motion frame, so it recomputes the true
    // final-zoom pixelRatio below.
    const held = lastAppliedPixelRatioRef.value;
    if (holdForViewportMotion && held !== null) {
      setPixelRatioSnapshot(held);
      return held;
    }
    const pixelRatio = resolveWebGLViewportPixelRatio({
      devicePixelRatio: scheduler.devicePixelRatio(),
      viewportScale: input.viewportScale,
      surfaceWidth: scene.width,
      surfaceHeight: scene.height,
    });
    lastAppliedPixelRatioRef.value = pixelRatio;
    setPixelRatioSnapshot(pixelRatio);
    return pixelRatio;
  }

  function committedContentChangedNodeIds(
    input: WebGLViewportRendererControllerInput,
    frameReason: WebGLRenderFrameReason,
  ): readonly SceneNodeId[] | undefined {
    // Only a committed in-place content edit (settled frame, no transient
    // translation overlay, node-content scope) can be presented as a
    // changed-region redraw. The renderer still validates that the previous
    // frame is a matching settled frame and falls back to a full render
    // otherwise.
    if (frameReason !== "settled" || input.sceneGraphNodeTranslation !== undefined) {
      return undefined;
    }
    if (input.kiwiDocumentMutation.scope !== "node-content") {
      return undefined;
    }
    const changedGuidKeys = input.kiwiDocumentMutation.changedGuidKeys;
    if (changedGuidKeys.length === 0) {
      return undefined;
    }
    return changedGuidKeys.map((guidKey) => createNodeId(guidKey));
  }

  function renderScene(
    renderer: WebGLFigmaRendererInstance,
    scene: SceneGraph,
    pixelRatio: number,
    frameReason: WebGLRenderFrameReason,
  ): void {
    setPhaseUntilFirstPresentedFrame("rendering");
    const input = currentInput();
    if (input === null) {
      throw new Error("WebGL viewport renderer controller requires input before rendering");
    }
    renderer.setPixelRatio(pixelRatio);
    renderer.render(scene, {
      frameReason,
      transientNodeTranslation: input.sceneGraphNodeTranslation,
      changedNodeIds: committedContentChangedNodeIds(input, frameReason),
    });
    writeMetrics(renderer);
    hasPresentedFrameRef.value = true;
    previousPresentedFrameRef.value = {
      scene,
      pixelRatio,
      kiwiDocumentMutation: input.kiwiDocumentMutation,
      frameReason,
      transientNodeTranslation: input.sceneGraphNodeTranslation,
    };
    publishSnapshot(snapshotAfterCompletedRender(snapshotRef.value, scene, input.kiwiDocumentMutation));
  }

  function presentCommittedSceneGraphFromPreviousTranslatedInteractionFrame(
    scene: SceneGraph,
    pixelRatio: number,
    input: WebGLViewportRendererControllerInput,
  ): boolean {
    if (!canPresentCommittedSceneGraphFromPreviousTranslatedInteractionFrame({
      previousFrame: previousPresentedFrameRef.value,
      committedScene: scene,
      committedPixelRatio: pixelRatio,
      committedKiwiDocumentMutation: input.kiwiDocumentMutation,
      committedSceneGraphNodeTranslation: input.sceneGraphNodeTranslation,
    })) {
      return false;
    }
    previousPresentedFrameRef.value = {
      scene,
      pixelRatio,
      kiwiDocumentMutation: input.kiwiDocumentMutation,
      frameReason: "settled",
      transientNodeTranslation: undefined,
    };
    publishSnapshot({
      ...snapshotRef.value,
      isReady: true,
      status: getWebGLViewportPreparationStatus("ready"),
      lastRenderedSceneViewport: readSceneGraphViewport(scene),
      lastRenderedKiwiDocumentMutationRevision: input.kiwiDocumentMutation.revision,
      lastRenderedKiwiDocumentMutationChangedGuidKeys: input.kiwiDocumentMutation.changedGuidKeys,
    });
    return true;
  }

  function requestSettledRenderAfterViewportMotion(renderer: WebGLFigmaRendererInstance): void {
    cancelSettledRenderSchedule();
    const renderLatestSettledFrame = (): void => {
      settledRenderScheduleRef.value = null;
      const latest = latestRenderRef.value;
      if (latest === null) {
        return;
      }
      const pendingSettledRender = latest;
      // The motion burst has settled: recompute the true pixelRatio for the
      // final viewport (it was held at a stale value during the gesture) so the
      // high-fidelity render is at the correct resolution.
      const settledPixelRatio = pixelRatioForScene(pendingSettledRender.scene, false);
      if (renderer.isScenePrepared(pendingSettledRender.scene)) {
        renderScene(renderer, pendingSettledRender.scene, settledPixelRatio, "settled");
        return;
      }
      renderer.setPixelRatio(settledPixelRatio);
      void renderer.prepareScene(pendingSettledRender.scene).then(
        () => {
          writeMetrics(renderer);
          const current = latestRenderRef.value;
          if (current?.scene !== pendingSettledRender.scene) {
            return;
          }
          renderScene(renderer, pendingSettledRender.scene, settledPixelRatio, "settled");
        },
        (error: unknown) => {
          throw error;
        },
      );
    };
    // Use requestAnimationFrame, not requestIdleCallback: each viewport-motion
    // frame cancels and reschedules this, so it fires on the first frame after
    // the pan/zoom burst stops. rAF is serviced by the frame loop and cannot be
    // starved the way an idle callback can when the main thread stays busy, so
    // the high-fidelity settle reliably follows the gesture.
    settledRenderScheduleRef.value = {
      kind: "animation-frame",
      id: scheduler.requestAnimationFrame(renderLatestSettledFrame),
    };
  }

  function isViewportMotionRender(input: WebGLViewportRendererControllerInput): boolean {
    const previousViewportRevision = previousViewportRevisionRef.value;
    previousViewportRevisionRef.value = input.viewportRevision;
    return previousViewportRevision !== undefined &&
      input.viewportRevision !== undefined &&
      previousViewportRevision !== input.viewportRevision;
  }

  function isSceneGraphInteractionRender(input: WebGLViewportRendererControllerInput): boolean {
    const previousSceneGraphInteractionRevision = previousSceneGraphInteractionRevisionRef.value;
    previousSceneGraphInteractionRevisionRef.value = input.sceneGraphInteractionRevision;
    return shouldRenderWebGLSceneGraphInteractionRevision({
      previousRevision: previousSceneGraphInteractionRevision,
      currentRevision: input.sceneGraphInteractionRevision,
      sceneGraphInteractionActive: input.sceneGraphInteractionActive === true,
      hasPresentedFrame: hasPresentedFrameRef.value,
    });
  }

  function isKiwiDocumentMutationRender(input: WebGLViewportRendererControllerInput): boolean {
    if (input.sceneGraph === null) {
      return false;
    }
    return shouldRenderWebGLKiwiDocumentMutation({
      lastRenderedScene: previousPresentedFrameRef.value?.scene ?? null,
      lastRenderedKiwiDocumentMutationRevision: snapshotRef.value.lastRenderedKiwiDocumentMutationRevision,
      inputSceneGraph: input.sceneGraph,
      inputKiwiDocumentMutation: input.kiwiDocumentMutation,
    });
  }

  function isOnlyViewportInteractionActivation(
    input: WebGLViewportRendererControllerInput,
    viewportMotionRender: boolean,
  ): boolean {
    return input.viewportInteractionActive === true &&
      !viewportMotionRender &&
      hasPresentedFrameRef.value &&
      latestRenderRef.value?.scene === input.sceneGraph;
  }

  function requestRender(
    renderer: WebGLFigmaRendererInstance,
    scene: SceneGraph,
    pixelRatio: number,
    viewportMotionRender: boolean,
    sceneGraphInteractionRender: boolean,
    sceneGraphInteractionActive: boolean,
  ): void {
    const decision = resolveWebGLViewportRenderSchedulingDecision({
      viewportMotionRender,
      sceneGraphInteractionRender,
      sceneGraphInteractionActive,
    });
    renderScene(renderer, scene, pixelRatio, decision.frameReason);
    if (decision.scheduleSettledAfterViewportMotion) {
      requestSettledRenderAfterViewportMotion(renderer);
      return;
    }
    cancelSettledRenderSchedule();
  }

  function renderPreparedSceneIfLatest(
    renderer: WebGLFigmaRendererInstance,
    prepared: PendingPrepare,
    viewportMotionRender: boolean,
    sceneGraphInteractionRender: boolean,
    sceneGraphInteractionActive: boolean,
  ): void {
    const latest = latestRenderRef.value;
    if (latest?.scene !== prepared.scene || latest.pixelRatio !== prepared.pixelRatio) {
      return;
    }
    renderer.setPixelRatio(prepared.pixelRatio);
    requestRender(
      renderer,
      prepared.scene,
      prepared.pixelRatio,
      viewportMotionRender,
      sceneGraphInteractionRender,
      sceneGraphInteractionActive,
    );
  }

  function runPrepareQueue(
    renderer: WebGLFigmaRendererInstance,
    viewportMotionRender: boolean,
    sceneGraphInteractionRender: boolean,
    sceneGraphInteractionActive: boolean,
  ): void {
    if (prepareRunningRef.value) {
      return;
    }
    const next = pendingPrepareRef.value;
    if (next === null) {
      return;
    }
    pendingPrepareRef.value = null;
    prepareRunningRef.value = true;
    setPhaseUntilFirstPresentedFrame("preparing-resources");
    renderer.setPixelRatio(next.pixelRatio);
    void renderer.prepareScene(next.scene).then(
      () => {
        prepareRunningRef.value = false;
        writeMetrics(renderer);
        renderPreparedSceneIfLatest(
          renderer,
          next,
          viewportMotionRender,
          sceneGraphInteractionRender,
          sceneGraphInteractionActive,
        );
        runPrepareQueue(
          renderer,
          viewportMotionRender,
          sceneGraphInteractionRender,
          sceneGraphInteractionActive,
        );
      },
      (error: unknown) => {
        prepareRunningRef.value = false;
        throw error;
      },
    );
  }

  function renderWithResources(
    renderer: WebGLFigmaRendererInstance,
    scene: SceneGraph,
    pixelRatio: number,
    viewportMotionRender: boolean,
    sceneGraphInteractionRender: boolean,
    sceneGraphInteractionActive: boolean,
  ): void {
    if (!renderer.isScenePrepared(scene)) {
      setPhaseUntilFirstPresentedFrame("scheduled");
      pendingPrepareRef.value = { scene, pixelRatio };
      runPrepareQueue(renderer, viewportMotionRender, sceneGraphInteractionRender, sceneGraphInteractionActive);
      return;
    }
    requestRender(renderer, scene, pixelRatio, viewportMotionRender, sceneGraphInteractionRender, sceneGraphInteractionActive);
  }

  function initializeAndRender(
    input: WebGLViewportRendererControllerInput,
    viewportMotionRender: boolean,
    sceneGraphInteractionRender: boolean,
  ): void {
    if (input.sceneGraph === null) {
      return;
    }
    const pixelRatio = pixelRatioForScene(input.sceneGraph, viewportMotionRender);
    latestRenderRef.value = { scene: input.sceneGraph, pixelRatio };
    const renderer = rendererRef.value ?? createRenderer(input, pixelRatio);
    renderWithResources(
      renderer,
      input.sceneGraph,
      pixelRatio,
      viewportMotionRender,
      sceneGraphInteractionRender,
      input.sceneGraphInteractionActive === true,
    );
  }

  function scheduleInitialization(
    input: WebGLViewportRendererControllerInput,
    viewportMotionRender: boolean,
    sceneGraphInteractionRender: boolean,
  ): void {
    cancelInitializationSchedule();
    setPhaseUntilFirstPresentedFrame("scheduled");
    if (input.initializationDelayMs === undefined || input.initializationDelayMs === 0) {
      initializeAndRender(input, viewportMotionRender, sceneGraphInteractionRender);
      return;
    }
    if (hasPresentedFrameRef.value) {
      initializeAndRender(input, viewportMotionRender, sceneGraphInteractionRender);
      return;
    }
    initializeTimerRef.value = scheduler.setTimeout(() => {
      initializeTimerRef.value = null;
      initializeAndRender(input, viewportMotionRender, sceneGraphInteractionRender);
    }, input.initializationDelayMs);
  }

  function renderCurrentInputNow(viewportMotionRender: boolean, sceneGraphInteractionRender: boolean): void {
    const input = currentInput();
    if (input === null || input.canvas === null || input.sceneGraph === null) {
      return;
    }
    validateInitializationDelayMs(input.initializationDelayMs, input.errorContext);
    const pixelRatio = pixelRatioForScene(input.sceneGraph, viewportMotionRender);
    latestRenderRef.value = { scene: input.sceneGraph, pixelRatio };
    if (isOnlyViewportInteractionActivation(input, viewportMotionRender)) {
      return;
    }
    if (presentCommittedSceneGraphFromPreviousTranslatedInteractionFrame(input.sceneGraph, pixelRatio, input)) {
      return;
    }
    const existing = rendererRef.value;
    if (existing !== null && existing.isScenePrepared(input.sceneGraph)) {
      requestRender(
        existing,
        input.sceneGraph,
        pixelRatio,
        viewportMotionRender,
        sceneGraphInteractionRender,
        input.sceneGraphInteractionActive === true,
      );
      return;
    }
    scheduleInitialization(input, viewportMotionRender, sceneGraphInteractionRender);
  }

  function scheduleNextAnimationFrameRender(viewportMotionRender: boolean, sceneGraphInteractionRender: boolean): void {
    scheduledRenderViewportMotionRef.value = scheduledRenderViewportMotionRef.value || viewportMotionRender;
    scheduledRenderSceneGraphInteractionRef.value = scheduledRenderSceneGraphInteractionRef.value || sceneGraphInteractionRender;
    if (scheduledRenderFrameRef.value !== null) {
      return;
    }
    scheduledRenderFrameRef.value = scheduler.requestAnimationFrame(() => {
      scheduledRenderFrameRef.value = null;
      const nextViewportMotionRender = scheduledRenderViewportMotionRef.value;
      const nextSceneGraphInteractionRender = scheduledRenderSceneGraphInteractionRef.value;
      scheduledRenderViewportMotionRef.value = false;
      scheduledRenderSceneGraphInteractionRef.value = false;
      renderCurrentInputNow(nextViewportMotionRender, nextSceneGraphInteractionRender);
    });
  }

  function renderCurrentInput(): void {
    const input = currentInput();
    if (input === null || input.canvas === null || input.sceneGraph === null) {
      return;
    }
    const viewportMotionRender = isViewportMotionRender(input);
    const sceneGraphInteractionRender = isSceneGraphInteractionRender(input);
    const kiwiDocumentMutationRender = isKiwiDocumentMutationRender(input);
    if (shouldRenderWebGLViewportInputSynchronously({
      hasPresentedFrame: hasPresentedFrameRef.value,
      viewportMotionRender,
      sceneGraphInteractionRender,
      kiwiDocumentMutationRender,
    })) {
      cancelScheduledRenderFrame();
      renderCurrentInputNow(viewportMotionRender, sceneGraphInteractionRender);
      return;
    }
    if (hasPresentedFrameRef.value) {
      scheduleNextAnimationFrameRender(viewportMotionRender, sceneGraphInteractionRender);
      return;
    }
    cancelScheduledRenderFrame();
    renderCurrentInputNow(viewportMotionRender, sceneGraphInteractionRender);
  }

  const unsubscribeDevicePixelRatioChange = scheduler.subscribeDevicePixelRatioChange(() => {
    renderCurrentInput();
  });

  return {
    update(input): void {
      inputRef.value = input;
      publishSnapshot(snapshotAfterControllerInput(snapshotRef.value, input));
      renderCurrentInput();
    },

    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot(): WebGLViewportRendererControllerSnapshot {
      return snapshotRef.value;
    },

    dispose(): void {
      disposedRef.value = true;
      unsubscribeDevicePixelRatioChange();
      cancelInitializationSchedule();
      cancelSettledRenderSchedule();
      cancelScheduledRenderFrame();
      pendingPrepareRef.value = null;
      latestRenderRef.value = null;
      previousPresentedFrameRef.value = null;
      previousViewportRevisionRef.value = undefined;
      previousSceneGraphInteractionRevisionRef.value = undefined;
      lastAppliedPixelRatioRef.value = null;
      hasPresentedFrameRef.value = false;
      rendererRef.value?.dispose();
      rendererRef.value = null;
      inputRef.value = null;
      publishSnapshot(INITIAL_CONTROLLER_SNAPSHOT);
      listeners.clear();
    },
  };
}

/** Return the stable server/initial snapshot for sync-external-store consumers. */
export function getInitialWebGLViewportRendererControllerSnapshot(): WebGLViewportRendererControllerSnapshot {
  return INITIAL_CONTROLLER_SNAPSHOT;
}
