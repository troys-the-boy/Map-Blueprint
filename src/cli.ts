// Command-line entry point: run the core without the browser.
//
//   npm run gen -- --config examples/route.json --seed 42
//   npm run gen -- --config examples/route.json --seed 42 --out my-project.json
//
// In Milestone 1 this creates a blank map from the config. Later milestones
// plug the generators in here, so generation can be tested headless.

import { readFileSync, writeFileSync } from "node:fs";
import { BIOMES, MAP_TYPES, addNewMap, newRegion } from "./core/model";
import type { Biome, MapType } from "./core/model";
import { normalizeSeed } from "./core/rng";
import { serializeProject } from "./core/project";
import { checkMapSize, describeSizeCheck } from "./core/sizeRule";
import { arrayOf, num, object, oneOf, str } from "./core/schema";
import { explainOpenError } from "./core/project";
import pkg from "../package.json";

const configCheck = object(
  {
    regionName: str(100),
    name: str(100),
    mapType: oneOf(MAP_TYPES),
    width: num(1, 512),
    height: num(1, 512),
    biome: oneOf(BIOMES),
    notes: arrayOf(str(500), 50),
  },
  ["regionName", "biome", "notes"],
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

  if (!configPath) {
    console.error("Missing --config. Example: npm run gen -- --config examples/route.json --seed 42");
    return 1;
  }
  const seed = normalizeSeed(seedText === undefined ? 1 : Number(seedText));
  if (seedText !== undefined && !Number.isFinite(Number(seedText))) {
    console.error(`The seed "${seedText}" is not a number.`);
    return 1;
  }

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
  addNewMap(region, {
    name: config.name,
    mapType: config.mapType as MapType,
    width: config.width,
    height: config.height,
    seed,
    biome: config.biome as Biome | undefined,
  });
  // A fixed save time keeps CLI output identical for the same inputs.
  const json = serializeProject(region, pkg.version, new Date(0));
  if (outPath) {
    writeFileSync(outPath, json, "utf8");
    console.log(`Wrote ${outPath} (${config.width}×${config.height} ${config.mapType}, seed ${seed}). ${describeSizeCheck(size)}`);
  } else {
    process.stdout.write(json);
  }
  return 0;
}

process.exitCode = main();
