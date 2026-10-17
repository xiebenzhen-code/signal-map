import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("switching the question on the home page replaces gap/entity context instead of merging old echoes", () => {
  const startResearchBody = pageSource.match(/const startResearch = useCallback\([\s\S]*?\n  \);/)?.[0] ?? "";
  assert.ok(startResearchBody.includes("isTopicSwitch"), "startResearch must detect a topic switch");
  assert.match(startResearchBody, /informationGaps: isTopicSwitch\s*\?\s*draft\.informationGaps/);
  assert.match(startResearchBody, /trackedEntities: isTopicSwitch\s*\?\s*draft\.trackedEntities/);
  // Same-question refinement keeps the merge behaviour:
  assert.match(startResearchBody, /unique\(\[\.\.\.activeKnowledge\.informationGaps, \.\.\.draft\.informationGaps\]\)/);
});

test("today presentation receives the requested freshness window", () => {
  assert.match(
    pageSource,
    /selectTodayPresentation\(signals, response\?\.queryPlan\?\.requestedFreshnessWindow\)/,
  );
});
