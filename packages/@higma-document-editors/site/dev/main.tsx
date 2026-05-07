/**
 * @file Site editor development harness.
 */

import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import { createRoot } from "react-dom/client";
import type { SiteDocument } from "@higma-document-models/site";
import { injectCSSVariables } from "@higma-editor-kernel/ui/design-tokens";
import { Button } from "@higma-editor-kernel/ui/primitives/Button";

import { exportEditedSiteDocument, openSiteEditor, SiteEditor, type SiteEditorEditState } from "../src";

injectCSSVariables();

const pageStyle = {
  width: "100vw",
  height: "100vh",
  margin: 0,
  display: "grid",
  gridTemplateRows: "40px 1fr",
} as const;

const barStyle = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "0 12px",
  borderBottom: "1px solid rgba(0, 0, 0, 0.12)",
  background: "#ffffff",
  boxSizing: "border-box",
} as const;

const statusStyle = {
  color: "#5f6368",
  fontSize: 12,
} as const;

const errorStyle = {
  color: "#b3261e",
  fontSize: 12,
} as const;

const emptyStyle = {
  display: "grid",
  placeItems: "center",
  color: "#5f6368",
  background: "#f8f9fa",
  fontSize: 13,
} as const;

type LoadedSiteFile = {
  readonly name: string;
  readonly data: Uint8Array;
  readonly document: SiteDocument;
};

function readFileBytes(file: File): Promise<Uint8Array> {
  return file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function createEditedFileName(fileName: string): string {
  const suffix = ".site";
  if (fileName.endsWith(suffix)) {
    return `${fileName.slice(0, -suffix.length)}.edited${suffix}`;
  }
  return `${fileName}.edited${suffix}`;
}

function downloadBytes(fileName: string, data: Uint8Array): void {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function App() {
  const [loadedFile, setLoadedFile] = useState<LoadedSiteFile | null>(null);
  const [editState, setEditState] = useState<SiteEditorEditState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    if (!files) {
      return;
    }
    const file = files[0];
    if (!file) {
      return;
    }
    setErrorMessage(null);
    void readFileBytes(file).then((data) => {
      return openSiteEditor(data).then((workspace) => ({ data, workspace }));
    }).then(({ data, workspace }) => {
      setLoadedFile({ name: file.name, data, document: workspace.session.document });
      setEditState(null);
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    });
  }, []);

  const handleSave = useCallback(() => {
    if (!loadedFile) {
      return;
    }
    setErrorMessage(null);
    void exportEditedSiteDocument(loadedFile.data, {
      unitMoves: editState?.unitMoves ?? [],
      cmsFieldEdits: editState?.cmsFieldEdits ?? [],
    }).then((data) => {
      downloadBytes(createEditedFileName(loadedFile.name), data);
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    });
  }, [loadedFile, editState]);

  const status = useMemo(() => {
    if (!loadedFile) {
      return "No file loaded";
    }
    const unitCount = editState?.unitMoves.length ?? 0;
    const fieldCount = editState?.cmsFieldEdits.length ?? 0;
    return `${loadedFile.name} / ${unitCount} edited units / ${fieldCount} edited fields`;
  }, [loadedFile, editState]);

  const editorContent = renderEditorContent(loadedFile?.document ?? null, setEditState);

  return (
    <div style={pageStyle}>
      <div style={barStyle}>
        <input type="file" accept=".site,application/zip" onChange={handleFileChange} />
        <Button type="button" disabled={!loadedFile} onClick={handleSave} size="sm">Save edited .site</Button>
        <span style={statusStyle}>{status}</span>
        {errorMessage && <span role="alert" style={errorStyle}>{errorMessage}</span>}
      </div>
      {editorContent}
    </div>
  );
}

function renderEditorContent(
  documentModel: SiteDocument | null,
  onEditStateChange: (state: SiteEditorEditState) => void,
) {
  if (!documentModel) {
    return <div style={emptyStyle}>Open a .site file</div>;
  }
  return <SiteEditor initialDocument={documentModel} onEditStateChange={onEditStateChange} />;
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Site editor dev harness requires #root");
}

createRoot(rootElement).render(<App />);
