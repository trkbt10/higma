/**
 * @file Editor surface controls test browser API setup.
 */

type IntersectionObserverInitRecord = {
  readonly root?: Element | Document | null;
  readonly rootMargin?: string;
  readonly thresholds: readonly number[];
};

function normalizeThreshold(threshold: number | readonly number[] | undefined): readonly number[] {
  if (Array.isArray(threshold)) {
    return threshold;
  }
  if (typeof threshold === "number") {
    return [threshold];
  }
  return [0];
}

function createIntersectionObserver(
  this: IntersectionObserver & IntersectionObserverInitRecord,
  _callback: IntersectionObserverCallback,
  options: IntersectionObserverInit = {},
): void {
  Object.defineProperty(this, "root", { value: options.root ?? null });
  Object.defineProperty(this, "rootMargin", { value: options.rootMargin ?? "0px" });
  Object.defineProperty(this, "thresholds", { value: normalizeThreshold(options.threshold) });
}

createIntersectionObserver.prototype.observe = function observe(): void {};
createIntersectionObserver.prototype.unobserve = function unobserve(): void {};
createIntersectionObserver.prototype.disconnect = function disconnect(): void {};
createIntersectionObserver.prototype.takeRecords = function takeRecords(): IntersectionObserverEntry[] {
  return [];
};

Object.defineProperty(globalThis, "IntersectionObserver", { value: createIntersectionObserver, writable: true });
