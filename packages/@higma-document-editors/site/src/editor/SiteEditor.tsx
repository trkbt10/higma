/**
 * @file Top-level site editor component.
 */

import { useCallback, useMemo, useState } from "react";
import type { SiteDocument } from "@higma-document-models/site";
import type { SiteCmsFieldEdit } from "@higma-document-renderers/site";
import { CanvasArea, EditorShell, StackedEditorPanel, type EditorPanel } from "@higma-editor-surfaces/controls/editor-shell";
import { GalleryVerticalIcon, SettingsIcon, TableIcon } from "@higma-editor-kernel/ui/icons";

import { SiteEditorProvider, useSiteEditor } from "../context/SiteEditorContext";
import type { SiteEditorEditState } from "../context/SiteEditorContext";
import { createSiteEditorWorkspace } from "../site-editor-workspace";
import { SiteEditorCanvas } from "../canvas/SiteEditorCanvas";
import { SiteCmsCollectionView } from "../cms/SiteCmsCollectionView";
import { SiteCmsCollectionsPanel } from "../cms/SiteCmsCollectionsPanel";
import { SiteCmsProvider } from "../cms/SiteCmsContext";
import { SitePagesPanel } from "../panels/SitePagesPanel";
import { SitePropertiesPanel } from "../panels/SitePropertiesPanel";
import { SiteStructurePanel } from "../panels/SiteStructurePanel";
import { SiteEditorToolbar } from "./SiteEditorToolbar";
import { SiteEditorWorkspaceModeToggle, type SiteEditorWorkspaceMode } from "./SiteEditorWorkspaceModeToggle";

export type SiteEditorProps = {
  readonly initialDocument: SiteDocument;
  readonly panels?: EditorPanel[];
  readonly onEditStateChange?: (state: SiteEditorEditState) => void;
};

const canvasModePanels: EditorPanel[] = [
  {
    id: "site-structure",
    position: "left",
    content: (
      <StackedEditorPanel
        sections={[
          { id: "pages", content: <SitePagesPanel />, grow: false, scrollable: false },
          { id: "structure", content: <SiteStructurePanel />, grow: true, scrollable: true },
        ]}
      />
    ),
    drawerLabel: "Site structure",
    drawerIcon: GalleryVerticalIcon,
    scrollable: false,
  },
  {
    id: "site-properties",
    position: "right",
    content: <SitePropertiesPanel />,
    drawerLabel: "Site properties",
    drawerIcon: SettingsIcon,
    scrollable: false,
  },
];

const cmsModePanels: EditorPanel[] = [
  {
    id: "site-cms-collections",
    position: "left",
    content: <SiteCmsCollectionsPanel />,
    drawerLabel: "Collections",
    drawerIcon: TableIcon,
    scrollable: false,
  },
];

function renderWorkspaceForMode(mode: SiteEditorWorkspaceMode) {
  if (mode === "canvas") {
    return (
      <CanvasArea>
        <SiteEditorCanvas />
      </CanvasArea>
    );
  }
  return <SiteCmsCollectionView />;
}

function pickPanels(mode: SiteEditorWorkspaceMode, override?: EditorPanel[]): EditorPanel[] {
  if (override) {
    return override;
  }
  if (mode === "cms") {
    return cmsModePanels;
  }
  return canvasModePanels;
}

function SiteEditorContent({ panels }: { readonly panels?: EditorPanel[] }) {
  const [mode, setMode] = useState<SiteEditorWorkspaceMode>("canvas");
  const toolbar = useMemo(
    () => (
      <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
        <SiteEditorWorkspaceModeToggle value={mode} onChange={setMode} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <SiteEditorToolbar />
        </div>
      </div>
    ),
    [mode],
  );
  const resolvedPanels = pickPanels(mode, panels);

  return (
    <EditorShell toolbar={toolbar} panels={resolvedPanels}>
      {renderWorkspaceForMode(mode)}
    </EditorShell>
  );
}

function SiteCmsEditBridge({ children }: { readonly children: React.ReactNode }) {
  const { setCmsFieldEdits } = useSiteEditor();
  const handleFieldEditsChange = useCallback(
    (edits: readonly SiteCmsFieldEdit[]) => {
      setCmsFieldEdits(edits);
    },
    [setCmsFieldEdits],
  );
  return <SiteCmsProvider onFieldEditsChange={handleFieldEditsChange}>{children}</SiteCmsProvider>;
}

/** Full site document editor shell. */
export function SiteEditor({ initialDocument, panels, onEditStateChange }: SiteEditorProps) {
  const workspace = useMemo(() => createSiteEditorWorkspace(initialDocument), [initialDocument]);

  return (
    <SiteEditorProvider workspace={workspace} onEditStateChange={onEditStateChange}>
      <SiteCmsEditBridge>
        <div style={{ width: "100%", height: "100%" }}>
          <SiteEditorContent panels={panels} />
        </div>
      </SiteCmsEditBridge>
    </SiteEditorProvider>
  );
}
