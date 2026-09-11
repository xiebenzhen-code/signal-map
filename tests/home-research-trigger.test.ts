import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("home initialization restores state without automatically refreshing research", () => {
  assert.match(pageSource, /setLastRunByFilterId\(snapshot\.lastRunByFilterId\)/);
  assert.doesNotMatch(pageSource, /refreshToday\(restoredContext,\s*restoredFilter\)/);
});

test("switching filters does not automatically call the research API", () => {
  const switchFilterBody = pageSource.match(/const switchFilter = useCallback\([\s\S]*?\n\s*\);/)?.[0] ?? "";
  assert.ok(switchFilterBody.includes("setActiveFilterId(filter.id)"));
  assert.doesNotMatch(switchFilterBody, /refreshToday\(/);
});
