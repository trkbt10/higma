/**
 * @file Editor-kernel UI test browser API setup.
 */

import { installResizeObserverMock, resetResizeObserverMock } from "../../../../../spec/test-utils/resize-observer";

type DataTransferItemMap = Record<string, string>;

function createDataTransfer(this: DataTransfer & { readonly data: DataTransferItemMap }): void {
  Object.defineProperty(this, "data", { value: {}, configurable: true });
}

createDataTransfer.prototype.setData = function setData(this: { readonly data: DataTransferItemMap }, type: string, data: string): void {
  this.data[type] = data;
};

createDataTransfer.prototype.getData = function getData(this: { readonly data: DataTransferItemMap }, type: string): string {
  return this.data[type] ?? "";
};

createDataTransfer.prototype.clearData = function clearData(this: { readonly data: DataTransferItemMap }, type?: string): void {
  if (type) {
    delete this.data[type];
    return;
  }
  for (const key of Object.keys(this.data)) {
    delete this.data[key];
  }
};

Object.defineProperty(globalThis, "DataTransfer", { value: createDataTransfer, writable: true });

beforeEach(() => {
  installResizeObserverMock();
  resetResizeObserverMock();
});
