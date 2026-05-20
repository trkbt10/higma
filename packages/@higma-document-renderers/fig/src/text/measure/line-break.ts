/**
 * @file Line breaking logic for text wrapping
 */
import type {
  LineMeasurement,
  WordSegment,
  LineBreakMode,
} from "./types";

function pushTextSegment(
  segments: WordSegment[],
  text: string,
  startIndex: number,
  endIndex: number,
  width: number,
  isWhitespace: boolean,
): void {
  if (endIndex <= startIndex) {
    return;
  }
  segments.push({
    text: text.slice(startIndex, endIndex),
    width,
    startIndex,
    endIndex,
    isWhitespace,
  });
}

function pushNewlineSegment(segments: WordSegment[], char: string, index: number): void {
  segments.push({
    text: char,
    width: 0,
    startIndex: index,
    endIndex: index + 1,
    isWhitespace: true,
  });
}

function isLineBreakChar(char: string): boolean {
  return char === "\n" || char === "\r";
}

/**
 * Segment text into words and whitespace
 */
export function segmentText(
  text: string,
  charWidths: readonly number[]
): readonly WordSegment[] {
  const segments: WordSegment[] = [];
  const currentStartRef = { value: 0 };
  const currentWidthRef2 = { value: 0 };
  const inWhitespaceRef = { value: false };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const isSpace = char === " " || char === "\t";
    if (isLineBreakChar(char)) {
      // Flush current segment
      pushTextSegment(segments, text, currentStartRef.value, i, currentWidthRef2.value, inWhitespaceRef.value);
      // Add newline as separate segment
      pushNewlineSegment(segments, char, i);
      currentStartRef.value = i + 1;
      currentWidthRef2.value = 0;
      inWhitespaceRef.value = false;
      continue;
    }
    if (isSpace !== inWhitespaceRef.value && i > currentStartRef.value) {
      // Transition between word and whitespace
      pushTextSegment(segments, text, currentStartRef.value, i, currentWidthRef2.value, inWhitespaceRef.value);
      currentStartRef.value = i;
      currentWidthRef2.value = charWidths[i];
      inWhitespaceRef.value = isSpace;
      continue;
    }
    currentWidthRef2.value += charWidths[i];
    if (i !== currentStartRef.value) {
      continue;
    }
    inWhitespaceRef.value = isSpace;
  }
  // Flush final segment
  pushTextSegment(segments, text, currentStartRef.value, text.length, currentWidthRef2.value, inWhitespaceRef.value);
  return segments;
}

function trimTrailingWhitespaceSegments(
  currentLineRef: { value: WordSegment[] },
  currentWidthRef: { value: number },
): void {
  while (
    currentLineRef.value.length > 0 &&
    currentLineRef.value[currentLineRef.value.length - 1].isWhitespace
  ) {
    const removed = currentLineRef.value.pop()!;
    currentWidthRef.value -= removed.width;
  }
}

function pushCurrentWordLine(
  lines: LineMeasurement[],
  currentLineRef: { value: WordSegment[] },
  currentWidthRef: { value: number },
): void {
  trimTrailingWhitespaceSegments(currentLineRef, currentWidthRef);
  if (currentLineRef.value.length === 0) {
    return;
  }
  const lineText = currentLineRef.value.map((s) => s.text).join("");
  lines.push({
    text: lineText,
    width: currentWidthRef.value,
    startIndex: currentLineRef.value[0].startIndex,
    endIndex: currentLineRef.value[currentLineRef.value.length - 1].endIndex,
  });
}

function pushExplicitWordBreakLine(
  lines: LineMeasurement[],
  currentLineRef: { value: WordSegment[] },
  currentWidthRef: { value: number },
  segment: WordSegment,
): void {
  const lineText = currentLineRef.value.map((s) => s.text).join("");
  if (currentLineRef.value.length > 0) {
    lines.push({
      text: lineText,
      width: currentWidthRef.value,
      startIndex: currentLineRef.value[0].startIndex,
      endIndex: segment.startIndex,
    });
    return;
  }
  if (lines.length > 0) {
    return;
  }
  lines.push({
    text: lineText,
    width: currentWidthRef.value,
    startIndex: segment.startIndex,
    endIndex: segment.startIndex,
  });
}

function startWordLineFromSegment(
  currentLineRef: { value: WordSegment[] },
  currentWidthRef: { value: number },
  segment: WordSegment,
): void {
  if (segment.isWhitespace) {
    currentLineRef.value = [];
    currentWidthRef.value = 0;
    return;
  }
  currentLineRef.value = [segment];
  currentWidthRef.value = segment.width;
}

function maxLinesReached(lines: readonly LineMeasurement[], maxLines: number): boolean {
  return maxLines > 0 && lines.length >= maxLines;
}

type LineBreakLoopAction = "continue" | "break";

function appendFittingWordSegment(
  segment: WordSegment,
  lines: readonly LineMeasurement[],
  currentLineRef: { value: WordSegment[] },
  currentWidthRef: { value: number },
  maxLines: number,
): boolean {
  currentLineRef.value.push(segment);
  currentWidthRef.value += segment.width;
  return maxLinesReached(lines, maxLines);
}

function startOverflowWordSegment(
  segment: WordSegment,
  lines: LineMeasurement[],
  currentLineRef: { value: WordSegment[] },
  currentWidthRef: { value: number },
  maxLines: number,
): boolean {
  if (currentLineRef.value.length > 0) {
    pushCurrentWordLine(lines, currentLineRef, currentWidthRef);
  }
  startWordLineFromSegment(currentLineRef, currentWidthRef, segment);
  return maxLinesReached(lines, maxLines);
}

function processWordSegment(
  segment: WordSegment,
  lines: LineMeasurement[],
  currentLineRef: { value: WordSegment[] },
  currentWidthRef: { value: number },
  maxWidth: number,
  maxLines: number,
): LineBreakLoopAction {
  if (isLineBreakChar(segment.text)) {
    pushExplicitWordBreakLine(lines, currentLineRef, currentWidthRef, segment);
    currentLineRef.value = [];
    currentWidthRef.value = 0;
    return "continue";
  }
  if (currentWidthRef.value + segment.width <= maxWidth) {
    return appendFittingWordSegment(segment, lines, currentLineRef, currentWidthRef, maxLines) ? "break" : "continue";
  }
  return startOverflowWordSegment(segment, lines, currentLineRef, currentWidthRef, maxLines) ? "break" : "continue";
}

/**
 * Break text into lines based on word boundaries
 */
export function breakLinesWord(
  { text, charWidths, maxWidth, maxLines = 0 }: { text: string; charWidths: readonly number[]; maxWidth: number; maxLines?: number; }
): readonly LineMeasurement[] {
  const segments = segmentText(text, charWidths);
  const lines: LineMeasurement[] = [];
  const currentLineRef = { value: [] as WordSegment[] };
  const currentWidthRef = { value: 0 };
  wordLoop:
  for (const segment of segments) {
    const action = processWordSegment(segment, lines, currentLineRef, currentWidthRef, maxWidth, maxLines);
    switch (action) {
      case "continue":
        continue wordLoop;
      case "break":
        break wordLoop;
    }
  }
  // Flush remaining content
  if (currentLineRef.value.length > 0 && (maxLines === 0 || lines.length < maxLines)) {
    pushCurrentWordLine(lines, currentLineRef, currentWidthRef);
  }
  // Handle empty text
  if (lines.length === 0) {
    lines.push({
      text: "",
      width: 0,
      startIndex: 0,
      endIndex: 0,
    });
  }
  return lines;
}

function pushCharacterLine(
  lines: LineMeasurement[],
  text: string,
  width: number,
  startIndex: number,
  endIndex: number,
): void {
  lines.push({
    text: text.slice(startIndex, endIndex),
    width,
    startIndex,
    endIndex,
  });
}

function resetCharacterLineAfterBreak(
  lineStartRef: { value: number },
  lineWidthRef: { value: number },
  index: number,
): void {
  lineStartRef.value = index + 1;
  lineWidthRef.value = 0;
}

function pushExplicitCharacterBreakLine(
  lines: LineMeasurement[],
  text: string,
  lineStartRef: { value: number },
  lineWidthRef: { value: number },
  index: number,
  maxLines: number,
): boolean {
  pushCharacterLine(lines, text, lineWidthRef.value, lineStartRef.value, index);
  resetCharacterLineAfterBreak(lineStartRef, lineWidthRef, index);
  return maxLinesReached(lines, maxLines);
}

function pushOverflowCharacterLine(
  lines: LineMeasurement[],
  text: string,
  lineStartRef: { value: number },
  lineWidthRef: { value: number },
  index: number,
  charWidth: number,
  maxLines: number,
): boolean {
  pushCharacterLine(lines, text, lineWidthRef.value, lineStartRef.value, index);
  lineStartRef.value = index;
  lineWidthRef.value = charWidth;
  return maxLinesReached(lines, maxLines);
}

function processCharacter(
  text: string,
  char: string,
  charWidth: number,
  index: number,
  lines: LineMeasurement[],
  lineStartRef: { value: number },
  lineWidthRef: { value: number },
  maxWidth: number,
  maxLines: number,
): LineBreakLoopAction {
  if (isLineBreakChar(char)) {
    return pushExplicitCharacterBreakLine(lines, text, lineStartRef, lineWidthRef, index, maxLines) ? "break" : "continue";
  }
  if (lineWidthRef.value + charWidth > maxWidth && lineWidthRef.value > 0) {
    return pushOverflowCharacterLine(lines, text, lineStartRef, lineWidthRef, index, charWidth, maxLines) ? "break" : "continue";
  }
  lineWidthRef.value += charWidth;
  return "continue";
}

/**
 * Break text into lines based on character boundaries
 */
export function breakLinesChar(
  { text, charWidths, maxWidth, maxLines = 0 }: { text: string; charWidths: readonly number[]; maxWidth: number; maxLines?: number; }
): readonly LineMeasurement[] {
  const lines: LineMeasurement[] = [];
  const lineStartRef = { value: 0 };
  const lineWidthRef = { value: 0 };
  charLoop:
  for (let i = 0; i < text.length; i++) {
    const action = processCharacter(text, text[i], charWidths[i], i, lines, lineStartRef, lineWidthRef, maxWidth, maxLines);
    switch (action) {
      case "continue":
        continue charLoop;
      case "break":
        break charLoop;
    }
  }
  // Flush remaining content
  if (lineStartRef.value < text.length && (maxLines === 0 || lines.length < maxLines)) {
    pushCharacterLine(lines, text, lineWidthRef.value, lineStartRef.value, text.length);
  }
  // Handle empty text
  if (lines.length === 0) {
    lines.push({
      text: "",
      width: 0,
      startIndex: 0,
      endIndex: 0,
    });
  }
  return lines;
}

/**
 * Break text into lines using auto mode (word first, then char)
 */
export function breakLinesAuto(
  { text, charWidths, maxWidth, maxLines = 0 }: { text: string; charWidths: readonly number[]; maxWidth: number; maxLines?: number; }
): readonly LineMeasurement[] {
  // First try word-based breaking
  const wordLines = breakLinesWord({ text, charWidths, maxWidth, maxLines });
  // Check if any word is wider than maxWidth
  const results: LineMeasurement[] = [];
  for (const line of wordLines) {
    if (line.width <= maxWidth) {
      results.push(line);
    } else {
      // Word is too long, break by character
      const lineCharWidths = charWidths.slice(line.startIndex, line.endIndex);
      const charLines = breakLinesChar({
        text: line.text,
        charWidths: lineCharWidths,
        maxWidth,
        maxLines: maxLines > 0 ? maxLines - results.length : 0,
      });
      // Adjust indices
      for (const charLine of charLines) {
        results.push({
          text: charLine.text,
          width: charLine.width,
          startIndex: line.startIndex + charLine.startIndex,
          endIndex: line.startIndex + charLine.endIndex,
        });
        if (maxLines > 0 && results.length >= maxLines) {
          break;
        }
      }
    }
    if (maxLines > 0 && results.length >= maxLines) {
      break;
    }
  }
  return results;
}
/**
 * Break text into lines
 */
export function breakLines(
  { text, charWidths, maxWidth, mode = "auto", maxLines = 0 }: { text: string; charWidths: readonly number[]; maxWidth: number; mode?: LineBreakMode; maxLines?: number; }
): readonly LineMeasurement[] {
  if (mode === "none" || !maxWidth || maxWidth <= 0) {
    // No line breaking, just split on explicit line breaks
    const lines: LineMeasurement[] = [];
    const textLines = text.split(/\r?\n/);
    const currentIndexRef = { value: 0 };
    for (const lineText of textLines) {
      const widthRef = { value: 0 };
      for (let i = 0; i < lineText.length; i++) {
        widthRef.value += charWidths[currentIndexRef.value + i];
      }
      lines.push({
        text: lineText,
        width: widthRef.value,
        startIndex: currentIndexRef.value,
        endIndex: currentIndexRef.value + lineText.length,
      });
      currentIndexRef.value += lineText.length + 1; // +1 for the newline
    }
    return lines;
  }
  switch (mode) {
    case "word":
      return breakLinesWord({ text, charWidths, maxWidth, maxLines });
    case "char":
      return breakLinesChar({ text, charWidths, maxWidth, maxLines });
    case "auto":
    default:
      return breakLinesAuto({ text, charWidths, maxWidth, maxLines });
  }
}
