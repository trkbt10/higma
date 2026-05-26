/**
 * @file Dev entry point for fig-editor.
 *
 * Two modes:
 * - Editor: Full FigEditor with .fig file
 * - Renderer Debug: SVG/WebGL renderer switching + inspector overlay
 *
 * Both modes share the same .fig file loading pipeline.
 */

import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import {
  createEmptyFigDocument,
  createFigDocumentContextFromLoaded,
  type FigDocumentContextKiwiSourceDocument,
  type FigDocumentContext,
} from "@higma-document-io/fig";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";
import type { EditorPanel } from "@higma-editor-surfaces/controls/editor-shell";
import { Button, Select, Tabs, Toggle, injectCSSVariables, colorTokens, spacingTokens, fontTokens, radiusTokens } from "@higma-editor-kernel/ui";
import { FigEditor } from "../src/editor/FigEditor";
import type { FigEditorStore } from "../src/context/FigEditorContext";
import { createGlobalThisPublishedFigEditorStore } from "../src/context/fig-editor-store-global-this-publication";
import type { FigEditorRendererKind } from "../src/canvas/rendering/renderer-kind";
import { PageListPanel } from "../src/panels/pages/PageListPanel";
import { LayerPanel } from "../src/panels/layers/LayerPanel";
import { PropertyPanel } from "../src/panels/properties/PropertyPanel";
import { FigInspectorPanel } from "../src/panels/inspector/FigInspectorPanel";
import { FigInspectorDetailsPanel } from "../src/panels/inspector/FigInspectorDetailsPanel";
import { FigInspectorOverlay, FigInspectorProvider } from "../src/inspector";
import { FileDropZone } from "./components/FileDropZone";
import { RendererDebugView } from "./components/RendererDebugView";
import { useBrowserTextFontResolver } from "./components/browser-text-font-resolver";

injectCSSVariables();

// =============================================================================
// Types
// =============================================================================

type DevMode = "editor" | "renderer-debug";

const editorRendererOptions = [
  { value: "svg", label: "SVG" },
  { value: "webgl", label: "WebGL" },
] satisfies readonly { readonly value: FigEditorRendererKind; readonly label: string }[];

type LoadedFile = {
  readonly context: FigDocumentContext;
  readonly fileName: string;
  readonly sourceFileNames: readonly string[];
};

type LoadedEditorSession = LoadedFile & {
  readonly store: FigEditorStore;
  readonly dispose: () => void;
};

type LoadedFigFile = Awaited<ReturnType<typeof loadFigFile>>;

type LoadedFigInput = {
  readonly loaded: LoadedFigFile;
  readonly fileName: string;
};

type DevFigRouteInput = {
  readonly ref: string;
  readonly kind: "local-path" | "url";
};

type DevFileRoute = {
  readonly fig: DevFigRouteInput;
  readonly sources: readonly DevFigRouteInput[];
  readonly mode: DevMode;
  readonly renderer: FigEditorRendererKind;
  readonly frameGuid?: string;
  readonly captureFrameOnly: boolean;
};

// =============================================================================
// Styles (layout only — visual styling via design tokens)
// =============================================================================

const appStyle: CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  backgroundColor: colorTokens.background.secondary,
  color: colorTokens.text.primary,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: `${spacingTokens.sm} ${spacingTokens.lg}`,
  borderBottom: `1px solid ${colorTokens.border.primary}`,
  backgroundColor: colorTokens.background.secondary,
};

const headerLeftStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: spacingTokens.md,
};

const titleStyle: CSSProperties = {
  fontSize: fontTokens.size.xl,
  fontWeight: fontTokens.weight.semibold,
  margin: 0,
};

const fileNameStyle: CSSProperties = {
  fontSize: fontTokens.size.md,
  color: colorTokens.text.secondary,
};

const headerRightStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: spacingTokens.sm,
};

const fontEnabledStyle: CSSProperties = {
  fontSize: fontTokens.size.xs,
  color: colorTokens.accent.success,
};

const mainStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

const mainPaddedStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  padding: spacingTokens.lg,
  minHeight: 0,
  overflow: "auto",
};

const errorStyle: CSSProperties = {
  margin: spacingTokens.lg,
  padding: spacingTokens.md,
  backgroundColor: "rgba(239, 68, 68, 0.1)",
  border: `1px solid ${colorTokens.accent.danger}`,
  borderRadius: radiusTokens.md,
  color: colorTokens.accent.danger,
  fontSize: fontTokens.size.md,
};

const tabsContainerStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

const leftPanelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  overflow: "hidden",
};

const layerPanelWrapperStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
};

const rightPanelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  overflow: "hidden",
};

const rightTabsStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  // Tabs primitive owns horizontal layout; we keep horizontal overflow
  // hidden so the tab strip never grows the panel wider. Vertical
  // overflow stays `hidden` here too, because the active tab content
  // wraps PropertyPanel/InspectorPanel in its own `overflowY: auto`
  // pane — letting it scroll here as well would chain two scroll
  // containers and break wheel events from reaching the inner one.
  overflowX: "hidden",
  overflowY: "hidden",
};

/**
 * Wrapper around each tab's content that owns the vertical scroll for
 * that tab. The outer Tabs primitive is a flex column whose content
 * area gets `flex: 1; minHeight: 0`, so wrapping it again here with
 * `flex: 1; minHeight: 0; overflowY: auto` gives us a scrollable pane
 * that fills the remaining vertical space after the tab strip. Without
 * this, every overflow rule above clamped the content to the panel's
 * fixed height and the lower property sections were unreachable.
 */
const tabContentScrollableStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
  display: "flex",
  flexDirection: "column",
};

const inspectorTabStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
};

const inspectorTreeWrapperStyle: CSSProperties = {
  flex: "0 0 45%",
  minHeight: 0,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

const inspectorDetailsWrapperStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  borderTop: `1px solid ${colorTokens.border.primary}`,
};

function InspectorTabContent() {
  return (
    <div style={inspectorTabStyle}>
      <div style={inspectorTreeWrapperStyle}>
        <FigInspectorPanel />
      </div>
      <div style={inspectorDetailsWrapperStyle}>
        <FigInspectorDetailsPanel />
      </div>
    </div>
  );
}

function PropertiesTabContent() {
  return (
    <div style={tabContentScrollableStyle}>
      <PropertyPanel />
    </div>
  );
}

function LeftPanelContent() {
  return (
    <div style={leftPanelStyle}>
      <PageListPanel />
      <div style={layerPanelWrapperStyle}>
        <LayerPanel />
      </div>
    </div>
  );
}

type RightTab = "inspector" | "properties";

function RightPanelContent() {
  return (
    <div style={rightPanelStyle}>
      <Tabs<RightTab>
        items={[
          { id: "inspector", label: "Inspector", content: <InspectorTabContent /> },
          { id: "properties", label: "Properties", content: <PropertiesTabContent /> },
        ]}
        defaultValue="properties"
        size="sm"
        style={rightTabsStyle}
      />
    </div>
  );
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
}) {
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

function LoadedDevShell({
  loadedEditorSession,
  mode,
  setMode,
  inspectorOverlayEnabled,
  setInspectorOverlayEnabled,
  editorRenderer,
  setEditorRenderer,
  editorPanels,
  debugFrameGuid,
  rendererDebugCaptureFrameOnly,
  onClose,
}: {
  readonly loadedEditorSession: LoadedEditorSession;
  readonly mode: DevMode;
  readonly setMode: (mode: DevMode) => void;
  readonly inspectorOverlayEnabled: boolean;
  readonly setInspectorOverlayEnabled: (enabled: boolean) => void;
  readonly editorRenderer: FigEditorRendererKind;
  readonly setEditorRenderer: (renderer: FigEditorRendererKind) => void;
  readonly editorPanels: EditorPanel[];
  readonly debugFrameGuid: string | undefined;
  readonly rendererDebugCaptureFrameOnly: boolean;
  readonly onClose: () => void;
}) {
  const fontResolverState = useBrowserTextFontResolver(loadedEditorSession.context);
  return (
    <div style={appStyle}>
      <header style={headerStyle}>
        <div style={headerLeftStyle}>
          <h1 style={titleStyle}>Fig Editor Dev</h1>
          <span style={fileNameStyle}>{formatLoadedFileName(loadedEditorSession)}</span>
        </div>
        <div style={headerRightStyle}>
          {mode === "editor" && (
            <>
              <Select value={editorRenderer} onChange={setEditorRenderer} options={editorRendererOptions} style={{ width: 96 }} />
              <Toggle
                checked={inspectorOverlayEnabled}
                onChange={setInspectorOverlayEnabled}
                label="Inspect overlay"
              />
              {renderFontAccessControl({
                fontAccessSupported: fontResolverState.supported,
                fontAccessGranted: fontResolverState.granted,
                fontAccessReady: fontResolverState.ready,
                onRequestFontAccess: fontResolverState.requestAccess,
              })}
            </>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </header>
      <Tabs<DevMode>
        items={[
          {
            id: "editor",
            label: "Editor",
            content: (
              <div style={mainStyle}>
                <FigInspectorProvider>
                  <FigEditor
                    store={loadedEditorSession.store}
                    panels={editorPanels}
                    renderer={editorRenderer}
                    textFontResolver={fontResolverState.resolver}
                  >
                    {inspectorOverlayEnabled ? <FigInspectorOverlay /> : null}
                  </FigEditor>
                </FigInspectorProvider>
              </div>
            ),
          },
          {
            id: "renderer-debug",
            label: "Renderer Debug",
            content: (
              <div style={mainStyle}>
                <RendererDebugView
                  key={`${loadedEditorSession.fileName}:${debugFrameGuid ?? ""}:${editorRenderer}`}
                  context={loadedEditorSession.context}
                  initialFrameGuid={debugFrameGuid}
                  initialRenderer={editorRenderer}
                  captureFrameOnly={rendererDebugCaptureFrameOnly}
                />
              </div>
            ),
          },
        ]}
        value={mode}
        onChange={setMode}
        size="sm"
        style={tabsContainerStyle}
      />
    </div>
  );
}

// =============================================================================
// App
// =============================================================================

async function readLoadedFigFile(file: File): Promise<LoadedFigInput> {
  const buffer = await file.arrayBuffer();
  return {
    loaded: await loadFigFile(new Uint8Array(buffer)),
    fileName: file.name,
  };
}

function kiwiSourceDocumentFromLoaded(loaded: LoadedFigFile): FigDocumentContextKiwiSourceDocument {
  return {
    nodeChanges: loaded.nodeChanges,
    blobs: loaded.blobs,
    images: loaded.images,
  };
}

function createLoadedFileFromInputs(inputs: readonly LoadedFigInput[]): LoadedFile {
  const [primaryInput, ...sourceInputs] = inputs;
  if (primaryInput === undefined) {
    throw new Error("Fig Editor Dev requires a primary .fig file");
  }
  const primary = primaryInput.loaded;
  const sources = sourceInputs.map((input) => input.loaded);
  const context = createFigDocumentContextFromLoaded(primary, {
    kiwiSourceDocuments: sources.map(kiwiSourceDocumentFromLoaded),
  });
  return {
    context,
    fileName: primaryInput.fileName,
    sourceFileNames: sourceInputs.map((input) => input.fileName),
  };
}

function createLoadedEditorSession(loadedFile: LoadedFile): LoadedEditorSession {
  const publishedStore = createGlobalThisPublishedFigEditorStore({
    context: loadedFile.context,
  });
  return {
    ...loadedFile,
    store: publishedStore.store,
    dispose: publishedStore.dispose,
  };
}

async function readLoadedFileFromFiles(files: readonly File[]): Promise<LoadedFile> {
  const loadedInputs = await Promise.all(files.map(readLoadedFigFile));
  return createLoadedFileFromInputs(loadedInputs);
}

function formatLoadedFileName(loadedFile: LoadedFile): string {
  if (loadedFile.sourceFileNames.length === 0) {
    return loadedFile.fileName;
  }
  if (loadedFile.sourceFileNames.length === 1) {
    return `${loadedFile.fileName} (+1 source)`;
  }
  return `${loadedFile.fileName} (+${loadedFile.sourceFileNames.length} sources)`;
}

function parseDevModeParam(value: string | null): DevMode {
  if (value === null) {
    return "editor";
  }
  if (value === "editor" || value === "renderer-debug") {
    return value;
  }
  throw new Error(`Fig Editor Dev unsupported mode "${value}"`);
}

function parseRendererParam(value: string | null): FigEditorRendererKind {
  if (value === null) {
    return "svg";
  }
  if (value === "svg" || value === "webgl") {
    return value;
  }
  throw new Error(`Fig Editor Dev unsupported renderer "${value}"`);
}

function parseCaptureFrameOnlyParam(value: string | null): boolean {
  if (value === null) {
    return false;
  }
  if (value === "frame") {
    return true;
  }
  throw new Error(`Fig Editor Dev unsupported capture "${value}"`);
}

function readDevFileRoute(search: string): DevFileRoute | null {
  const params = new URLSearchParams(search);
  const figInput = readPrimaryRouteInput(params);
  if (figInput === null) {
    return null;
  }
  const frameGuid = params.get("frameGuid") ?? undefined;
  return {
    fig: figInput,
    sources: readSourceRouteInputs(params),
    mode: parseDevModeParam(params.get("mode")),
    renderer: parseRendererParam(params.get("renderer")),
    captureFrameOnly: parseCaptureFrameOnlyParam(params.get("capture")),
    ...(frameGuid === undefined ? {} : { frameGuid }),
  };
}

function requireSingleRouteValue(params: URLSearchParams, localName: string, urlName: string): DevFigRouteInput | null {
  const local = params.get(localName);
  const url = params.get(urlName);
  if (local !== null && url !== null) {
    throw new Error(`Fig Editor Dev route must not set both ${localName} and ${urlName}`);
  }
  if (local !== null) {
    return { ref: requireNonEmptyRouteRef(local, localName), kind: "local-path" };
  }
  if (url !== null) {
    return { ref: requireNonEmptyRouteRef(url, urlName), kind: "url" };
  }
  return null;
}

function requireNonEmptyRouteRef(value: string, name: string): string {
  if (value.length === 0) {
    throw new Error(`Fig Editor Dev route requires a non-empty ${name} parameter`);
  }
  return value;
}

function readPrimaryRouteInput(params: URLSearchParams): DevFigRouteInput | null {
  return requireSingleRouteValue(params, "fig", "figUrl");
}

function readSourceRouteInputs(params: URLSearchParams): readonly DevFigRouteInput[] {
  const sourcePaths = params.getAll("source").map((ref) => ({ ref, kind: "local-path" as const }));
  const sourceUrls = params.getAll("sourceUrl").map((ref) => ({ ref, kind: "url" as const }));
  const empty = [...sourcePaths, ...sourceUrls].find((source) => source.ref.length === 0);
  if (empty !== undefined) {
    throw new Error("Fig Editor Dev route source parameters must be non-empty");
  }
  return [...sourcePaths, ...sourceUrls];
}

function devServerFileUrl(input: DevFigRouteInput): string {
  if (input.kind === "url") {
    return input.ref;
  }
  const path = input.ref;
  if (path.startsWith("/@fs/")) {
    return path;
  }
  if (!path.startsWith("/")) {
    throw new Error(`Fig Editor Dev route requires an absolute local path, got "${path}"`);
  }
  return `/@fs${path.split("/").map(encodeURIComponent).join("/")}`;
}

function fileNameFromRouteInput(input: DevFigRouteInput): string {
  const last = input.ref.split("/").filter((segment) => segment.length > 0).at(-1);
  if (last === undefined) {
    throw new Error(`Fig Editor Dev route cannot derive file name from "${input.ref}"`);
  }
  return decodeURIComponent(last);
}

async function readLoadedFigFileFromRouteInput(input: DevFigRouteInput): Promise<LoadedFigInput> {
  const response = await fetch(devServerFileUrl(input));
  if (!response.ok) {
    throw new Error(`Fig Editor Dev failed to fetch "${input.ref}": ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  return {
    loaded: await loadFigFile(new Uint8Array(buffer)),
    fileName: fileNameFromRouteInput(input),
  };
}

async function readLoadedFileFromRoute(route: DevFileRoute): Promise<LoadedFile> {
  const inputs = await Promise.all([
    readLoadedFigFileFromRouteInput(route.fig),
    ...route.sources.map(readLoadedFigFileFromRouteInput),
  ]);
  return createLoadedFileFromInputs(inputs);
}

function App() {
  const loadedEditorSessionRef = useRef<LoadedEditorSession | null>(null);
  const [loadedEditorSession, setLoadedEditorSession] = useState<LoadedEditorSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<DevMode>("editor");
  const [inspectorOverlayEnabled, setInspectorOverlayEnabled] = useState(false);
  const [editorRenderer, setEditorRenderer] = useState<FigEditorRendererKind>("svg");
  const [debugFrameGuid, setDebugFrameGuid] = useState<string | undefined>(undefined);
  const [rendererDebugCaptureFrameOnly, setRendererDebugCaptureFrameOnly] = useState(false);

  const editorPanels = useMemo<EditorPanel[]>(
    () => [
      {
        id: "pages-layers",
        position: "left",
        content: <LeftPanelContent />,
        drawerLabel: "Pages & Layers",
        scrollable: false,
      },
      {
        id: "inspector-properties",
        position: "right",
        content: <RightPanelContent />,
        drawerLabel: "Inspector",
        scrollable: false,
      },
    ],
    [],
  );

  const replaceLoadedEditorSession = useCallback((nextLoadedFile: LoadedFile | null) => {
    const currentLoadedEditorSession = loadedEditorSessionRef.current;
    if (currentLoadedEditorSession !== null) {
      currentLoadedEditorSession.dispose();
    }
    const nextLoadedEditorSession = nextLoadedFile === null ? null : createLoadedEditorSession(nextLoadedFile);
    loadedEditorSessionRef.current = nextLoadedEditorSession;
    setLoadedEditorSession(nextLoadedEditorSession);
  }, []);

  const handleFiles = useCallback(async (files: readonly File[]) => {
    setIsLoading(true);
    setError(null);
    try {
      replaceLoadedEditorSession(await readLoadedFileFromFiles(files));
      setDebugFrameGuid(undefined);
      setRendererDebugCaptureFrameOnly(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to parse file";
      setError(message);
      replaceLoadedEditorSession(null);
    } finally {
      setIsLoading(false);
    }
  }, [replaceLoadedEditorSession]);

  const handleNewDocument = useCallback(() => {
    const context = createEmptyFigDocument("Page 1");
    replaceLoadedEditorSession({
      context,
      fileName: "Untitled.fig",
      sourceFileNames: [],
    });
    setError(null);
    setDebugFrameGuid(undefined);
    setRendererDebugCaptureFrameOnly(false);
  }, [replaceLoadedEditorSession]);

  const handleClose = useCallback(() => {
    replaceLoadedEditorSession(null);
    setError(null);
    setDebugFrameGuid(undefined);
    setRendererDebugCaptureFrameOnly(false);
  }, [replaceLoadedEditorSession]);

  useEffect(() => {
    return () => {
      replaceLoadedEditorSession(null);
    };
  }, [replaceLoadedEditorSession]);

  useEffect(() => {
    const cancellation = { cancelled: false };

    async function loadRouteFile(): Promise<void> {
      setIsLoading(true);
      setError(null);
      try {
        const route = readDevFileRoute(globalThis.location.search);
        if (route === null) {
          return;
        }
        const nextLoadedFile = await readLoadedFileFromRoute(route);
        if (cancellation.cancelled) {
          return;
        }
        setMode(route.mode);
        setEditorRenderer(route.renderer);
        setDebugFrameGuid(route.frameGuid);
        setRendererDebugCaptureFrameOnly(route.captureFrameOnly);
        replaceLoadedEditorSession(nextLoadedFile);
      } catch (e) {
        if (cancellation.cancelled) {
          return;
        }
        const message = e instanceof Error ? e.message : "Failed to parse routed file";
        setError(message);
        replaceLoadedEditorSession(null);
      } finally {
        if (!cancellation.cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadRouteFile();
    return () => {
      cancellation.cancelled = true;
    };
  }, [replaceLoadedEditorSession]);

  // No file loaded: show drop zone
  if (loadedEditorSession === null) {
    return (
      <div style={appStyle}>
        <header style={headerStyle}>
          <div style={headerLeftStyle}>
            <h1 style={titleStyle}>Fig Editor Dev</h1>
          </div>
          <div style={headerRightStyle}>
            <Button variant="secondary" size="sm" onClick={handleNewDocument}>
              New Document
            </Button>
          </div>
        </header>
        <main style={mainPaddedStyle}>
          <FileDropZone onFiles={handleFiles} isLoading={isLoading} />
          {error && <div style={errorStyle}>{error}</div>}
        </main>
      </div>
    );
  }

  return (
    <LoadedDevShell
      loadedEditorSession={loadedEditorSession}
      mode={mode}
      setMode={setMode}
      inspectorOverlayEnabled={inspectorOverlayEnabled}
      setInspectorOverlayEnabled={setInspectorOverlayEnabled}
      editorRenderer={editorRenderer}
      setEditorRenderer={setEditorRenderer}
      editorPanels={editorPanels}
      debugFrameGuid={debugFrameGuid}
      rendererDebugCaptureFrameOnly={rendererDebugCaptureFrameOnly}
      onClose={handleClose}
    />
  );
}

// =============================================================================
// Mount
// =============================================================================

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
