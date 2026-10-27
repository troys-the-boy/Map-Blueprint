// Guards for the architecture rules: core/ is deterministic and browser-free.
// (tsconfig.core.json also type-checks core/ without the DOM library.)

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const coreDir = join(__dirname, "..", "src", "core");
const files = readdirSync(coreDir).filter((f) => f.endsWith(".ts"));

describe("core/ rules", () => {
  it.each(files)("%s never uses Math.random (use the seeded Rng)", (f) => {
    // Comment lines may mention it; code lines may not.
    expect(readFileSync(join(coreDir, f), "utf8")).not.toMatch(/^(?!\s*\/\/).*Math\.random/m);
  });

  it.each(files)("%s imports nothing from the UI", (f) => {
    expect(readFileSync(join(coreDir, f), "utf8")).not.toMatch(/from ["'](\.\.\/ui|react)/);
  });
});
