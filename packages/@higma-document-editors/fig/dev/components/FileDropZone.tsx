/**
 * @file Drag and drop file upload component for .fig files
 */
/* eslint-disable jsdoc/require-jsdoc -- Dev-only component API is intentionally small and local to the fig-editor harness. */

import { useState, useCallback, useRef, type DragEvent, type ChangeEvent, type CSSProperties } from "react";
import { Button, Select, colorTokens, spacingTokens, fontTokens, radiusTokens } from "@higma-editor-kernel/ui";

type Props = {
  readonly onFiles: (files: readonly File[]) => void;
  readonly isLoading?: boolean;
};

type PendingFileSelection = {
  readonly files: readonly File[];
  readonly primaryIndex: string;
};

// =============================================================================
// Styles (layout + design tokens)
// =============================================================================

const containerStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: spacingTokens.lg,
};

const dropZoneBaseStyle: CSSProperties = {
  width: "100%",
  maxWidth: "600px",
  minHeight: "300px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: spacingTokens.md,
  padding: spacingTokens.xl,
  borderWidth: "2px",
  borderStyle: "dashed",
  borderColor: colorTokens.border.strong,
  borderRadius: radiusTokens.lg,
  backgroundColor: colorTokens.background.tertiary,
  cursor: "pointer",
  transition: "all 0.2s ease",
};

const dropZoneDraggingOverride: CSSProperties = {
  borderColor: colorTokens.accent.primary,
  backgroundColor: `color-mix(in srgb, ${colorTokens.accent.primary} 8%, ${colorTokens.background.tertiary})`,
};

const dropZoneLoadingOverride: CSSProperties = {
  borderColor: colorTokens.accent.primary,
  backgroundColor: `color-mix(in srgb, ${colorTokens.accent.primary} 4%, ${colorTokens.background.tertiary})`,
  cursor: "wait",
};

const iconStyle: CSSProperties = {
  fontSize: "48px",
  opacity: 0.5,
};

const dropTitleStyle: CSSProperties = {
  fontSize: fontTokens.size.xl,
  fontWeight: fontTokens.weight.medium,
  color: colorTokens.text.primary,
};

const subtitleStyle: CSSProperties = {
  fontSize: fontTokens.size.md,
  color: colorTokens.text.secondary,
};

const pendingPanelStyle: CSSProperties = {
  width: "100%",
  maxWidth: "600px",
  display: "flex",
  flexDirection: "column",
  gap: spacingTokens.sm,
  padding: spacingTokens.md,
  border: `1px solid ${colorTokens.border.subtle}`,
  borderRadius: radiusTokens.md,
  backgroundColor: colorTokens.background.secondary,
};

const pendingActionRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: spacingTokens.sm,
};

const inputStyle: CSSProperties = {
  display: "none",
};

const spinnerStyle: CSSProperties = {
  width: "40px",
  height: "40px",
  border: `3px solid color-mix(in srgb, ${colorTokens.accent.primary} 30%, transparent)`,
  borderTopColor: colorTokens.accent.primary,
  borderRadius: "50%",
  animation: "spin 1s linear infinite",
};

function resolveDropZoneStateStyle({ isLoading, isDragging }: { readonly isLoading?: boolean; readonly isDragging: boolean }): CSSProperties {
  if (isLoading) {
    return dropZoneLoadingOverride;
  }
  if (isDragging) {
    return dropZoneDraggingOverride;
  }
  return {};
}

function renderDropZoneContent({ isLoading, isDragging }: { readonly isLoading?: boolean; readonly isDragging: boolean }) {
  if (isLoading) {
    return (
      <>
        <div style={spinnerStyle} />
        <div style={dropTitleStyle}>Parsing file...</div>
      </>
    );
  }
  return (
    <>
      <div style={iconStyle}>📁</div>
      <div style={dropTitleStyle}>
        {isDragging ? "Drop your .fig file here" : "Drag & drop .fig files"}
      </div>
      <div style={subtitleStyle}>or click to browse</div>
    </>
  );
}

function figFilesFromList(files: FileList | null): readonly File[] {
  if (files === null) {
    return [];
  }
  return Array.from(files).filter((file) => file.name.endsWith(".fig"));
}

function pendingFileOptions(files: readonly File[]): readonly { readonly value: string; readonly label: string }[] {
  return files.map((file, index) => ({
    value: String(index),
    label: file.name,
  }));
}

function requirePrimaryFileIndex(selection: PendingFileSelection): number {
  const index = Number(selection.primaryIndex);
  if (!Number.isInteger(index) || index < 0 || index >= selection.files.length) {
    throw new Error("FileDropZone requires a selected primary .fig file");
  }
  return index;
}

function orderedFilesFromPending(selection: PendingFileSelection): readonly File[] {
  const primaryIndex = requirePrimaryFileIndex(selection);
  const primary = selection.files[primaryIndex];
  if (primary === undefined) {
    throw new Error("FileDropZone selected primary .fig file is missing");
  }
  return [
    primary,
    ...selection.files.filter((_file, index) => index !== primaryIndex),
  ];
}

function sourceFileCountLabel(count: number): string {
  if (count === 1) {
    return "1 source .fig file";
  }
  return `${count} source .fig files`;
}

export function FileDropZone({ onFiles, isLoading }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<PendingFileSelection | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptFigFiles = useCallback((files: readonly File[]): void => {
    if (files.length === 0) {
      return;
    }
    if (files.length === 1) {
      onFiles(files);
      return;
    }
    setPendingSelection({ files, primaryIndex: "0" });
  }, [onFiles]);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (isLoading) {
        return;
      }
      const files = figFilesFromList(e.dataTransfer.files);
      acceptFigFiles(files);
    },
    [acceptFigFiles, isLoading],
  );

  const handleClick = useCallback(() => {
    if (!isLoading && inputRef.current) {
      inputRef.current.click();
    }
  }, [isLoading]);

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      const figFiles = figFilesFromList(files);
      acceptFigFiles(figFiles);
      e.target.value = "";
    },
    [acceptFigFiles],
  );

  const confirmPendingSelection = useCallback((): void => {
    if (pendingSelection === null) {
      throw new Error("FileDropZone cannot confirm without pending .fig files");
    }
    onFiles(orderedFilesFromPending(pendingSelection));
    setPendingSelection(null);
  }, [onFiles, pendingSelection]);

  const clearPendingSelection = useCallback((): void => {
    setPendingSelection(null);
  }, []);

  const dropZoneStyle: CSSProperties = {
    ...dropZoneBaseStyle,
    ...resolveDropZoneStateStyle({ isLoading, isDragging }),
  };

  return (
    <div style={containerStyle}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div
        style={dropZoneStyle}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        {renderDropZoneContent({ isLoading, isDragging })}
      </div>
      <input ref={inputRef} type="file" accept=".fig" multiple style={inputStyle} onChange={handleInputChange} />
      {pendingSelection !== null && (
        <div style={pendingPanelStyle}>
          <div style={dropTitleStyle}>Primary .fig</div>
          <Select
            value={pendingSelection.primaryIndex}
            onChange={(primaryIndex) => setPendingSelection({ ...pendingSelection, primaryIndex })}
            options={pendingFileOptions(pendingSelection.files)}
            ariaLabel="Primary .fig file"
          />
          <div style={subtitleStyle}>
            {sourceFileCountLabel(pendingSelection.files.length - 1)}
          </div>
          <div style={pendingActionRowStyle}>
            <Button variant="ghost" size="sm" onClick={clearPendingSelection}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={confirmPendingSelection}>Open</Button>
          </div>
        </div>
      )}
    </div>
  );
}
