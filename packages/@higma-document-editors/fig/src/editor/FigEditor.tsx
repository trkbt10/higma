/**
 * @file Public Fig editor composition entry.
 */
import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { TextFontResolver } from "@higma-document-renderers/fig/text";
import {
  CanvasArea,
  EditorShell,
  StackedEditorPanel,
  type EditorPanel,
} from "@higma-editor-surfaces/controls/editor-shell";
import { FigEditorCanvas } from "../canvas/FigEditorCanvas";
import type { FigEditorRendererKind } from "../canvas/rendering/renderer-kind";
import {
  FigEditorStoreProvider,
  type FigEditorStore,
} from "../context/FigEditorContext";
import { FigEditorToolbar } from "./FigEditorToolbar";
import { PageListPanel } from "../panels/pages/PageListPanel";
import { LayerPanel } from "../panels/layers/LayerPanel";
import { PropertyPanel } from "../panels/properties/PropertyPanel";

type FigEditorShellProps = {
  readonly renderer?: FigEditorRendererKind;
  readonly textFontResolver?: TextFontResolver;
  readonly children?: ReactNode;
  readonly style?: CSSProperties;
  readonly panels?: EditorPanel[];
};

export type FigEditorProps = FigEditorShellProps & {
  readonly store: FigEditorStore;
};

function LeftPanelContent() {
  return (
    <StackedEditorPanel
      sections={[
        { id: "pages", content: <PageListPanel />, grow: false, scrollable: false },
        { id: "layers", content: <LayerPanel />, grow: true, scrollable: true },
      ]}
    />
  );
}

const defaultPanels: EditorPanel[] = [
  {
    id: "pages-layers",
    position: "left",
    content: <LeftPanelContent />,
    drawerLabel: "Pages & Layers",
    scrollable: false,
  },
  {
    id: "properties",
    position: "right",
    content: <PropertyPanel />,
    drawerLabel: "Properties",
    scrollable: true,
  },
];

function FigEditorContent({
  renderer,
  textFontResolver,
  children,
  panels,
}: {
  readonly renderer?: FigEditorRendererKind;
  readonly textFontResolver?: TextFontResolver;
  readonly children?: ReactNode;
  readonly panels?: EditorPanel[];
}) {
  const toolbar = useMemo(() => <FigEditorToolbar />, []);
  const resolvedPanels = panels ?? defaultPanels;
  return (
    <EditorShell toolbar={toolbar} panels={resolvedPanels}>
      <CanvasArea>
        <FigEditorCanvas renderer={renderer} textFontResolver={textFontResolver}>
          {children}
        </FigEditorCanvas>
      </CanvasArea>
    </EditorShell>
  );
}

/**
 * Full Kiwi-backed Fig editor shell.
 */
export function FigEditor({
  renderer,
  textFontResolver,
  children,
  style,
  panels,
  store,
}: FigEditorProps) {
  const content = (
    <div style={{ width: "100%", height: "100%", ...style }}>
      <FigEditorContent renderer={renderer} textFontResolver={textFontResolver} panels={panels}>
        {children}
      </FigEditorContent>
    </div>
  );
  return (
    <FigEditorStoreProvider store={store}>
      {content}
    </FigEditorStoreProvider>
  );
}
