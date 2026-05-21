/** @file Renderer debug view backed directly by the Kiwi document context. */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  createFigDocumentContext,
  figDocumentResources,
  findCanvases,
  type FigDocumentContext,
  type FigDocumentResources,
} from "@higma-document-io/fig";
import type { FigNode } from "@higma-document-models/fig/types";
import { readKiwiTransform } from "@higma-document-models/fig/matrix";
import { createFigFamilyRenderOptions } from "@higma-figma-runtime/react-renderer";
import type { TextFontResolver } from "@higma-document-renderers/fig/text";
import { Button, Select, Tabs, Toggle, colorTokens, spacingTokens, fontTokens, radiusTokens } from "@higma-editor-kernel/ui";
import {
  CategoryLegend,
  InspectorCanvasOverlay,
  InspectorTreePanel,
} from "@higma-editor-surfaces/controls/inspector";
import type { InspectorBoxInfo } from "@higma-editor-kernel/core/inspector-types";
import { FigPageRenderer } from "../../src/canvas/rendering/FigPageRenderer";
import type { FigEditorRendererKind } from "../../src/canvas/rendering/renderer-kind";
import {
  FIG_LEGEND_ORDER,
  FIG_NODE_CATEGORY_REGISTRY,
  collectFigInspectorBoxes,
  figNodeToInspectorTree,
} from "../../src/inspector";
import { useBrowserTextFontResolver } from "./browser-text-font-resolver";

type Props = {
  readonly raw: Uint8Array;
};

type CanvasInfo = {
  readonly node: FigNode;
  readonly name: string;
  readonly frames: readonly FrameInfo[];
};

type FrameInfo = {
  readonly node: FigNode;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly viewportX: number;
  readonly viewportY: number;
};

const containerStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: spacingTokens.md,
  padding: spacingTokens.md,
  minHeight: 0,
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  gap: spacingTokens.md,
  alignItems: "center",
  flexWrap: "wrap",
};

const toolbarGroupStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: spacingTokens.xs,
};

const statStyle: CSSProperties = {
  padding: `${spacingTokens.xs} ${spacingTokens.sm}`,
  backgroundColor: colorTokens.background.tertiary,
  borderRadius: radiusTokens.sm,
  fontSize: fontTokens.size.xs,
};

const contentStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  gap: spacingTokens.md,
};

const previewStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "auto",
  backgroundColor: colorTokens.background.primary,
  borderRadius: radiusTokens.md,
  border: `1px solid ${colorTokens.border.subtle}`,
  padding: spacingTokens.md,
};

const stageStyle: CSSProperties = {
  position: "relative",
  display: "inline-block",
};

const overlaySvgStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
};

const sidebarStyle: CSSProperties = {
  width: 320,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  gap: spacingTokens.md,
  minHeight: 0,
};

const frameListStyle: CSSProperties = {
  backgroundColor: colorTokens.background.secondary,
  border: `1px solid ${colorTokens.border.subtle}`,
  borderRadius: radiusTokens.md,
  overflow: "hidden",
};

const frameListTitleStyle: CSSProperties = {
  padding: spacingTokens.sm,
  fontSize: fontTokens.size.sm,
  fontWeight: fontTokens.weight.semibold,
  borderBottom: `1px solid ${colorTokens.border.subtle}`,
};

const frameItemStyle: CSSProperties = {
  padding: spacingTokens.sm,
  cursor: "pointer",
  borderBottom: `1px solid ${colorTokens.border.subtle}`,
};

const frameItemActiveStyle: CSSProperties = {
  backgroundColor: colorTokens.background.tertiary,
};

const frameNameStyle: CSSProperties = {
  fontSize: fontTokens.size.sm,
  fontWeight: fontTokens.weight.medium,
};

const frameSizeStyle: CSSProperties = {
  fontSize: fontTokens.size.xs,
  color: colorTokens.text.secondary,
};

const treeStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
  backgroundColor: colorTokens.background.secondary,
  borderRadius: radiusTokens.md,
  border: `1px solid ${colorTokens.border.subtle}`,
};

const emptyStateStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  height: "100%",
  color: colorTokens.text.secondary,
  fontSize: fontTokens.size.md,
};

const labelStyle: CSSProperties = {
  fontSize: fontTokens.size.sm,
  color: colorTokens.text.secondary,
};

const fontEnabledStyle: CSSProperties = {
  fontSize: fontTokens.size.xs,
  color: colorTokens.accent.success,
};

function requireNodeSize(node: FigNode): NonNullable<FigNode["size"]> {
  if (node.size === undefined) {
    throw new Error(`RendererDebugView requires size for "${node.name ?? "(unnamed)"}"`);
  }
  return node.size;
}

function collectFrameInfos(resources: FigDocumentResources, canvas: FigNode): readonly FrameInfo[] {
  return resources.childrenOf(canvas).map((child) => {
    const size = requireNodeSize(child);
    const transform = readKiwiTransform(child.transform);
    return {
      node: child,
      name: child.name ?? "Unnamed Frame",
      width: size.x,
      height: size.y,
      viewportX: transform.m02,
      viewportY: transform.m12,
    };
  });
}

function collectCanvases(context: FigDocumentContext, resources: FigDocumentResources): readonly CanvasInfo[] {
  return findCanvases(context.document)
    .map((canvas) => ({
      node: canvas,
      name: canvas.name ?? "Unnamed Page",
      frames: collectFrameInfos(resources, canvas),
    }));
}

function renderFontAccessControl({
  fontAccessSupported,
  fontAccessGranted,
  fontAccessReady,
  onRequestFontAccess,
}: {
  readonly fontAccessSupported: boolean;
  readonly fontAccessGranted: boolean;
  readonly fontAccessReady: boolean;
  readonly onRequestFontAccess: () => void;
}): ReactNode {
  if (!fontAccessSupported) {
    return null;
  }
  if (fontAccessGranted && !fontAccessReady) {
    return <span style={fontEnabledStyle}>Fonts loading</span>;
  }
  if (fontAccessReady) {
    return <span style={fontEnabledStyle}>Fonts enabled</span>;
  }
  return <Button variant="outline" size="sm" onClick={onRequestFontAccess}>Enable Fonts</Button>;
}

function shiftInspectorBoxes(
  boxes: readonly InspectorBoxInfo[],
  origin: { readonly x: number; readonly y: number },
): readonly InspectorBoxInfo[] {
  return boxes.map((box) => ({
    ...box,
    transform: [
      box.transform[0],
      box.transform[1],
      box.transform[2],
      box.transform[3],
      box.transform[4] - origin.x,
      box.transform[5] - origin.y,
    ],
  }));
}

function renderFramePreview({
  context,
  resources,
  currentCanvas,
  currentFrame,
  rendererMode,
  showHiddenNodes,
  inspectorEnabled,
  textFontResolver,
  highlightedId,
  hoveredId,
  onHover,
  onClick,
}: {
  readonly context: FigDocumentContext;
  readonly resources: FigDocumentResources;
  readonly currentCanvas: CanvasInfo;
  readonly currentFrame: FrameInfo;
  readonly rendererMode: FigEditorRendererKind;
  readonly showHiddenNodes: boolean;
  readonly inspectorEnabled: boolean;
  readonly textFontResolver: TextFontResolver | undefined;
  readonly highlightedId: string | null;
  readonly hoveredId: string | null;
  readonly onHover: (nodeId: string | null) => void;
  readonly onClick: (nodeId: string) => void;
}): ReactNode {
  const boxes = shiftInspectorBoxes(
    collectFigInspectorBoxes({
      root: currentFrame.node,
      childrenOf: resources.childrenOf,
      showHiddenNodes,
    }),
    { x: currentFrame.viewportX, y: currentFrame.viewportY },
  );

  return (
    <div style={stageStyle}>
      <svg
        width={currentFrame.width}
        height={currentFrame.height}
        viewBox={`0 0 ${currentFrame.width} ${currentFrame.height}`}
      >
        <FigPageRenderer
          page={currentCanvas.node}
          nodes={[currentFrame.node]}
          canvasWidth={currentFrame.width}
          canvasHeight={currentFrame.height}
          viewportX={currentFrame.viewportX}
          viewportY={currentFrame.viewportY}
          viewportWidth={currentFrame.width}
          viewportHeight={currentFrame.height}
          viewportScale={1}
          resources={resources}
          renderOptions={createFigFamilyRenderOptions(context)}
          renderer={rendererMode}
          textFontResolver={textFontResolver}
        />
      </svg>
      {inspectorEnabled && rendererMode === "svg" && (
        <svg
          style={overlaySvgStyle}
          width={currentFrame.width}
          height={currentFrame.height}
          viewBox={`0 0 ${currentFrame.width} ${currentFrame.height}`}
        >
          <InspectorCanvasOverlay
            boxes={boxes}
            registry={FIG_NODE_CATEGORY_REGISTRY}
            highlightedNodeId={highlightedId}
            hoveredNodeId={hoveredId}
            onNodeHover={onHover}
            onNodeClick={onClick}
            interactive
          />
        </svg>
      )}
    </div>
  );
}

function RendererDebugContent({ context }: { readonly context: FigDocumentContext }) {
  const resources = useMemo(() => figDocumentResources(context), [context]);
  const canvases = useMemo(() => collectCanvases(context, resources), [context, resources]);
  const [selectedCanvasIndex, setSelectedCanvasIndex] = useState(0);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  const [showHiddenNodes, setShowHiddenNodes] = useState(false);
  const [inspectorEnabled, setInspectorEnabled] = useState(false);
  const [rendererMode, setRendererMode] = useState<FigEditorRendererKind>("svg");
  const fontResolverState = useBrowserTextFontResolver(context);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const currentCanvas = canvases[selectedCanvasIndex];
  const currentFrame = currentCanvas?.frames[selectedFrameIndex];
  const pageOptions = useMemo(
    () => canvases.map((canvas, index) => ({ value: String(index), label: `${canvas.name} (${canvas.frames.length})` })),
    [canvases],
  );
  const frameOptions = useMemo(
    () => (currentCanvas?.frames ?? []).map((frame, index) => ({ value: String(index), label: `${frame.name} (${frame.width}x${frame.height})` })),
    [currentCanvas],
  );
  const textFontResolver = fontResolverState.resolver;
  const treeRoot = useMemo(() => {
    if (currentFrame === undefined) {
      return undefined;
    }
    return figNodeToInspectorTree({
      root: currentFrame.node,
      childrenOf: resources.childrenOf,
      showHiddenNodes,
    });
  }, [currentFrame, resources.childrenOf, showHiddenNodes]);

  const handleCanvasChange = useCallback((value: string): void => {
    setSelectedCanvasIndex(Number(value));
    setSelectedFrameIndex(0);
    setHighlightedId(null);
    setHoveredId(null);
  }, []);
  const handleFrameChange = useCallback((value: string): void => {
    setSelectedFrameIndex(Number(value));
    setHighlightedId(null);
    setHoveredId(null);
  }, []);
  const handleNodeClick = useCallback((id: string): void => {
    setHighlightedId((previous) => {
      if (previous === id) {
        return null;
      }
      return id;
    });
  }, []);
  if (currentCanvas === undefined || currentFrame === undefined || treeRoot === undefined) {
    return <div style={emptyStateStyle}>No frames</div>;
  }

  return (
    <div style={containerStyle}>
      <div style={toolbarStyle}>
        <div style={statStyle}><strong>{canvases.length}</strong> pages</div>
        <div style={statStyle}><strong>{currentCanvas.frames.length}</strong> frames</div>
        <div style={statStyle}><strong>{context.document.nodeChanges.length}</strong> nodes</div>
        <div style={toolbarGroupStyle}>
          <span style={labelStyle}>Page:</span>
          <Select value={String(selectedCanvasIndex)} onChange={handleCanvasChange} options={pageOptions} />
        </div>
        <div style={toolbarGroupStyle}>
          <span style={labelStyle}>Frame:</span>
          <Select value={String(selectedFrameIndex)} onChange={handleFrameChange} options={frameOptions} />
        </div>
        <Tabs<FigEditorRendererKind>
          items={[
            { id: "svg", label: "SVG", content: null },
            { id: "webgl", label: "WebGL", content: null },
          ]}
          value={rendererMode}
          onChange={setRendererMode}
          size="sm"
          style={{ flex: "none" }}
        />
        <Toggle
          checked={inspectorEnabled}
          onChange={setInspectorEnabled}
          label="Inspector"
          disabled={rendererMode === "webgl"}
        />
        <Toggle
          checked={showHiddenNodes}
          onChange={setShowHiddenNodes}
          label="Show hidden"
        />
        {renderFontAccessControl({
          fontAccessSupported: fontResolverState.supported,
          fontAccessGranted: fontResolverState.granted,
          fontAccessReady: fontResolverState.ready,
          onRequestFontAccess: fontResolverState.requestAccess,
        })}
      </div>
      <div style={contentStyle}>
        <div style={previewStyle}>
          {renderFramePreview({
            context,
            resources,
            currentCanvas,
            currentFrame,
            rendererMode,
            showHiddenNodes,
            inspectorEnabled,
            textFontResolver,
            highlightedId,
            hoveredId,
            onHover: setHoveredId,
            onClick: handleNodeClick,
          })}
        </div>
        <div style={sidebarStyle}>
          <CategoryLegend registry={FIG_NODE_CATEGORY_REGISTRY} order={FIG_LEGEND_ORDER} />
          <div style={frameListStyle}>
            <div style={frameListTitleStyle}>Frames</div>
            {currentCanvas.frames.map((frame, index) => (
              <div
                key={`${frame.name}-${index}`}
                style={{ ...frameItemStyle, ...(index === selectedFrameIndex ? frameItemActiveStyle : {}) }}
                onClick={() => handleFrameChange(String(index))}
              >
                <div style={frameNameStyle}>{frame.name}</div>
                <div style={frameSizeStyle}>{frame.width} x {frame.height}</div>
              </div>
            ))}
          </div>
          <div style={treeStyle}>
            <InspectorTreePanel
              rootNode={treeRoot}
              registry={FIG_NODE_CATEGORY_REGISTRY}
              highlightedNodeId={highlightedId}
              hoveredNodeId={hoveredId}
              onNodeHover={setHoveredId}
              onNodeClick={handleNodeClick}
              showHiddenNodes={showHiddenNodes}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Render SVG/WebGL debug output for one loaded fig file. */
export function RendererDebugView({ raw }: Props) {
  const [context, setContext] = useState<FigDocumentContext | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    if (raw.length === 0) {
      setContext(null);
      setParseError(null);
      return;
    }
    const cancelled = { value: false };
    createFigDocumentContext(raw).then(
      (loadedContext) => {
        if (cancelled.value) {
          return;
        }
        setContext(loadedContext);
        setParseError(null);
      },
      (error: unknown) => {
        if (cancelled.value) {
          return;
        }
        setContext(null);
        setParseError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled.value = true;
    };
  }, [raw]);

  if (parseError !== null) {
    return <div style={emptyStateStyle}>Parse error: {parseError}</div>;
  }
  if (context === null) {
    return <div style={emptyStateStyle}>Parsing .fig for renderer debug...</div>;
  }
  return <RendererDebugContent context={context} />;
}
