# spec/test-utils

Test utilities shared across specs.

## ResizeObserver Mock

Mock `ResizeObserver` for tests that need to simulate resize events.

```typescript
import {
  installResizeObserverMock,
  resetResizeObserverMock,
  restoreResizeObserverMock,
  triggerResizeObservers,
} from "spec/test-utils/resize-observer";

beforeAll(() => {
  installResizeObserverMock();
});

afterEach(() => {
  resetResizeObserverMock();
});

afterAll(() => {
  restoreResizeObserverMock();
});

it("responds to resize", () => {
  // ... setup component that uses ResizeObserver ...
  
  triggerResizeObservers([
    { contentRect: { width: 200, height: 100 } } as ResizeObserverEntry,
  ]);
  
  // ... assert resize handling ...
});
```

### API

- `installResizeObserverMock()` - Install mock on `globalThis.ResizeObserver`
- `resetResizeObserverMock()` - Clear recorded observer instances
- `restoreResizeObserverMock()` - Restore original `ResizeObserver`
- `triggerResizeObservers(entries)` - Trigger all registered callbacks

### Types

#### MockObserverEntry

Internal type holding the callback and observer instance for each registered mock.

```typescript
type MockObserverEntry = {
  readonly callback: ResizeObserverCallback;
  readonly observer: ResizeObserver;
};
```
