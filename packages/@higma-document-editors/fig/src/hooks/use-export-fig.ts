/**
 * @file React hook for exporting the current Kiwi document context.
 */
import { useCallback, useState } from "react";
import { exportFig, type FigExportOptions, type FigExportResult } from "@higma-document-io/fig";
import { useFigEditorSnapshotReader } from "../context/FigEditorContext";
import {
  downloadFigExport,
  resolveFigExportFilename,
  type DownloadEnvironment,
} from "./fig-export-download";

export type UseExportFigResult = {
  readonly exportContext: (options?: FigExportOptions) => Promise<FigExportResult>;
  readonly downloadContext: (environment: DownloadEnvironment, options?: FigExportOptions) => Promise<FigExportResult>;
  readonly isExporting: boolean;
  readonly lastResult: FigExportResult | null;
  readonly error: Error | null;
};

function errorFromUnknown(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

/**
 * Export the current editor context without introducing a view-model layer.
 */
export function useExportFig(): UseExportFigResult {
  const readEditorSnapshot = useFigEditorSnapshotReader();
  const [isExporting, setIsExporting] = useState(false);
  const [lastResult, setLastResult] = useState<FigExportResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const exportContext = useCallback(async (options?: FigExportOptions): Promise<FigExportResult> => {
    const context = readEditorSnapshot().context;
    setIsExporting(true);
    setError(null);
    try {
      const result = await exportFig(context, options);
      setLastResult(result);
      return result;
    } catch (caught: unknown) {
      const nextError = errorFromUnknown(caught);
      setError(nextError);
      throw nextError;
    } finally {
      setIsExporting(false);
    }
  }, [readEditorSnapshot]);

  const downloadContext = useCallback(async (
    environment: DownloadEnvironment,
    options?: FigExportOptions,
  ): Promise<FigExportResult> => {
    const context = readEditorSnapshot().context;
    const result = await exportContext(options);
    downloadFigExport(result, resolveFigExportFilename(context.metadata), environment);
    return result;
  }, [exportContext, readEditorSnapshot]);

  return { exportContext, downloadContext, isExporting, lastResult, error };
}
