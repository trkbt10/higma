/**
 * @file Top-level site editor component.
 */

import { useMemo, useState } from "react";
import type { SiteDocument } from "@higma-document-models/site";
import { CanvasArea, EditorShell, StackedEditorPanel, type EditorPanel } from "@higma-editor-surfaces/controls/editor-shell";
import { GalleryVerticalIcon, SettingsIcon } from "@higma-editor-kernel/ui/icons";

import { SiteEditorProvider } from "../context/SiteEditorContext";
import type { SiteEditorEditState } from "../context/SiteEditorContext";
import { createSiteEditorWorkspace } from "../site-editor-workspace";
import { SiteEditorCanvas } from "../canvas/SiteEditorCanvas";
import { SiteCmsWorkspace } from "../cms/SiteCmsWorkspace";
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

const defaultPanels: EditorPanel[] = [
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

function renderWorkspaceForMode(mode: SiteEditorWorkspaceMode) {
  if (mode === "canvas") {
    return (
      <CanvasArea>
        <SiteEditorCanvas />
      </CanvasArea>
    );
  }
  return <SiteCmsWorkspace />;
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
  const resolvedPanels = panels ?? defaultPanels;

  return (
    <EditorShell toolbar={toolbar} panels={resolvedPanels}>
      {renderWorkspaceForMode(mode)}
    </EditorShell>
  );
}

/** Full site document editor shell. */
export function SiteEditor({ initialDocument, panels, onEditStateChange }: SiteEditorProps) {
  const workspace = useMemo(() => createSiteEditorWorkspace(initialDocument), [initialDocument]);

  return (
    <SiteEditorProvider workspace={workspace} onEditStateChange={onEditStateChange}>
      <div style={{ width: "100%", height: "100%" }}>
        <SiteEditorContent panels={panels} />
      </div>
    </SiteEditorProvider>
  );
}
