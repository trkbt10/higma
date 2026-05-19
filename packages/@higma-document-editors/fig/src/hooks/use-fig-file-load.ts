/**
 * @file React hook for loading .fig bytes into a Kiwi document context.
 */
import { useCallback, useState } from "react";
import { createFigDocumentContext, type FigDocumentContext } from "@higma-document-io/fig";

export type UseFigFileLoadResult = {
  readonly loadFromBuffer: (buffer: Uint8Array) => Promise<FigDocumentContext>;
  readonly loadFromFile: (file: File) => Promise<FigDocumentContext>;
  readonly isLoading: boolean;
  readonly error: Error | null;
};

function errorFromUnknown(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

/**
 * Load .fig bytes through the document context factory used by renderers.
 */
export function useFigFileLoad(): UseFigFileLoadResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadFromBuffer = useCallback(async (buffer: Uint8Array): Promise<FigDocumentContext> => {
    setIsLoading(true);
    setError(null);
    try {
      return await createFigDocumentContext(buffer);
    } catch (caught: unknown) {
      const nextError = errorFromUnknown(caught);
      setError(nextError);
      throw nextError;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadFromFile = useCallback(async (file: File): Promise<FigDocumentContext> => {
    const buffer = new Uint8Array(await file.arrayBuffer());
    return loadFromBuffer(buffer);
  }, [loadFromBuffer]);

  return { loadFromBuffer, loadFromFile, isLoading, error };
}
