import assert from "node:assert/strict";
import test from "node:test";

import { evaluateEvidence } from "../agent/evaluation.ts";
import { updateKnowledgeFromChanges } from "../agent/knowledge-updater.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
import { buildFilteringSummary } from "../research/filtering-summary.ts";
import { assessTopicRelevance, isGenericQuestionTerm } from "../research/topic-relevance.ts";
import type { QueryPlan, ResearchSignal } from "../research/types.ts";

const videoPlan: QueryPlan = {
  originalNeed: "AI assisted video editing and automatic rough cut workflows",
  coreKeywords: ["AI", "video", "editing", "rough cut", "batch processing"],
  englishKeywords: ["artificial intelligence"],
  synonyms: ["automatic editing"],
  entities: [],
  industryKeywords: ["video production"],
  changeKeywords: [],
  knowledgeAwareQueries: [],
  searchCombinations: ["AI video editing"],
  topicProfile: {
    domainAnchors: ["AI video editing", "video production"],
    taskAnchors: ["automated rough cut", "shot selection", "multi-asset understanding", "batch processing", "commercial workflow"],
    genericTerms: ["AI", "model", "multimodal", "observation", "workflow", "automation"],
  },
  retrievalWindows: ["30d"],
  requestedFreshnessWindow: "30d",
};

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return {
    id: "signal-1",
    category: "匹配",
    channel: "官方",
    title: "Video editing model selects shots automatically",
    summary: "A primary paper evaluates automatic rough cuts for multi-asset video workflows.",
    time: "1d",
    truth: 92,
    baseUseful: 90,
    lead: 80,
    tags: ["video"],
    action: "review",
    why: "matches the question",
    official: [],
    social: [],
    sourceType: "primary",
    sourceTier: "S",
    sourceUrl: "https://arxiv.org/abs/1234.5678",
    publisher: "arXiv",
    publishedAt: "2026-09-17T00:00:00.000Z",
    firstSeenAt: "2026-09-17T00:00:00.000Z",
    retrievedAt: "2026-09-17T00:00:00.000Z",
    timestampStatus: "valid",
    dataOrigin: "live",
    confidence: 92,
    verificationStatus: "verified",
    topicRelevance: { decision: "MATCH", matchedTerms: ["video"], score: 75 },
    relevanceScore: 90,
    reliabilityScore: 92,
    freshnessScore: 90,
    noveltyScore: 80,
    judgementImpactScore: 80,
    gapMatchScore: 80,
    overallScore: 88,
    sourceCount: 1,
    independentEvidenceCount: 1,
    propagationCount: 1,
    claims: [],
    sources: [],
    section: "must_know",
    gapMatches: [],
    questionMatches: ["video editing"],
    entityMatches: [],
    whyItMatters: "It answers the current question.",
    eventStatus: "NEW",
    informationType: "FACT",
    knowledgeStatus: "NOVEL",
    attentionDecision: "MUST_READ",
    ...overrides,
  };
}

function response(signals: ResearchSignal[]) {
  return {
    signals,
    status: [],
    queryPlan: videoPlan,
    progress: [],
    failures: [],
    counts: {} as never,
    overview: {} as never,
    coverage: {} as never,
    fetchedAt: "2026-09-17T00:00:00.000Z",
    dataMode: "live" as const,
  };
}

test("medical AI evidence is rejected by topic relevance for a video editing query", () => {
  const relevance = assessTopicRelevance(
    "AI dataset for colorectal polyp detection and medical imaging",
    videoPlan,
  );

  assert.equal(relevance.decision, "TOPIC_MISMATCH");
  assert.equal(relevance.reason, "MISSING_DOMAIN_ANCHOR");
  assert.deepEqual(relevance.matchedDomainAnchors, []);
  assert.deepEqual(relevance.matchedTaskAnchors, []);
  assert.ok(relevance.matchedGenericTerms?.includes("ai"));
  assert.equal(relevance.relevanceGateApplied, true);
  assert.equal(relevance.relevanceGatePassed, false);
  assert.deepEqual(relevance.matchedTerms, []);
  assert.equal(relevance.score, 0);
});

test("matching arXiv video editing evidence remains eligible for evaluation", () => {
  const relevance = assessTopicRelevance(
    "Automatic video editing with rough cut and shot selection for multi-asset workflows",
    videoPlan,
  );

  assert.equal(relevance.decision, "MATCH");
  assert.equal(relevance.reason, "DOMAIN_AND_TASK_ANCHOR_MATCH");
  assert.equal(relevance.relevanceGateApplied, true);
  assert.equal(relevance.relevanceGatePassed, true);
  assert.ok(relevance.matchedTerms.includes("video"));
  const evaluation = evaluateEvidence(response([
    signal({ topicRelevance: relevance }),
  ]), 1, 1);
  assert.equal(evaluation.sufficientEvidence, true);
  assert.equal(evaluation.decision, "STOP");
});

test("generic AI or multimodal language cannot satisfy a domain-task topic profile", () => {
  for (const text of [
    "A generic AI model for multiple observations",
    "A multimodal research paper with no video editing or workflow task",
    "A medical AI model for medical imaging",
  ]) {
    const relevance = assessTopicRelevance(text, videoPlan);
    assert.equal(relevance.decision, "TOPIC_MISMATCH", text);
    assert.equal(relevance.score, 0, text);
  }
});

test("medical endoscopy video matches only the domain anchor", () => {
  const relevance = assessTopicRelevance(
    "An endoscopic video dataset supports AI recognition of colorectal polyposis.",
    videoPlan,
  );

  assert.equal(relevance.decision, "TOPIC_MISMATCH");
  assert.deepEqual(relevance.matchedDomainAnchors, ["video"]);
  assert.deepEqual(relevance.matchedTaskAnchors, []);
  assert.equal(relevance.relevanceGatePassed, false);
});

test("video dataset without editing tasks is a topic mismatch", () => {
  const relevance = assessTopicRelevance("A video dataset for medical observation", videoPlan);
  assert.equal(relevance.decision, "TOPIC_MISMATCH");
  assert.deepEqual(relevance.matchedTaskAnchors, []);
});

test("task-specific anchors match without relying on generic terms", () => {
  for (const text of ["AI video editing tool", "video automated rough cut system"]) {
    const relevance = assessTopicRelevance(text, videoPlan);
    assert.equal(relevance.decision, "MATCH", text);
    assert.ok(relevance.matchedDomainAnchors?.length);
    assert.ok(relevance.matchedTaskAnchors?.length);
    assert.notDeepEqual(relevance.matchedDomainAnchors, relevance.matchedTaskAnchors);
  }
});

test("domain and task anchors jointly admit matching video evidence", () => {
  for (const text of [
    "AI video editing tool release for automated rough cut workflows",
    "A paper directly studies shot selection for multi-asset video editing",
  ]) {
    const relevance = assessTopicRelevance(text, videoPlan);
    assert.equal(relevance.decision, "MATCH", text);
    assert.ok(relevance.matchedTerms.length >= 2);
  }
});

test("high reliability cannot override a topic mismatch", () => {
  const evaluation = evaluateEvidence(response([
    signal({
      title: "AI dataset for colorectal polyp detection",
      summary: "A primary medical imaging dataset paper.",
      topicRelevance: {
        decision: "TOPIC_MISMATCH",
        matchedTerms: [],
        score: 0,
      },
      reliabilityScore: 99,
      verificationStatus: "verified",
    }),
  ]), 1, 1);

  assert.equal(evaluation.sufficientEvidence, false);
  assert.equal(evaluation.decision, "STOP");
});

test("explicit topic profile does not fall back to generic query overlap", () => {
  const relevance = assessTopicRelevance("A generic AI model for multiple observations", videoPlan);
  assert.equal(relevance.decision, "TOPIC_MISMATCH");
  assert.equal(relevance.matchedQueryTerms?.includes("ai"), false);
  assert.equal(relevance.matchedGenericTerms?.includes("ai"), true);
  assert.equal(relevance.reason, "MISSING_DOMAIN_ANCHOR");
});

const calibrationPlan: QueryPlan = {
  ...videoPlan,
  topicProfile: {
    domainAnchors: ["AI video editing", "video production"],
    taskAnchors: ["AI video editing", "automated rough cut", "shot selection", "multi-asset understanding", "batch processing", "commercial workflow"],
    genericTerms: ["AI", "model", "multimodal", "observation", "workflow", "automation"],
  },
};

test("generic question terms cannot create positive relevance explanations", () => {
  for (const term of ["ai", "model", "video"]) {
    assert.equal(isGenericQuestionTerm(term), true, term);
  }
  assert.equal(isGenericQuestionTerm("video editing"), false);
});

test("AI video editing language variants pass while unrelated variants remain mismatches", () => {
  const variants = [
    "Palmier Pro - macOS video editor built for AI",
    "Launch HN: Mosaic (YC W25) - Agentic Video Editing",
    "Automated rough cut and multi-asset understanding for AI video editing",
  ];
  for (const text of variants) {
    const relevance = assessTopicRelevance(text, calibrationPlan);
    assert.equal(relevance.decision, "MATCH", text);
    assert.equal(relevance.relevanceGatePassed, true, text);
  }

  for (const text of [
    "Coding Agents with an Obstacle-Aware Harness for Safe Robot Manipulation",
    "Can 4D Foundation Models Remember?",
    "A general multimodal model for language, vision and audio understanding",
    "A multimodal research paper with no video editing or workflow task",
    "An endoscopic video dataset supports AI recognition of colorectal polyposis.",
  ]) {
    const relevance = assessTopicRelevance(text, calibrationPlan);
    assert.equal(relevance.decision, "TOPIC_MISMATCH", text);
    assert.equal(relevance.relevanceGatePassed, false, text);
  }
});

test("topic mismatch is rejected before knowledge persistence", async () => {
  const repository = new InMemorySignalRepository();
  const mismatched = signal({
    title: "AI dataset for colorectal polyp detection",
    topicRelevance: { decision: "TOPIC_MISMATCH", matchedTerms: [], score: 0 },
  });
  const result = await updateKnowledgeFromChanges({
    context: { authenticatedUserId: "user-1", filterId: "filter-1" },
    repository,
    response: response([mismatched]),
    changes: [{
      signalId: mismatched.id,
      classification: "NEW",
      supportingEvidenceIds: [],
      previousRevision: 0,
      currentRevision: 1,
      reason: "verified",
    }],
    runId: "run-1",
    now: "2026-09-17T00:00:00.000Z",
  });

  assert.deepEqual(result.evidenceIds, []);
  assert.deepEqual(result.persistedChanges, []);
  assert.equal(repository.listEvidence().length, 0);
});

test("topic mismatch exposes a stable filtering reason", () => {
  const summary = buildFilteringSummary({
    retrievedCount: 1,
    clusteredCount: 1,
    allSignals: [signal({
      topicRelevance: { decision: "TOPIC_MISMATCH", matchedTerms: [], score: 0 },
      attentionDecision: "IGNORE",
    })],
    displayedSignals: [],
  });

  assert.equal(summary.filteredReasons.topicMismatch, 1);
  assert.equal(summary.filteringDetails?.[0]?.reason, "TOPIC_MISMATCH");
});

// --- Bounded repair 2026-10-04 (requestId signals-baa5d0df-4300-4861-8eb0-2942b70ce640) ---
// The real run's legacy-path plan: topicProfile absent, industryKeywords carries the
// AI-expansion phrase "release notes". topicTerms tokenized it into the bare word
// "release", so every GitHub release title ("Release 0.162.0-alpha.11") matched and
// 20 unrelated coding-tool releases occupied the day queue.

const adobeVideoPlanLegacy: QueryPlan = {
  originalNeed: "过去30天，Adobe Premiere和After Effects有哪些值得我测试的AI剪辑更新？优先官方依据，说明具体变化、适用条件和可测试操作；未知事项明确标注。",
  coreKeywords: ["AI", "视频工具", "过去30天", "Adobe", "Premiere和After", "Effects有哪些值得我测试的AI剪辑更新", "优先官方依据", "说明具体变化", "适用条件和可测试操作", "未知事项明确标注", "Premiere", "After"],
  englishKeywords: [],
  synonyms: [],
  entities: ["Adobe", "Premiere", "After", "Effects"],
  aliasesConsidered: ["Adobe", "Premiere", "After", "Effects"],
  industryKeywords: ["AI 视频与创作者工具", "official documentation", "release notes", "research", "GitHub"],
  changeKeywords: [],
  knowledgeAwareQueries: [],
  searchCombinations: [],
  topicAnchors: [],
  topicKeywords: ["AI 视频与创作者工具", "AI 视频工具", "说明具体变化", "适用条件和可测试操作", "Adobe Premiere", "After Effects", "Adobe", "Premiere", "After", "Effects"],
  retrievalWindows: ["30d"],
  requestedFreshnessWindow: "30d",
} as QueryPlan;

test("document-type words cannot admit unrelated coding-tool releases (legacy path)", () => {
  for (const text of [
    // Real items that occupied the day queue of requestId signals-baa5d0df.
    "Release 0.162.0-alpha.11 Release 0.162.0-alpha.11",
    "Release Release v0.63.0-nightly.20260928.g2fe7c2d3f · google-gemini/gemini-cli · GitHub",
    // Same defect class observed in persisted knowledge: a bare releases index page.
    "Releases · Comfy-Org/ComfyUI",
  ]) {
    const relevance = assessTopicRelevance(text, adobeVideoPlanLegacy);
    assert.equal(relevance.decision, "TOPIC_MISMATCH", text);
    assert.equal(relevance.matchedTerms.length, 0, text);
    assert.equal(relevance.relevanceGatePassed, false, text);
  }
});

test("genuinely relevant Adobe material stays admissible for the same question", () => {
  const relevance = assessTopicRelevance(
    "Generate and create directly in your timeline with new AI-powered innovations in Premiere and After Effects Generative Media Tool Separate Crosstalk Dynamic Auto Ducking",
    adobeVideoPlanLegacy,
  );
  assert.equal(relevance.decision, "MATCH");
  assert.ok(relevance.matchedTerms.some((term) => /premiere|effects|after/i.test(term)));
});

test("broad questions still discover unspecified projects through content, not document-type words", () => {
  const broadPlan: QueryPlan = {
    originalNeed: "What new AI coding tools and CLI agents shipped recently that are worth testing?",
    coreKeywords: ["AI", "coding", "tools", "cli", "agents"],
    englishKeywords: [],
    synonyms: [],
    entities: [],
    aliasesConsidered: [],
    industryKeywords: ["AI coding tools", "GitHub"],
    changeKeywords: [],
    knowledgeAwareQueries: [],
    searchCombinations: [],
    topicAnchors: [],
    topicKeywords: ["AI coding tools", "CLI agents"],
    retrievalWindows: ["30d"],
    requestedFreshnessWindow: "30d",
  } as QueryPlan;
  // Broad discovery falls back to the default repo set; a release whose CONTENT
  // carries the question's topic must still pass, even though the project was
  // never named in the question.
  const relevance = assessTopicRelevance(
    "Release v0.64.0-nightly * fix(core): enable autonomous plan execution for the AI coding agent in non-interactive mode",
    broadPlan,
  );
  assert.equal(relevance.decision, "MATCH");
  assert.ok(relevance.matchedTerms.length > 0);
  assert.ok(!relevance.matchedTerms.includes("release"));
});
