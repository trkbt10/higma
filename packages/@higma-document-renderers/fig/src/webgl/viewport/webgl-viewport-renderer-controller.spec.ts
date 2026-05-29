/** @file WebGL viewport renderer scheduling policy tests. */

import { createNodeId, type RectNode, type SceneGraph } from "../../scene-graph";
import {
  canPresentCommittedSceneGraphFromPreviousTranslatedInteractionFrame,
  createWebGLViewportRendererGlobalThisScheduler,
  getInitialWebGLViewportRendererControllerSnapshot,
  hasWebGLViewportRendererGlobalThisSchedulerHost,
  shouldRenderWebGLKiwiDocumentMutation,
  resolveWebGLViewportRenderSchedulingDecision,
  shouldNotifyWebGLViewportRendererSubscribers,
  shouldRenderWebGLSceneGraphInteractionRevision,
  shouldRenderWebGLViewportInputSynchronously,
  type WebGLViewportRendererGlobalThisSchedulerHost,
  type WebGLViewportRendererControllerSnapshot,
} from "./webgl-viewport-renderer-controller";

function controllerSnapshot(
  overrides: Partial<WebGLViewportRendererControllerSnapshot>,
): WebGLViewportRendererControllerSnapshot {
  return {
    ...getInitialWebGLViewportRendererControllerSnapshot(),
    ...overrides,
  };
}

const SOURCE_DOCUMENT_REFERENCE = Object.freeze({});
const IDENTITY = Object.freeze({ m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 });

function inertMediaQueryList(): MediaQueryList {
  return {
    matches: false,
    media: "(resolution: 2dppx)",
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  };
}

function schedulerHost(): WebGLViewportRendererGlobalThisSchedulerHost {
  return {
    requestAnimationFrame: () => 11,
    cancelAnimationFrame: () => undefined,
    requestIdleCallback: () => 12,
    cancelIdleCallback: () => undefined,
    setTimeout: () => 13,
    clearTimeout: () => undefined,
    devicePixelRatio: 2,
    matchMedia: () => inertMediaQueryList(),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

function rect(id: string, x: number, y: number): RectNode {
  return {
    id: createNodeId(id),
    type: "rect",
    transform: { ...IDENTITY, m02: x, m12: y },
    opacity: 1,
    visible: true,
    effects: [],
    width: 10,
    height: 20,
    fills: [],
  };
}

function scene(child: RectNode, version: number): SceneGraph {
  return {
    width: 100,
    height: 80,
    version,
    sourceDocumentReference: SOURCE_DOCUMENT_REFERENCE,
    viewport: { x: 0, y: 0, width: 100, height: 80 },
    root: {
      id: createNodeId("root"),
      type: "group",
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      children: [child],
    },
  };
}

describe("resolveWebGLViewportRenderSchedulingDecision", () => {
  it("records settled frame reason for non-motion, non-interaction input", () => {
    expect(resolveWebGLViewportRenderSchedulingDecision({
      viewportMotionRender: false,
      sceneGraphInteractionRender: false,
      sceneGraphInteractionActive: false,
    })).toEqual({
      frameReason: "settled",
      scheduleSettledAfterViewportMotion: false,
    });
  });

  it("records viewport-motion and defers a settled render whenever the viewport moved", () => {
    expect(resolveWebGLViewportRenderSchedulingDecision({
      viewportMotionRender: true,
      sceneGraphInteractionRender: false,
      sceneGraphInteractionActive: false,
    })).toEqual({
      frameReason: "viewport-motion",
      scheduleSettledAfterViewportMotion: true,
    });
  });

  it("records scene graph interaction frame reason only while scene graph input is active", () => {
    expect(resolveWebGLViewportRenderSchedulingDecision({
      viewportMotionRender: false,
      sceneGraphInteractionRender: true,
      sceneGraphInteractionActive: true,
    })).toEqual({
      frameReason: "scene-graph-interaction",
      scheduleSettledAfterViewportMotion: false,
    });
  });

  it("prefers an active scene graph interaction over a coincident viewport motion", () => {
    expect(resolveWebGLViewportRenderSchedulingDecision({
      viewportMotionRender: true,
      sceneGraphInteractionRender: true,
      sceneGraphInteractionActive: true,
    })).toEqual({
      frameReason: "scene-graph-interaction",
      scheduleSettledAfterViewportMotion: false,
    });
  });

  it("falls back to settled when a scene graph interaction render is not active", () => {
    expect(resolveWebGLViewportRenderSchedulingDecision({
      viewportMotionRender: false,
      sceneGraphInteractionRender: true,
      sceneGraphInteractionActive: false,
    })).toEqual({
      frameReason: "settled",
      scheduleSettledAfterViewportMotion: false,
    });
  });
});

describe("createWebGLViewportRendererGlobalThisScheduler", () => {
  it("accepts an explicit globalThis host instead of a Window object", () => {
    const host = schedulerHost();

    expect(hasWebGLViewportRendererGlobalThisSchedulerHost(host)).toBe(true);
    expect(createWebGLViewportRendererGlobalThisScheduler(host).devicePixelRatio()).toBe(2);
  });

  it("rejects global objects without viewport scheduler APIs", () => {
    expect(hasWebGLViewportRendererGlobalThisSchedulerHost({})).toBe(false);
  });
});

describe("shouldRenderWebGLSceneGraphInteractionRevision", () => {
  it("renders the first observed active interaction revision after a frame is already presented", () => {
    expect(shouldRenderWebGLSceneGraphInteractionRevision({
      previousRevision: undefined,
      currentRevision: 10,
      sceneGraphInteractionActive: true,
      hasPresentedFrame: true,
    })).toBe(true);
  });

  it("does not classify the first non-interactive revision as interaction work", () => {
    expect(shouldRenderWebGLSceneGraphInteractionRevision({
      previousRevision: undefined,
      currentRevision: 10,
      sceneGraphInteractionActive: false,
      hasPresentedFrame: true,
    })).toBe(false);
  });

  it("does not render an interaction frame before any WebGL frame has been presented", () => {
    expect(shouldRenderWebGLSceneGraphInteractionRevision({
      previousRevision: undefined,
      currentRevision: 1,
      sceneGraphInteractionActive: true,
      hasPresentedFrame: false,
    })).toBe(false);
  });

  it("renders when a later interaction revision changes", () => {
    expect(shouldRenderWebGLSceneGraphInteractionRevision({
      previousRevision: 10,
      currentRevision: 11,
      sceneGraphInteractionActive: true,
      hasPresentedFrame: true,
    })).toBe(true);
  });
});

describe("shouldRenderWebGLViewportInputSynchronously", () => {
  it("renders SceneGraph interaction updates inside the controller input turn after a frame exists", () => {
    expect(shouldRenderWebGLViewportInputSynchronously({
      hasPresentedFrame: true,
      viewportMotionRender: false,
      sceneGraphInteractionRender: true,
      kiwiDocumentMutationRender: false,
    })).toBe(true);
  });

  it("renders viewport-motion updates inside the controller input turn after a frame exists", () => {
    expect(shouldRenderWebGLViewportInputSynchronously({
      hasPresentedFrame: true,
      viewportMotionRender: true,
      sceneGraphInteractionRender: false,
      kiwiDocumentMutationRender: false,
    })).toBe(true);
  });

  it("renders Kiwi document mutations inside the controller input turn after a frame exists", () => {
    expect(shouldRenderWebGLViewportInputSynchronously({
      hasPresentedFrame: true,
      viewportMotionRender: false,
      sceneGraphInteractionRender: false,
      kiwiDocumentMutationRender: true,
    })).toBe(true);
  });

  it("renders a Kiwi document mutation inside the controller input turn when it arrives with viewport motion", () => {
    expect(shouldRenderWebGLViewportInputSynchronously({
      hasPresentedFrame: true,
      viewportMotionRender: true,
      sceneGraphInteractionRender: false,
      kiwiDocumentMutationRender: true,
    })).toBe(true);
  });

  it("does not bypass animation-frame scheduling for non-document non-interactive non-viewport updates", () => {
    expect(shouldRenderWebGLViewportInputSynchronously({
      hasPresentedFrame: true,
      viewportMotionRender: false,
      sceneGraphInteractionRender: false,
      kiwiDocumentMutationRender: false,
    })).toBe(false);
  });

  it("does not render synchronously before the first presented frame", () => {
    expect(shouldRenderWebGLViewportInputSynchronously({
      hasPresentedFrame: false,
      viewportMotionRender: true,
      sceneGraphInteractionRender: true,
      kiwiDocumentMutationRender: true,
    })).toBe(false);
  });
});

describe("shouldRenderWebGLKiwiDocumentMutation", () => {
  it("does not render when a Kiwi mutation revision changes but the renderer input SceneGraph reference is unchanged", () => {
    const currentScene = scene(rect("2316:9650", 10, 20), 1);

    expect(shouldRenderWebGLKiwiDocumentMutation({
      lastRenderedScene: currentScene,
      lastRenderedKiwiDocumentMutationRevision: 1,
      inputSceneGraph: currentScene,
      inputKiwiDocumentMutation: { revision: 2, scope: "reference-data", changedGuidKeys: ["2316:9650"] },
    })).toBe(false);
  });

  it("renders when a Kiwi mutation revision changes and the renderer input SceneGraph reference changes", () => {
    const previousScene = scene(rect("2316:9650", 10, 20), 1);
    const currentScene = scene(rect("2316:9650", 12, 20), 2);

    expect(shouldRenderWebGLKiwiDocumentMutation({
      lastRenderedScene: previousScene,
      lastRenderedKiwiDocumentMutationRevision: 1,
      inputSceneGraph: currentScene,
      inputKiwiDocumentMutation: { revision: 2, scope: "node-content", changedGuidKeys: ["2316:9650"] },
    })).toBe(true);
  });
});

describe("shouldNotifyWebGLViewportRendererSubscribers", () => {
  it("does not notify React subscribers for render bookkeeping only", () => {
    const previous = controllerSnapshot({
      isReady: true,
      renderRevision: 1,
      lastRenderedSceneViewport: { x: 0, y: 0, width: 100, height: 100 },
      lastRenderedKiwiDocumentMutationRevision: 1,
      lastRenderedKiwiDocumentMutationChangedGuidKeys: [],
    });
    const next = controllerSnapshot({
      isReady: true,
      renderRevision: 2,
      lastRenderedSceneViewport: { x: 0, y: 0, width: 100, height: 100 },
      lastRenderedKiwiDocumentMutationRevision: 1,
      lastRenderedKiwiDocumentMutationChangedGuidKeys: [],
    });

    expect(shouldNotifyWebGLViewportRendererSubscribers(previous, next)).toBe(false);
  });

  it("notifies React subscribers for loading status changes", () => {
    expect(shouldNotifyWebGLViewportRendererSubscribers(
      controllerSnapshot({ isReady: false }),
      controllerSnapshot({ isReady: true }),
    )).toBe(true);
  });

  it("does not notify React subscribers for viewport bookkeeping that is published through onSnapshot", () => {
    expect(shouldNotifyWebGLViewportRendererSubscribers(
      controllerSnapshot({
        isReady: true,
        inputSceneViewport: { x: 0, y: 0, width: 100, height: 100 },
        lastRenderedSceneViewport: { x: 0, y: 0, width: 100, height: 100 },
      }),
      controllerSnapshot({
        isReady: true,
        inputSceneViewport: { x: 10, y: 0, width: 100, height: 100 },
        lastRenderedSceneViewport: { x: 0, y: 0, width: 100, height: 100 },
      }),
    )).toBe(false);
  });

  it("does not notify React subscribers for completed render bookkeeping without visible status change", () => {
    expect(shouldNotifyWebGLViewportRendererSubscribers(
      controllerSnapshot({
        isReady: true,
        inputSceneViewport: { x: 10, y: 0, width: 100, height: 100 },
        lastRenderedSceneViewport: { x: 0, y: 0, width: 100, height: 100 },
      }),
      controllerSnapshot({
        isReady: true,
        inputSceneViewport: { x: 10, y: 0, width: 100, height: 100 },
        lastRenderedSceneViewport: { x: 10, y: 0, width: 100, height: 100 },
      }),
    )).toBe(false);
  });
});

describe("canPresentCommittedSceneGraphFromPreviousTranslatedInteractionFrame", () => {
  it("accepts the committed Kiwi transform when it matches the previous interaction frame", () => {
    const beforeNode = rect("2316:9650", 10, 20);
    const afterNode = {
      ...beforeNode,
      transform: { ...beforeNode.transform, m02: 15, m12: 27 },
    };

    expect(canPresentCommittedSceneGraphFromPreviousTranslatedInteractionFrame({
      previousFrame: {
        scene: scene(beforeNode, 1),
        pixelRatio: 1,
        kiwiDocumentMutation: { revision: 0, scope: "initial-load", changedGuidKeys: [] },
        frameReason: "scene-graph-interaction",
        transientNodeTranslation: { nodeId: beforeNode.id, dx: 5, dy: 7 },
      },
      committedScene: scene(afterNode, 2),
      committedPixelRatio: 1,
      committedKiwiDocumentMutation: { revision: 1, scope: "node-content", changedGuidKeys: ["2316:9650"] },
      committedSceneGraphNodeTranslation: undefined,
    })).toBe(true);
  });

  it("rejects the committed Kiwi transform when the target node content changed", () => {
    const beforeNode = rect("2316:9650", 10, 20);
    const afterNode = {
      ...beforeNode,
      width: 11,
      transform: { ...beforeNode.transform, m02: 15, m12: 27 },
    };

    expect(canPresentCommittedSceneGraphFromPreviousTranslatedInteractionFrame({
      previousFrame: {
        scene: scene(beforeNode, 1),
        pixelRatio: 1,
        kiwiDocumentMutation: { revision: 0, scope: "initial-load", changedGuidKeys: [] },
        frameReason: "scene-graph-interaction",
        transientNodeTranslation: { nodeId: beforeNode.id, dx: 5, dy: 7 },
      },
      committedScene: scene(afterNode, 2),
      committedPixelRatio: 1,
      committedKiwiDocumentMutation: { revision: 1, scope: "node-content", changedGuidKeys: ["2316:9650"] },
      committedSceneGraphNodeTranslation: undefined,
    })).toBe(false);
  });
});
