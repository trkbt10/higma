/**
 * @file Kiwi codec errors
 */

/** Base error for Kiwi codec operations. */
export class KiwiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KiwiError";
  }
}

/** Error during Kiwi binary parsing or encoding. */
export class KiwiParseError extends KiwiError {
  constructor(
    message: string,
    public readonly offset?: number,
  ) {
    super(offset !== undefined ? `${message} at offset ${offset}` : message);
    this.name = "KiwiParseError";
  }
}

/** Error during Kiwi binary construction. */
export class KiwiBuildError extends KiwiError {
  constructor(message: string) {
    super(message);
    this.name = "KiwiBuildError";
  }
}
