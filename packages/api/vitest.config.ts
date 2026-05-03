/**
 * @file Vitest configuration for the API package.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.spec.ts"],
    environment: "node",
  },
});
