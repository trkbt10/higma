/**
 * @file Table editor formatting types
 *
 * Generic table style band types used by TableStyleBandsEditor.
 */

export type TableStyleBands = {
  readonly headerRow?: boolean;
  readonly totalRow?: boolean;
  readonly firstColumn?: boolean;
  readonly lastColumn?: boolean;
  readonly bandedRows?: boolean;
  readonly bandedColumns?: boolean;
};

export type TableBandFeatures = {
  /** Show header row toggle. Default: true. */
  readonly showHeaderRow?: boolean;
  /** Show total row toggle. Default: true. */
  readonly showTotalRow?: boolean;
  /** Show first column toggle. Default: true. */
  readonly showFirstColumn?: boolean;
  /** Show last column toggle. Default: true. */
  readonly showLastColumn?: boolean;
  /** Show banded rows toggle. Default: true. */
  readonly showBandedRows?: boolean;
  /** Show banded columns toggle. Default: true. */
  readonly showBandedColumns?: boolean;
};
