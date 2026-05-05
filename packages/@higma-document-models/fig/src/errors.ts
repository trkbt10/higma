/**
 * @file Fig error classes
 */

/** Base error for fig operations */
export class FigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FigError";
  }
}

/** Error during parsing */
export class FigParseError extends FigError {
  constructor(
    message: string,
    public readonly offset?: number
  ) {
    super(offset !== undefined ? `${message} at offset ${offset}` : message);
    this.name = "FigParseError";
  }
}

/** Error during building */
export class FigBuildError extends FigError {
  constructor(message: string) {
    super(message);
    this.name = "FigBuildError";
  }
}

/** Error during decompression */
export class FigDecompressError extends FigError {
  constructor(
    message: string,
    public override readonly cause?: Error
  ) {
    super(cause ? `${message}: ${cause.message}` : message);
    this.name = "FigDecompressError";
  }
}
