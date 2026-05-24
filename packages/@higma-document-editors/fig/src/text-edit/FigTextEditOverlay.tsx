/** @file Inline text editing overlay for Kiwi TEXT nodes. */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useCanvasViewportRequired } from "@higma-editor-surfaces/controls/canvas";
import { TextEditInputFrame, useTextComposition } from "@higma-editor-surfaces/controls/text-edit";
import {
  coordinatesToCursorPosition,
  createInitialCompositionState,
  cursorPositionToCoordinates,
  cursorPositionToOffset,
  offsetToCursorPosition,
  selectionToRects,
  type CompositionState,
  type CursorCalculationContext,
  type LayoutSpanLike,
  type TextBodyLike,
  type TextSelection,
} from "@higma-editor-kernel/core/text-edit";
import { colorTokens } from "@higma-editor-kernel/ui/design-tokens";
import type { FigNode } from "@higma-document-models/fig/types";
import { derivedTextDataWithoutVisualPayload } from "@higma-document-models/fig/domain";
import {
  resolveTextLayout,
  textLayoutToCursorLayout,
  type ResolveTextContext,
  type TextFontResolver,
} from "@higma-document-renderers/fig/text";
import { FIG_NODE_MUTATION_SOURCE, useFigEditor } from "../context/FigEditorContext";

export type FigTextEditOverlayProps = {
  readonly node: FigNode;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly rotation: number;
  };
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly textFontResolver?: TextFontResolver;
  readonly textResolveContext?: Pick<ResolveTextContext, "styleRegistry">;
  readonly onExit: () => void;
};

const CARET_BLINK_KEYFRAMES = `
@keyframes _fig-caret-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}`;

const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "auto",
};

const svgOverlayStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: "100%",
  pointerEvents: "auto",
  overflow: "visible",
  zIndex: 2,
};

function readTextCharacters(node: FigNode): string {
  if (typeof node.textData?.characters === "string") {
    return node.textData.characters;
  }
  if (typeof node.characters === "string") {
    return node.characters;
  }
  throw new Error("FigTextEditOverlay requires Kiwi TEXT characters");
}

function writeTextCharacters(node: FigNode, characters: string): FigNode {
  const hasTextData = node.textData !== undefined;
  const hasRootCharacters = typeof node.characters === "string";
  if (!hasTextData && !hasRootCharacters) {
    throw new Error("FigTextEditOverlay cannot update a TEXT node without characters storage");
  }
  return {
    ...node,
    characters: hasRootCharacters ? characters : node.characters,
    textData: hasTextData ? { ...node.textData, characters } : node.textData,
    derivedTextData: derivedTextDataWithoutVisualPayload(node.derivedTextData),
  };
}

function buildTextBodyFromCharacters(characters: string): TextBodyLike {
  return {
    paragraphs: characters.split("\n").map((line) => ({
      runs: [{ type: "regular", text: line }],
    })),
  };
}

function buildFigCursorContext(
  fontSize: number,
  ascenderRatio: number,
): CursorCalculationContext {
  return {
    measureSpanTextWidth: (span: LayoutSpanLike, substring: string): number => {
      if (span.text.length === 0 || substring.length === 0) {
        return 0;
      }
      return measureResolvedSpanPrefixWidth(span, substring.length);
    },
    getAscenderRatio: () => ascenderRatio,
    ptToPx: 1,
    emptyLineFontSizePt: fontSize,
  };
}

function measureResolvedSpanPrefixWidth(span: LayoutSpanLike, charCount: number): number {
  if (charCount >= span.text.length) {
    return span.width;
  }
  const charWidths = readResolvedSpanCharWidths(span);
  return charWidths.slice(0, charCount).reduce((sum, width) => sum + width, 0);
}

function readResolvedSpanCharWidths(span: LayoutSpanLike): readonly number[] {
  if (!("charWidths" in span) || !isNumberArray(span.charWidths)) {
    throw new Error("FigTextEditOverlay requires renderer-resolved character widths for cursor measurement");
  }
  return span.charWidths;
}

function isNumberArray(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function isInsideBounds(
  point: { readonly pageX: number; readonly pageY: number },
  bounds: FigTextEditOverlayProps["bounds"],
): boolean {
  return point.pageX >= bounds.x
    && point.pageX <= bounds.x + bounds.width
    && point.pageY >= bounds.y
    && point.pageY <= bounds.y + bounds.height;
}

/** Render a hidden textarea and cursor chrome over the active Kiwi TEXT node. */
export function FigTextEditOverlay({
  node,
  bounds,
  canvasWidth,
  canvasHeight,
  textFontResolver,
  textResolveContext,
  onExit,
}: FigTextEditOverlayProps) {
  const { updateNode } = useFigEditor();
  const { screenToPage } = useCanvasViewportRequired();
  if (node.guid === undefined) {
    throw new Error("FigTextEditOverlay requires a Kiwi node guid");
  }
  const guid = node.guid;
  const currentText = readTextCharacters(node);
  const initialTextLengthRef = useRef(currentText.length);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const textLayoutResolution = useMemo(
    () => resolveTextLayout(node, {
      fontResolver: textFontResolver,
      styleRegistry: textResolveContext?.styleRegistry,
    }),
    [node, textFontResolver, textResolveContext?.styleRegistry],
  );
  const textLayout = textLayoutResolution.layout;
  const cursorLayout = useMemo(
    () => textLayoutToCursorLayout(textLayout),
    [textLayout],
  );
  const textBody = useMemo(() => buildTextBodyFromCharacters(currentText), [currentText]);
  const cursorContext = useMemo(
    () => buildFigCursorContext(textLayoutResolution.displayProps.fontSize, textLayout.ascenderRatio),
    [textLayout.ascenderRatio, textLayoutResolution.displayProps.fontSize],
  );
  const [selectionRange, setSelectionRange] = useState({ start: currentText.length, end: currentText.length });

  const updateSelection = useCallback((): void => {
    const textarea = textareaRef.current;
    if (textarea === null) {
      return;
    }
    setSelectionRange({ start: textarea.selectionStart, end: textarea.selectionEnd });
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) {
      throw new Error("FigTextEditOverlay mounted without a textarea");
    }
    const end = initialTextLengthRef.current;
    textarea.focus();
    textarea.setSelectionRange(end, end);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) {
      throw new Error("FigTextEditOverlay blur guard mounted without a textarea");
    }
    const frame = { id: null as number | null };
    const handleBlur = (): void => {
      frame.id = requestAnimationFrame(() => {
        if (document.activeElement !== textarea) {
          onExit();
        }
        frame.id = null;
      });
    };
    textarea.addEventListener("blur", handleBlur);
    return () => {
      textarea.removeEventListener("blur", handleBlur);
      if (frame.id !== null) {
        cancelAnimationFrame(frame.id);
      }
    };
  }, [onExit]);

  const caretPosition = useMemo(() => {
    const position = offsetToCursorPosition(textBody, selectionRange.end);
    return cursorPositionToCoordinates(position, cursorLayout, cursorContext);
  }, [cursorContext, cursorLayout, selectionRange.end, textBody]);

  const selectionRects = useMemo(() => {
    if (selectionRange.start === selectionRange.end) {
      return [];
    }
    const startPosition = offsetToCursorPosition(textBody, selectionRange.start);
    const endPosition = offsetToCursorPosition(textBody, selectionRange.end);
    const selection: TextSelection = { start: startPosition, end: endPosition };
    return selectionToRects(selection, cursorLayout, cursorContext);
  }, [cursorContext, cursorLayout, selectionRange, textBody]);

  const handleChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>): void => {
    const nextText = event.currentTarget.value;
    updateNode(guid, (current) => writeTextCharacters(current, nextText), FIG_NODE_MUTATION_SOURCE.textEdit);
    requestAnimationFrame(updateSelection);
  }, [guid, updateNode, updateSelection]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onExit();
      return;
    }
    requestAnimationFrame(updateSelection);
  }, [onExit, updateSelection]);

  const initialComposition = useMemo(() => createInitialCompositionState(), []);
  const [, setComposition] = useState<CompositionState>(initialComposition);
  const {
    handleCompositionStart,
    handleCompositionUpdate,
    handleCompositionEnd,
  } = useTextComposition({ setComposition, initialCompositionState: initialComposition });

  const handleOverlayPointerDown = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    const page = screenToPage(event.clientX, event.clientY);
    if (page === undefined) {
      return;
    }
    if (!isInsideBounds(page, bounds)) {
      onExit();
    }
  }, [bounds, onExit, screenToPage]);

  const screenToCharOffset = useCallback((clientX: number, clientY: number): number | null => {
    const svg = svgRef.current;
    if (svg === null) {
      return null;
    }
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const matrix = svg.getScreenCTM();
    if (matrix === null) {
      return null;
    }
    const svgPoint = point.matrixTransform(matrix.inverse());
    const cursorPosition = coordinatesToCursorPosition({
      layoutResult: cursorLayout,
      x: svgPoint.x,
      y: svgPoint.y,
      ctx: cursorContext,
    });
    return cursorPositionToOffset(textBody, cursorPosition);
  }, [cursorContext, cursorLayout, textBody]);

  const dragAnchorRef = useRef<number | null>(null);

  const handleSvgPointerDown = useCallback((event: PointerEvent<SVGSVGElement>): void => {
    event.stopPropagation();
    event.preventDefault();
    const textarea = textareaRef.current;
    if (textarea === null) {
      return;
    }
    const offset = screenToCharOffset(event.clientX, event.clientY);
    if (offset !== null) {
      dragAnchorRef.current = offset;
      textarea.setSelectionRange(offset, offset);
      setSelectionRange({ start: offset, end: offset });
    }
    textarea.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [screenToCharOffset]);

  const handleSvgPointerMove = useCallback((event: PointerEvent<SVGSVGElement>): void => {
    const anchor = dragAnchorRef.current;
    if (anchor === null) {
      return;
    }
    event.preventDefault();
    const textarea = textareaRef.current;
    if (textarea === null) {
      return;
    }
    const offset = screenToCharOffset(event.clientX, event.clientY);
    if (offset === null) {
      return;
    }
    const start = Math.min(anchor, offset);
    const end = Math.max(anchor, offset);
    textarea.setSelectionRange(start, end);
    setSelectionRange({ start, end });
  }, [screenToCharOffset]);

  const handleSvgPointerUp = useCallback((event: PointerEvent<SVGSVGElement>): void => {
    dragAnchorRef.current = null;
    event.preventDefault();
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const hasRange = selectionRange.start !== selectionRange.end;

  return (
    <div style={overlayStyle} onPointerDown={handleOverlayPointerDown}>
      <TextEditInputFrame
        bounds={bounds}
        canvasWidth={canvasWidth}
        canvasHeight={canvasHeight}
        textareaRef={textareaRef}
        value={currentText}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={updateSelection}
        onCompositionStart={handleCompositionStart}
        onCompositionUpdate={handleCompositionUpdate}
        onCompositionEnd={handleCompositionEnd}
        showFrameOutline
        showTextSelection={false}
      >
        <svg
          ref={svgRef}
          style={svgOverlayStyle}
          viewBox={`0 0 ${bounds.width} ${bounds.height}`}
          preserveAspectRatio="xMinYMin meet"
          onPointerDown={handleSvgPointerDown}
          onPointerMove={handleSvgPointerMove}
          onPointerUp={handleSvgPointerUp}
        >
          <style>{CARET_BLINK_KEYFRAMES}</style>
          {selectionRects.map((rect) => (
            <rect
              key={`${rect.x}:${rect.y}:${rect.width}:${rect.height}`}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              fill={colorTokens.selection.primary}
              fillOpacity={0.3}
            />
          ))}
          {caretPosition && (
            <line
              x1={caretPosition.x}
              y1={caretPosition.y}
              x2={caretPosition.x}
              y2={caretPosition.y + caretPosition.height}
              stroke={colorTokens.selection.primary}
              strokeWidth={2}
              style={{ animation: hasRange ? "none" : "_fig-caret-blink 1s step-end infinite" }}
            />
          )}
        </svg>
      </TextEditInputFrame>
    </div>
  );
}
