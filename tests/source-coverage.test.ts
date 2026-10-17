import assert from "node:assert/strict";
import test from "node:test";
import { buildSourceCoverage } from "../research/source-coverage.ts";

test("failed providers are not counted as used", () => {
  const coverage = buildSourceCoverage([
    {
      source: "X",
      searched: true,
      resultCount: 0,
      execution: "failed",
      failureCode: "timeout",
    },
    {
      source: "Primary Sources",
      searched: true,
      resultCount: 2,
      execution: "searched_with_results",
    },
  ]);

  assert.deepEqual(coverage.usedProviders, ["Primary Sources"]);
  assert.deepEqual(coverage.failedProviders, ["X"]);
});

test("searched zero results stays distinct from not searched and unavailable", () => {
  const coverage = buildSourceCoverage([
    {
      source: "Reddit",
      searched: true,
      resultCount: 0,
      execution: "searched_no_results",
    },
    {
      source: "Xiaohongshu",
      searched: false,
      resultCount: 0,
      execution: "unavailable",
    },
    {
      source: "X",
      searched: false,
      resultCount: 0,
      execution: "not_searched",
    },
  ]);

  assert.deepEqual(coverage.zeroResultProviders, ["Reddit"]);
  assert.deepEqual(coverage.unavailableProviders, ["Xiaohongshu"]);
  assert.deepEqual(coverage.notSearchedProviders, ["X"]);
});
