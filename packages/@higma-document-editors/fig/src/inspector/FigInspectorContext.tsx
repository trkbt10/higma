/**
 * @file React context for editor inspector hover state.
 */
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { FigGuid } from "@higma-document-models/fig/types";

export type FigInspectorContextValue = {
  readonly hoveredGuid: FigGuid | undefined;
  readonly setHoveredGuid: (guid: FigGuid | undefined) => void;
};

export type FigInspectorProviderProps = {
  readonly children: ReactNode;
};

const FigInspectorContext = createContext<FigInspectorContextValue | null>(null);

/**
 * Provide UI-only inspector state keyed by Kiwi GUIDs.
 */
export function FigInspectorProvider({ children }: FigInspectorProviderProps) {
  const [hoveredGuid, setHoveredGuid] = useState<FigGuid | undefined>(undefined);
  const value = useMemo<FigInspectorContextValue>(() => ({
    hoveredGuid,
    setHoveredGuid,
  }), [hoveredGuid]);

  return <FigInspectorContext.Provider value={value}>{children}</FigInspectorContext.Provider>;
}

/**
 * Read inspector state when an inspector provider is present.
 */
export function useFigInspectorContextOptional(): FigInspectorContextValue | null {
  return useContext(FigInspectorContext);
}
