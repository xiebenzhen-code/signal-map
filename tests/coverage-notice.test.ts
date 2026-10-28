import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { parseRegisteredFeed } from "../research/registered-feeds.ts";
import { assessTopicRelevance } from "../research/topic-relevance.ts";
import { describesRecentChange } from "../research/recent-signal.ts";
import { buildFilteringSummary, partitionByVerdictCertainty, explainZeroDisplay } from "../research/filtering-summary.ts";
import { formatCoverageNotice } from "../research/source-coverage.ts";
import type { QueryPlan, ResearchSignal } from "../research/types.ts";

// Real D06 capture, frozen by the A-stage diagnostic. Only the non-relevance
// scores below are controlled to isolate both production presentation gates.
// This is not an end-to-end replay or a claim about production date eligibility.
const xml = readFileSync(new URL("./fixtures/d06-chrome.xml", import.meta.url), "utf8");
const { plan } = JSON.parse(readFileSync(new URL("./fixtures/d06-plan.json", import.meta.url), "utf8")) as { plan: QueryPlan };
const entries = parseRegisteredFeed(xml, {
  id: "chrome", name: "Chrome Releases", url: "https://chromereleases.googleblog.com/feeds/posts/default",
  publisherHosts: ["chromereleases.googleblog.com"], aliases: ["Chrome"], topics: [], official: true, cloudVerified: false,
}).entries;

function signal(index: number, eventStatus: "NEW" | "SIGNAL"): ResearchSignal {
  const entry = entries[index];
  return {
    id: `d06-${index}`, category: "匹配", channel: "官方", title: entry.title, summary: entry.snippet,
    time: "frozen", truth: 90, baseUseful: 90, lead: 90, tags: [], action: "review", why: "gate test", official: [], social: [],
    sourceType: "primary", sourceTier: "S", sourceUrl: entry.url, publisher: "Chrome Releases", publishedAt: entry.publishedAt,
    firstSeenAt: entry.publishedAt!, retrievedAt: "2026-10-20T23:59:59Z", timestampStatus: "valid", dataOrigin: "live",
    confidence: 90, verificationStatus: "verified", topicRelevance: assessTopicRelevance(`${entry.title} ${entry.snippet}`.toLocaleLowerCase(), plan),
    relevanceScore: 95, reliabilityScore: 95, freshnessScore: 95, noveltyScore: 95, judgementImpactScore: 95, gapMatchScore: 95, overallScore: 95,
    sourceCount: 1, independentEvidenceCount: 1, propagationCount: 1, claims: [], sources: [], section: "all",
    gapMatches: [], questionMatches: [], entityMatches: [], whyItMatters: "gate test", eventStatus, informationType: "FACT",
    knowledgeStatus: "NOVEL", attentionDecision: "LIBRARY_ONLY", actionabilityStatus: "TEST_NOW", informationGainStatus: "NEW_INFORMATION",
  };
}

// Execute the actual two gate loops AND final response partition, not copied
// predicates. Existing UI tests use the same TS-transpile pattern for TSX.
function runPresentationGates(allSignals: ResearchSignal[]): ResearchSignal[] {
  const source = readFileSync(new URL("../research/research-pipeline.ts", import.meta.url), "utf8");
  const start = source.indexOf("  const selectedEntities = new Set<string>();");
  const end = source.indexOf('  markPhase("evidence_finished"', start);
  assert.ok(start > 0 && end > start);
  const js = ts.transpileModule(`function present(allSignals: any[], trackedEntityTerms: string[]) {${source.slice(start, end)}; return signals;}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const present = new Function("describesRecentChange", "partitionByVerdictCertainty", `${js}; return present;`)(describesRecentChange, partitionByVerdictCertainty);
  return present(allSignals, []);
}

for (const eventStatus of ["NEW", "SIGNAL"] as const) {
  test(`D06: ${eventStatus} gate sends all 25 UNCERTAIN entries to possibleRelated, formal display 0`, () => {
    assert.equal(createHash("sha256").update(xml).digest("hex"), "1b0605f67093985a0ed58505acffcbe2f3c1e8e5d5a41e0bd8b0fe649ad8899b");
    assert.equal(entries.length, 25);
    const all = entries.map((_, index) => signal(index, eventStatus));
    assert.ok(all.every(item => item.topicRelevance?.decision === "UNCERTAIN"));
    const displayed = runPresentationGates(all);
    assert.equal(all.filter(item => item.attentionDecision === "MUST_READ" || item.attentionDecision === "WORTH_WATCHING").length, 0, "neither formal gate may admit UNCERTAIN");
    assert.equal(displayed.length, 0, "UNCERTAIN must also leave the formal/library response stream");
    const summary = buildFilteringSummary({ retrievedCount: 25, clusteredCount: 25, allSignals: all, displayedSignals: displayed });
    assert.equal(summary.possibleRelated?.length, 25);
    assert.equal(summary.displayedCount, 0);
    assert.deepEqual(summary.possibleRelated?.map(item => item.url), entries.map(item => item.url));
  });
  test(`${eventStatus} gate still admits MATCH with otherwise identical scores`, () => {
    const item = signal(0, eventStatus);
    item.topicRelevance = { ...item.topicRelevance!, decision: "MATCH" };
    assert.equal(runPresentationGates([item]).length, 1);
    assert.equal(item.attentionDecision, eventStatus === "NEW" ? "MUST_READ" : "WORTH_WATCHING");
  });
}

test("source notice describes a truncated slice without claiming coverage", () => {
  const notice = formatCoverageNotice({ execution: "searched_with_results", searched: true, resultCount: 5, routeLimit: 5,
    observedEarliest: "2026-10-25T00:00:00Z", observedLatest: "2026-10-25T02:00:00Z" }, "2026-10-18T00:00:00Z");
  assert.match(notice, /最近 5 条/);
  assert.match(notice, /早于/);
  assert.doesNotMatch(notice, /覆盖/);
});

test("unconfigured source is explained even when no request or material exists", () => {
  assert.equal(explainZeroDisplay({retrievedCount: 0, displayedCount: 0, allSignals: [], outcomes: [
    {execution: "not_configured", searched: false, resultCount: 0},
  ]}), "SOURCE_NOT_SEARCHED");
  assert.match(formatCoverageNotice({execution: "not_configured", searched: false, resultCount: 0}), /未配置/);
});

test("pre-request failure stays a read failure rather than unsearched or successful empty", () => {
  assert.match(formatCoverageNotice({execution: "failed", searched: false, resultCount: 0, detailFailureCode: "FEED_PRIVATE_ADDRESS"}), /读取失败（FEED_PRIVATE_ADDRESS）/);
});
