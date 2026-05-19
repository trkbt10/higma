/**
 * @file Public Fig editor composition entry.
 */
import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { FigDocumentContext } from "@higma-document-io/fig";
import type { TextFontResolver } from "@higma-document-renderers/fig/text";
import {
  CanvasArea,
  EditorShell,
  StackedEditorPanel,
  type EditorPanel,
} from "@higma-editor-surfaces/controls/editor-shell";
import { FigEditorCanvas } from "../canvas/FigEditorCanvas";
import type { FigEditorRendererKind } from "../canvas/rendering/renderer-kind";
import { FigEditorProvider } from "../context/FigEditorContext";
import { FigEditorToolbar } from "./FigEditorToolbar";
import { PageListPanel } from "../panels/pages/PageListPanel";
import { LayerPanel } from "../panels/layers/LayerPanel";
import { PropertyPanel } from "../panels/properties/PropertyPanel";

export type FigEditorProps = {
  readonly context: FigDocumentContext;
  readonly renderer?: FigEditorRendererKind;
  readonly textFontResolver?: TextFontResolver;
  readonly children?: ReactNode;
  readonly style?: CSSProperties;
  readonly panels?: EditorPanel[];
  readonly onContextChange?: (context: FigDocumentContext) => void;
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
  context,
  renderer,
  textFontResolver,
  children,
  style,
  panels,
  onContextChange,
}: FigEditorProps) {
  return (
    <FigEditorProvider context={context} onContextChange={onContextChange}>
      <div style={{ width: "100%", height: "100%", ...style }}>
        <FigEditorContent renderer={renderer} textFontResolver={textFontResolver} panels={panels}>
          {children}
        </FigEditorContent>
      </div>
    </FigEditorProvider>
  );
}
