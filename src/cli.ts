// Command-line entry point: run the core without the browser.
//
//   npm run gen -- --config examples/route.json --seed 42
//   npm run gen -- --config examples/route.json --seed 42 --out my-project.json
//   npm run gen -- --config examples/route.json --seed 42 --export out-folder
//
// Generates the map in the config (routes for now), prints a summary of the
// validation results, and writes the project file and/or every export.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BIOMES, MAP_TYPES, addNewMap, newRegion } from "./core/model";
import type { Biome, MapType } from "./core/model";
import { normalizeSeed } from "./core/rng";
import { explainOpenError, serializeProject } from "./core/project";
import { checkMapSize, describeSizeCheck } from "./core/sizeRule";
import { arrayOf, num, object, oneOf, simpleRecord, str } from "./core/schema";
import { applyResult, canGenerate, generateRoute } from "./core/generate";
import { EXPORTERS } from "./core/exporters";
import pkg from "../package.json";

const configCheck = object(
  {
    regionName: str(100),
    name: str(100),
    mapType: oneOf(MAP_TYPES),
    width: num(1, 512),
    height: num(1, 512),
    biome: oneOf(BIOMES),
    params: simpleRecord(64, 200),
    notes: arrayOf(str(500), 50),
  },
  ["regionName", "biome", "params", "notes"],
);

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(): number {
  const args = process.argv.slice(2);
  const configPath = argValue(args, "--config");
  const seedText = argValue(args, "--seed");
  const outPath = argValue(args, "--out");
  const exportDir = argValue(args, "--export");

  if (!configPath) {
    console.error("Missing --config. Example: npm run gen -- --config examples/route.json --seed 42");
    return 1;
  }
  if (seedText !== undefined && !Number.isFinite(Number(seedText))) {
    console.error(`The seed "${seedText}" is not a number.`);
    return 1;
  }
  const seed = normalizeSeed(seedText === undefined ? 1 : Number(seedText));

  let config;
  try {
    config = configCheck(JSON.parse(readFileSync(configPath, "utf8")), "config");
  } catch (err) {
    console.error(`Could not read ${configPath}. ${explainOpenError(err)}`);
    return 1;
  }

  const size = checkMapSize(config.width, config.height);
  if (!size.ok) {
    console.error(describeSizeCheck(size));
    return 1;
  }

  const region = newRegion(config.regionName ?? "Untitled region", seed);
  const map = addNewMap(region, {
    name: config.name,
    mapType: config.mapType as MapType,
    width: config.width,
    height: config.height,
    seed,
    biome: config.biome as Biome | undefined,
  });
  map.params = { ...(config.params ?? {}) };

  let failed = false;
  if (canGenerate(map)) {
    const result = generateRoute(map);
    applyResult(map, result);
    const errors = result.issues.filter((i) => i.severity === "error");
    const warnings = result.issues.filter((i) => i.severity === "warning");
    // Summary goes to stderr so stdout can still be piped as JSON.
    console.error(`Generated ${map.name}: ${config.width}×${config.height}, seed ${seed}, ${result.attempts} attempt(s), ${errors.length} error(s), ${warnings.length} warning(s).`);
    for (const i of result.issues) console.error(`  ${i.severity === "error" ? "ERROR" : "warning"}: ${i.message}`);
    failed = errors.length > 0;
  } else {
    console.error(`No generator for "${config.mapType}" maps yet; writing a blank map.`);
  }

  // A fixed save time keeps CLI output identical for the same inputs.
  const json = serializeProject(region, pkg.version, new Date(0));
  if (outPath) {
    writeFileSync(outPath, json, "utf8");
    console.error(`Wrote ${outPath}`);
  } else if (!exportDir) {
    process.stdout.write(json);
  }

  if (exportDir) {
    const ctx = { paletteId: "pnw", regionName: region.name, appVersion: pkg.version };
    for (const exporter of EXPORTERS) {
      const file = exporter.run(map, ctx);
      const target = join(exportDir, file.name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.data);
      console.error(`Exported ${target}`);
    }
  }
  return failed ? 2 : 0;
}

process.exitCode = main();
