// Concurrent-update audit for the source-save path: when a source save and a
// feedback write overlap, the atomic two-key write must not lose the feedback.
// Uses the established AST-extraction pattern to execute the REAL saveSources
// callback from app/page.tsx with a simulated store.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { mergeFilterEntry, mergeKnowledgeEntry } from "../lib/alpha-storage.ts";
import type { InformationFilter, KnowledgeByFilterId } from "../information/types.ts";

const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let saveSourcesSource = "";
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "saveSources" && node.initializer && ts.isCallExpression(node.initializer)) {
    saveSourcesSource = node.initializer.arguments[0].getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(saveSourcesSource, "saveSources callback must exist in app/page.tsx");

function transpile(js: string) {
  return ts.transpileModule(`const callback = ${saveSourcesSource}; return callback;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

test("concurrent feedback write during a source save is not overwritten", async () => {
  const js = ts.transpileModule(`const callback = ${saveSourcesSource}; return callback;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const store: { filters: InformationFilter[]; knowledgeByFilterId: KnowledgeByFilterId } = {
    filters: [{ id: "f1", filterName: "A", industry: "tools", focusAreas: [], freshnessWindow: "30d", sourceScope: "hybrid", customSources: [], createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z" } as InformationFilter],
    knowledgeByFilterId: { f1: { knownInformation: [], researchContextRevision: 1, updatedAt: '2026-10-03', currentQuestions: [], informationGaps: [], trackedEntities: [], trackedEvents: [], focusAreas: [], evidenceHistory: [], userJudgements: [], identity: '', industry: '', freshnessWindow: '30d' } as KnowledgeByFilterId[string] },
  };
  const feedbackWrite = { f1: { knownInformation: ["Changed after evidence: 某真实反馈"], researchContextRevision: 2 } };

  // 依赖注入：新 saveFilterSources = 事务内读-合-写（间隙内并发反馈写被合并而非覆盖）
  const saveFilterSources = async (options: { filterId: string; filterEntry: InformationFilter; knowledgeFilterId: string; knowledgeEntry: KnowledgeByFilterId[string] }) => {
    await new Promise((resolve) => setTimeout(resolve, 5)); // 异步间隙
    // 间隙内：反馈按钮的 setKnowledgeByFilterId → IndexedDB effect 写入新认知
    store.knowledgeByFilterId = JSON.parse(JSON.stringify(feedbackWrite));
    // 事务随后读取当前表并合并本过滤器的条目
    store.filters = mergeFilterEntry(store.filters, options.filterId, options.filterEntry);
    store.knowledgeByFilterId = mergeKnowledgeEntry(store.knowledgeByFilterId, options.knowledgeFilterId, options.knowledgeEntry);
  };
  const setFilters = (updater: (current: typeof store.filters) => typeof store.filters) => { store.filters = updater(store.filters); };
  const setKnowledgeByFilterId = (updater: (current: typeof store.knowledgeByFilterId) => typeof store.knowledgeByFilterId) => { store.knowledgeByFilterId = updater(store.knowledgeByFilterId); };
  const updateFilterResearchConfig = (filter: { id: string }, _knowledge: unknown, patch: { customSources: string[] }, updatedAt: string) => ({
    filter: { ...filter, customSources: patch.customSources, updatedAt },
    knowledge: { knownInformation: [], researchContextRevision: 2, updatedAt },
  });

  const callback = new Function(
    "activeFilter", "activeKnowledge", "activeFilterId", "loading", "filters", "knowledgeByFilterId",
    "updateFilterResearchConfig", "saveFilterSources", "setFilters", "setKnowledgeByFilterId",
    js,
  )(
    store.filters[0], store.knowledgeByFilterId.f1, "f1", false,
    store.filters, store.knowledgeByFilterId,          // ← 闭包捕获（反馈写入前的快照）
    updateFilterResearchConfig, saveFilterSources, setFilters, setKnowledgeByFilterId,
  );

  await callback(["https://example.com/user-source"]);

  const finalKnowledge = store.knowledgeByFilterId.f1;
  const feedbackSurvived = finalKnowledge.knownInformation?.some((item) => item.includes("Changed after evidence"));
  const sourceSaved = store.filters[0].customSources?.includes("https://example.com/user-source");
  console.log("来源保存:", sourceSaved, "| 反馈幸存:", feedbackSurvived, "| 最终认知:", JSON.stringify(finalKnowledge));
  assert.ok(sourceSaved, "source must be saved");
  assert.ok(feedbackSurvived, "concurrent feedback must not be overwritten by the source save");
});
