import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // The seed sweeps generate dozens of maps each; allow for a busy machine.
    testTimeout: 30000,
  },
});
