// Everything to fix in the sketch, for the Check list and the status bar.

import { planJourney } from "../core/journey";
import type { Region } from "../core/model";
import type { SketchIssue } from "../core/sketch";
import { sketchIssues } from "../core/sketch";

export function sketchProblems(region: Region): SketchIssue[] {
  const s = region.sketch;
  if (!s) return [];
  const journey = planJourney(s, region).problems.map((p) => ({ ...p, code: "journey" }));
  return [...sketchIssues(s, region.settings.targetSegmentLength, region.settings.engineLimits), ...journey];
}
