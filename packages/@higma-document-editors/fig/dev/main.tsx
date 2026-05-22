/**
 * @file Dev entry point for fig-editor.
 *
 * Two modes:
 * - Editor: Full FigEditor with .fig file
 * - Renderer Debug: SVG/WebGL renderer switching + inspector overlay
 *
 * Both modes share the same .fig file loading pipeline.
 */

import { useMemo, useState, useCallback, type CSSProperties } from "react";
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
        defaultValue="inspector"
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
  loadedFile,
  mode,
  setMode,
  inspectorOverlayEnabled,
  setInspectorOverlayEnabled,
  editorRenderer,
  setEditorRenderer,
  editorPanels,
  onClose,
}: {
  readonly loadedFile: LoadedFile;
  readonly mode: DevMode;
  readonly setMode: (mode: DevMode) => void;
  readonly inspectorOverlayEnabled: boolean;
  readonly setInspectorOverlayEnabled: (enabled: boolean) => void;
  readonly editorRenderer: FigEditorRendererKind;
  readonly setEditorRenderer: (renderer: FigEditorRendererKind) => void;
  readonly editorPanels: EditorPanel[];
  readonly onClose: () => void;
}) {
  const fontResolverState = useBrowserTextFontResolver(loadedFile.context);
  return (
    <div style={appStyle}>
      <header style={headerStyle}>
        <div style={headerLeftStyle}>
          <h1 style={titleStyle}>Fig Editor Dev</h1>
          <span style={fileNameStyle}>{formatLoadedFileName(loadedFile)}</span>
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
                    context={loadedFile.context}
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
                <RendererDebugView context={loadedFile.context} />
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

type LoadedFigFile = Awaited<ReturnType<typeof loadFigFile>>;

async function readLoadedFigFile(file: File): Promise<LoadedFigFile> {
  const buffer = await file.arrayBuffer();
  return loadFigFile(new Uint8Array(buffer));
}

function kiwiSourceDocumentFromLoaded(loaded: LoadedFigFile): FigDocumentContextKiwiSourceDocument {
  return {
    nodeChanges: loaded.nodeChanges,
    blobs: loaded.blobs,
    images: loaded.images,
  };
}

async function createLoadedFile(files: readonly File[]): Promise<LoadedFile> {
  const [primaryFile, ...sourceFiles] = files;
  if (primaryFile === undefined) {
    throw new Error("Fig Editor Dev requires a primary .fig file");
  }
  const primary = await readLoadedFigFile(primaryFile);
  const sources = await Promise.all(sourceFiles.map(readLoadedFigFile));
  const context = createFigDocumentContextFromLoaded(primary, {
    kiwiSourceDocuments: sources.map(kiwiSourceDocumentFromLoaded),
  });
  return {
    context,
    fileName: primaryFile.name,
    sourceFileNames: sourceFiles.map((file) => file.name),
  };
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

function App() {
  const [loadedFile, setLoadedFile] = useState<LoadedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<DevMode>("editor");
  const [inspectorOverlayEnabled, setInspectorOverlayEnabled] = useState(false);
  const [editorRenderer, setEditorRenderer] = useState<FigEditorRendererKind>("svg");

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

  const handleFiles = useCallback(async (files: readonly File[]) => {
    setIsLoading(true);
    setError(null);
    try {
      setLoadedFile(await createLoadedFile(files));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to parse file";
      setError(message);
      setLoadedFile(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleNewDocument = useCallback(() => {
    const context = createEmptyFigDocument("Page 1");
    setLoadedFile({ context, fileName: "Untitled.fig", sourceFileNames: [] });
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    setLoadedFile(null);
    setError(null);
  }, []);

  // No file loaded: show drop zone
  if (!loadedFile) {
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
      loadedFile={loadedFile}
      mode={mode}
      setMode={setMode}
      inspectorOverlayEnabled={inspectorOverlayEnabled}
      setInspectorOverlayEnabled={setInspectorOverlayEnabled}
      editorRenderer={editorRenderer}
      setEditorRenderer={setEditorRenderer}
      editorPanels={editorPanels}
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
