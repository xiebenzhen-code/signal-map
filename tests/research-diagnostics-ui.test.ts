import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";
import * as filtering from "../research/filtering-summary.ts";
import * as coverage from "../research/source-coverage.ts";
import type { FilteringSummary } from "../research/types.ts";
import type { SourceExecutionOutcome } from "../research/source-coverage.ts";

const require = createRequire(import.meta.url);
function render(summary: FilteringSummary, outcomes: SourceExecutionOutcome[]) {
  const file = new URL("../app/components/research-diagnostics.tsx", import.meta.url);
  assert.ok(existsSync(file), "research diagnostic component must exist");
  const js = ts.transpileModule(readFileSync(file, "utf8"), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const compiled = { exports: {} as { ResearchDiagnostics: ComponentType<{summary: FilteringSummary; outcomes: SourceExecutionOutcome[]}> } };
  new Function("require", "module", "exports", js)((id: string) => {
    if (id.endsWith("filtering-summary.ts")) return filtering;
    if (id.endsWith("source-coverage.ts")) return coverage;
    return require(id);
  }, compiled, compiled.exports);
  return renderToStaticMarkup(createElement(compiled.exports.ResearchDiagnostics, { summary, outcomes }));
}
const base = filtering.buildFilteringSummary({retrievedCount: 0, clusteredCount: 0, allSignals: [], displayedSignals: []});
const searched: SourceExecutionOutcome = {source: "Chrome Releases", sourceId: "chrome", searched: true, resultCount: 25, execution: "searched_with_results",
  coverage: {returnedCount: 25, undatedCount: 0, notice: "本次取得该来源最近 25 条，发布时间 A 至 B。"}};
const cases: Array<{name: string; summary: FilteringSummary; outcomes: SourceExecutionOutcome[]; text: string}> = [
  {name: "SOURCE_FAILED", summary: base, outcomes: [{...searched, execution: "failed", detailFailureCode: "FEED_TIMEOUT", coverage: undefined}], text: "来源读取失败（FEED_TIMEOUT）"},
  {name: "NO_MATERIAL", summary: base, outcomes: [{...searched, resultCount: 0, execution: "searched_no_results", coverage: undefined}], text: "本次没有取得材料"},
  {name: "SOURCE_NOT_SEARCHED", summary: base, outcomes: [{...searched, source: "未配置来源", execution: "not_configured", searched: false, resultCount: 0, coverage: undefined}], text: "部分来源未搜索（未配置）"},
  {name: "ALL_UNCERTAIN", summary: {...base, retrievedCount: 25, possibleRelated: [{id: "c1", title: "Chrome update", url: "https://example.org/update", reason: "UNCERTAIN_TASK_CONSTRAINT"}],
    filteringDetails: [{id: "c1", title: "Chrome update", decision: "filtered", explanation: "待核对", sources: [], topicRelevance: {decision: "UNCERTAIN", matchedQueryTerms: [], matchedDomainAnchors: [], matchedTaskAnchors: [], matchedGenericTerms: []}}]}, outcomes: [searched], text: "材料与问题的关系不确定，已放入可能相关"},
  {name: "ALL_IRRELEVANT", summary: {...base, retrievedCount: 25, filteringDetails: [{id: "c2", title: "other", decision: "filtered", explanation: "无关", sources: [], topicRelevance: {decision: "TOPIC_MISMATCH"}}]}, outcomes: [searched], text: "取得的材料都与问题无关"},
  {name: "MIXED_FILTERED", summary: {...base, retrievedCount: 25}, outcomes: [searched], text: "材料被多种原因过滤"},
];
for (const item of cases) {
  test(`diagnostic rendering snapshot: ${item.name}`, t => {
    const html = render(item.summary, item.outcomes);
    assert.ok(html.includes(item.text));
    assert.doesNotMatch(html, /覆盖/);
    t.assert.snapshot(html);
  });
}
test("possibleRelated is closed by default, unconfirmed and retains original link", () => {
  const item = cases.find(item => item.name === "ALL_UNCERTAIN")!;
  const html = render(item.summary, item.outcomes);
  assert.match(html, /<details[^>]*>/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:[\s=>])/);
  assert.match(html, /未确认/);
  assert.match(html, /href="https:\/\/example.org\/update"/);
  assert.match(html, /本次取得该来源最近 25 条/);
});
test("nonzero display renders source notices without a zero-result explanation", () => {
  const html = render({...base, displayedCount: 1}, [searched]);
  assert.match(html, /Chrome Releases/);
  assert.match(html, /本次取得该来源最近 25 条/);
  for (const item of cases) assert.ok(!html.includes(item.text));
});
