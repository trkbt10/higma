/** @file RenderTree-local SVG definition ID generation. */

import type { IdGenerator } from "../render";

/**
 * Module-level monotonic counter so RenderTree defs never collide across
 * concurrently mounted scene renderers in the same DOM.
 */
const resolverGenerationRef = { value: 0 };

/** Create a RenderTree ID generator with a process-local generation prefix. */
export function createRenderTreeIdGenerator(): IdGenerator {
  const generation = resolverGenerationRef.value;
  resolverGenerationRef.value += 1;
  const counterRef = { value: 0 };
  return {
    getNextId(prefix: string): string {
      const counter = counterRef.value;
      counterRef.value += 1;
      return `${prefix}-g${generation}-${counter}`;
    },
  };
}
