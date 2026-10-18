// Minimal regression coverage for the four source-coverage / fallback-stop
// defects recorded in docs/reliability/zero-candidates-root-cause-20261017.md.
//
// These tests only assert the behavior that was actually broken. They do not
// re-test deployment, login, TLS, or the full fifteen-question suite.
import assert from "node:assert/strict";
import test from "node:test";

import { selectSource } from "../agent/source-selector.ts";
import { chooseResearchStrategy } from "../agent/research-policy.ts";
import { evaluateEvidence } from "../agent/evaluation.ts";
import { planQuery } from "../research/query-planner.ts";
import { sourceProfileForIntent } from "../intent/source-profiles.ts";
import type { ResearchPolicyInput } from "../agent/types.ts";
import type { ResearchResponse, ResearchSignal } from "../research/types.ts";

const capability = (type: "OFFICIAL" | "PRIMARY" | "GENERAL_WEB" | "INDEPENDENT_MEDIA", available = true) => ({
  type,
  available,
  supportsFreshness: true,
  supportsPrimaryDocuments: type === "OFFICIAL" || type === "PRIMARY",
  supportsDomainFilter: true,
  supportsTimeFilter: true,
});

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return {
    id: "s1", category: "匹配", channel: "官方", title: "Shopify checkout update",
    summary: "new detail", time: "1h", truth: 90, baseUseful: 90, lead: 80, tags: ["Shopify"],
    action: "read", why: "test", official: [], social: [], sourceType: "primary", sourceTier: "S",
    sourceUrl: "https://shopify.dev/changelog", publisher: "Shopify",
    publishedAt: new Date().toISOString(), firstSeenAt: new Date().toISOString(),
    retrievedAt: new Date().toISOString(), timestampStatus: "valid", dataOrigin: "live",
    confidence: 90, verificationStatus: "verified", relevanceScore: 90, reliabilityScore: 90,
    freshnessScore: 90, noveltyScore: 80, judgementImpactScore: 80, gapMatchScore: 80,
    overallScore: 90, sourceCount: 1, independentEvidenceCount: 1, propagationCount: 0,
    claims: [], sources: [], section: "must_know", gapMatches: [], questionMatches: [],
    entityMatches: ["shopify"], whyItMatters: "test", eventStatus: "NEW", informationType: "FACT",
    knowledgeStatus: "NOVEL", attentionDecision: "MUST_READ", ...overrides,
  };
}

function response(signals: ResearchSignal[]): ResearchResponse {
  return {
    signals, status: [], queryPlan: {} as never, progress: [], failures: [], counts: {} as never,
    overview: {} as never, fetchedAt: new Date().toISOString(), dataMode: "live",
    coverage: {
      level: "Limited", usedProviders: [], zeroResultProviders: [], notSearchedProviders: [],
      unavailableProviders: [], notConfiguredProviders: [], failedProviders: [], outcomes: [],
    },
  };
}

function policyInput(overrides: Partial<ResearchPolicyInput> = {}): ResearchPolicyInput {
  return {
    currentEvidence: response([]),
    relatedKnowledge: [],
    conflictState: {
      decision: "STOP", sufficientEvidence: false, conflictDetected: false,
      conflictingClaims: [], informationGain: 0, reason: "no signal",
    },
    sourceCoverage: response([]).coverage,
    freshnessState: "unknown",
    reliabilityState: "unknown",
    informationGain: 0,
    round: 1,
    maxRounds: 3,
    previousStrategies: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Defect 1 — source executability
// A recognized entity must not be treated as "official adapters already cover
// it". Shopify has no entry in the company registry, the GitHub official target
// list, or the official update-page table, so entity recognition alone must not
// lock the run into OFFICIAL-only providers.
// ---------------------------------------------------------------------------

test("recognized entity without dedicated official coverage still gets a web discovery source", () => {
  const selection = selectSource({
    strategy: "INITIAL",
    sourceProfile: sourceProfileForIntent("PRODUCT_UPDATE"),
    resolvedEntities: [{ canonicalEntity: "Shopify", aliasesConsidered: ["Shopify"] }],
    officiallyCoveredEntities: [],
  });

  assert.ok(
    selection.allowedProviderIds?.some((providerId) =>
      ["public-web", "product-hunt", "hacker-news", "huggingface"].includes(providerId),
    ),
    `expected a general web discovery provider, got ${JSON.stringify(selection.allowedProviderIds)}`,
  );
  assert.ok(
    selection.allowedProviderIds?.some((providerId) =>
      ["company-registry", "official-update-pages", "github-releases"].includes(providerId),
    ),
    "official verification providers must stay reachable in the same attempt",
  );
});

test("entity WITH dedicated official coverage keeps official-first routing", () => {
  const selection = selectSource({
    strategy: "INITIAL",
    sourceProfile: sourceProfileForIntent("PRODUCT_UPDATE"),
    resolvedEntities: [{ canonicalEntity: "OpenAI", aliasesConsidered: ["OpenAI"] }],
    officiallyCoveredEntities: ["OpenAI", "openai"],
  });

  assert.equal(selection.primarySourceType, "OFFICIAL");
  // registered-feeds is bound to OFFICIAL as well: a curated feed for the entity's
  // own publisher is an official first-party source, not general web discovery.
  assert.deepEqual(selection.allowedProviderIds, ["company-registry", "official-update-pages", "github-releases", "registered-feeds"]);
});

test("coverage reflects what the official adapters can actually execute", async () => {
  const { officiallyCoveredEntities } = await import("../source-registry/resolver.ts");
  const { officialTargetCoverage } = await import("../research/github-discovery.ts");

  // OpenAI has both a company-registry profile and an official GitHub target.
  assert.ok(officiallyCoveredEntities({ entities: ["OpenAI"], query: "" }).length > 0);
  assert.ok(officialTargetCoverage(["OpenAI"]).length > 0);

  // Shopify has no company-registry profile and no official GitHub target, but it
  // does ship a first-party changelog feed, so the feed catalogue is now the
  // adapter that can actually execute for it. Recognition plus a real feed is
  // coverage; recognition alone would not be.
  assert.deepEqual(officiallyCoveredEntities({ entities: ["Shopify"], query: "Shopify checkout" }), ["Shopify"]);
  assert.deepEqual(officialTargetCoverage(["Shopify"]), []);

  // An entity with neither a registry profile, nor an official feed, nor a GitHub
  // target must still report no official coverage, otherwise the run gets locked
  // into OFFICIAL-only providers that can only return not_searched.
  assert.deepEqual(officiallyCoveredEntities({ entities: ["DaVinci"], query: "DaVinci Resolve 剪辑插件价格" }), []);
  assert.deepEqual(officialTargetCoverage(["DaVinci"]), []);
});

// ---------------------------------------------------------------------------
// Defect 2 — bounded and real fallback
// GENERAL_WEB was listed in fallbackSourceTypes but never executed, and the
// selector must not hand back a source the run has already burned.
// ---------------------------------------------------------------------------

test("fallback selection skips sources that already produced nothing", () => {
  const selection = selectSource({
    strategy: "INITIAL",
    availableSourceCapabilities: [capability("GENERAL_WEB"), capability("PRIMARY"), capability("INDEPENDENT_MEDIA")],
    previousSourceOutcomes: [{
      sourceType: "GENERAL_WEB", providerId: "public-web",
      resultCount: 0, newEvidenceCount: 0, newClaimCount: 0, reliabilityGain: 0, conflictReduction: 0,
    }],
  });

  assert.notEqual(selection.primarySourceType, "GENERAL_WEB");
  assert.equal(selection.fallbackSourceTypes.includes("GENERAL_WEB"), false);
});

test("failed official attempt hands the next round a still-executable fallback source", () => {
  const selection = selectSource({
    strategy: "INITIAL",
    sourceProfile: sourceProfileForIntent("PRODUCT_UPDATE"),
    resolvedEntities: [{ canonicalEntity: "Shopify", aliasesConsidered: ["Shopify"] }],
    officiallyCoveredEntities: [],
    previousSourceOutcomes: [{
      sourceType: "OFFICIAL", providerId: "official-update-pages",
      resultCount: 0, newEvidenceCount: 0, newClaimCount: 0, reliabilityGain: 0, conflictReduction: 0,
    }],
  });

  assert.ok(selection.fallbackSourceTypes.length > 0, "a fallback source must remain available");
});

// ---------------------------------------------------------------------------
// Defect 3 — stopping correctly
// Zero information gain must not be reported as "evidence already satisfies the
// goal", and a real upstream failure must not be dressed up as "no new info".
// ---------------------------------------------------------------------------

test("zero evidence is not reported as goal satisfied when a usable source is untried", () => {
  const decision = chooseResearchStrategy(policyInput({
    sourceCoverage: {
      ...response([]).coverage,
      notSearchedProviders: ["General Web / Public Web Community"],
    },
  }));

  assert.notEqual(decision.strategy, "STOP");
  assert.doesNotMatch(decision.reason, /已满足当前研究目标/);
});

test("provider failure is not reported as a satisfied goal", () => {
  const decision = chooseResearchStrategy(policyInput({
    conflictState: {
      decision: "STOP", sufficientEvidence: false, conflictDetected: false,
      conflictingClaims: [], informationGain: 0, reason: "no signal",
    },
    sourceCoverage: {
      ...response([]).coverage,
      failedProviders: ["Primary Sources"],
      notSearchedProviders: [],
    },
  }));

  assert.doesNotMatch(decision.reason, /已满足当前研究目标/);
});

test("sufficient evidence with no untried source still stops cleanly", () => {
  const decision = chooseResearchStrategy(policyInput({
    currentEvidence: response([signal()]),
    informationGain: 2,
    reliabilityState: "high",
    conflictState: {
      decision: "STOP", sufficientEvidence: true, conflictDetected: false,
      conflictingClaims: [], informationGain: 2, reason: "已有一致的高可靠证据",
    },
  }));

  assert.equal(decision.strategy, "STOP");
});

test("evaluation reports insufficient evidence rather than implying completion", () => {
  const evaluation = evaluateEvidence(response([]), 1, 3);

  assert.equal(evaluation.sufficientEvidence, false);
  assert.equal(evaluation.informationGain, 0);
  assert.doesNotMatch(evaluation.reason, /已满足/);
});

test("relevant evidence passes evaluation while unrelated material is rejected upstream", () => {
  const relevant = evaluateEvidence(response([signal()]), 1, 3);
  assert.equal(relevant.sufficientEvidence, true);

  const unrelated = evaluateEvidence(response([
    signal({ topicRelevance: { decision: "TOPIC_MISMATCH", score: 10, reasons: ["off_topic"] } } as never),
  ]), 1, 3);
  assert.equal(unrelated.sufficientEvidence, false);
});

// ---------------------------------------------------------------------------
// Defect 4 — query construction
// The generic "个人关注方向" fallback label must not be injected into real
// search queries, and the entity/region/task/time constraints must survive.
// ---------------------------------------------------------------------------

test("generic fallback label never reaches the real search query", () => {
  const queries = planQuery({
    identity: "shop-owner",
    industry: "个人关注方向",
    focusAreas: "值得关注的新变化",
    currentQuestions: "过去30天 Shopify 有哪些与结账或支付有关的变化",
    knownInformation: "",
    informationGaps: "优先关注地区：美国",
    trackedEntities: "Shopify",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: "30d",
  });

  assert.ok(queries.searchCombinations.length > 0);
  assert.equal(
    queries.searchCombinations.some((query) => query.includes("个人关注方向")),
    false,
    `generic label leaked into queries: ${JSON.stringify(queries.searchCombinations)}`,
  );
});

test("entity-anchored query survives and carries no other-entity drift", () => {
  const queries = planQuery({
    identity: "shop-owner",
    industry: "个人关注方向",
    focusAreas: "值得关注的新变化",
    currentQuestions: "过去30天 Shopify 有哪些与结账或支付有关的变化",
    knownInformation: "",
    informationGaps: "优先关注地区：美国",
    trackedEntities: "Shopify",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: "30d",
  });

  assert.ok(
    queries.searchCombinations.some((query) => query.includes("Shopify")),
    "at least one query must stay anchored to the asked entity",
  );
  assert.equal(
    queries.searchCombinations.some((query) => /openai|anthropic|deepseek|comfyui|hugging ?face/i.test(query)),
    false,
    `query drifted to an unrelated AI repository entity: ${JSON.stringify(queries.searchCombinations)}`,
  );
});
// ---------------------------------------------------------------------------
// Defect 2 (runner level) — a declared fallback must actually execute
// The plan listed GENERAL_WEB as a fallback, but the runner executed exactly one
// fallback source group and then stopped, so the declared source never ran.
// Observed on the covered-entity path: attempts were exactly ["OFFICIAL",
// "PRIMARY"] and GENERAL_WEB was never attempted. Every not-yet-executed
// fallback must get a real chance inside the existing deadline, and a source
// that already ran must not be repeated.

test("runner keeps executing declared fallbacks until they are exhausted", async () => {
  const { runAgent } = await import("../agent/runner.ts");
  const executedSourceTypes: Array<string | undefined> = [];

  await runAgent({
    input: {
      identity: "builder", industry: "AI developer tools", focusAreas: "Runway",
      currentQuestions: "latest release", knownInformation: "", informationGaps: "",
      trackedEntities: "Runway", trackedEvents: "", userJudgements: "", evidenceHistory: "",
      freshnessWindow: "7d",
    },
    maxRounds: 1,
    maxExecutionTimeMs: 25000,
    research: async (_input, plan) => {
      executedSourceTypes.push(plan?.selectedSourceType);
      return response([]);
    },
  });

  assert.ok(
    executedSourceTypes.includes("GENERAL_WEB"),
    `GENERAL_WEB was declared as a fallback but never executed; attempts: ${JSON.stringify(executedSourceTypes)}`,
  );
  const uniqueAttempts = Array.from(new Set(executedSourceTypes));
  assert.equal(
    executedSourceTypes.length,
    uniqueAttempts.length,
    `a source type was retried within one round: ${JSON.stringify(executedSourceTypes)}`,
  );
});

test("runner stops falling back once the deadline budget is gone", async () => {
  const { runAgent } = await import("../agent/runner.ts");
  let calls = 0;

  const result = await runAgent({
    input: {
      identity: "builder", industry: "AI developer tools", focusAreas: "Runway",
      currentQuestions: "latest release", knownInformation: "", informationGaps: "",
      trackedEntities: "Runway", trackedEvents: "", userJudgements: "", evidenceHistory: "",
      freshnessWindow: "7d",
    },
    maxRounds: 1,
    maxExecutionTimeMs: 25000,
    research: async () => {
      calls += 1;
      // Burn the remaining deadline so any further attempt is genuinely blocked.
      await new Promise((resolve) => setTimeout(resolve, 30));
      return response([]);
    },
  });

  assert.ok(calls >= 1);
  assert.notEqual(result.status, "failed");
});
