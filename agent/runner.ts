import { randomUUID } from "node:crypto";

import { runResearchPipeline } from "../research/research-pipeline.ts";
import type { ResearchResponse } from "../research/types.ts";
import { BudgetManager, type BudgetSnapshot } from "./budget-manager.ts";
import { compareKnowledge, evaluateEvidence, reconcileInformationGain } from "./evaluation.ts";
import { persistResearchRecords, updateKnowledgeFromChanges } from "./knowledge-updater.ts";
import { createResearchPlan } from "./query-planner.ts";
import { ResearchRunState, mergeRoundAttempts, type EvidencePreservationSnapshot } from "./research-run-state.ts";
import { toRetrievalPlan } from "./retrieval-plan.ts";
import { chooseResearchStrategy } from "./research-policy.ts";
import { selectSource } from "./source-selector.ts";
import { classifyIntent } from "../intent/classifier.ts";
import { mapIntentOutput } from "../intent/output-mapping.ts";
import { sourceProfileForIntent } from "../intent/source-profiles.ts";
import type { AgentRunOptions, AgentRunResult, AgentState, AgentStep, AgentTraceEntry, ResearchStrategy, SourceOutcome } from "./types.ts";

const now = () => new Date().toISOString();

function appendLines(existing: string, values: string[]) {
  return [existing, ...values].map((value) => value.trim()).filter(Boolean).join("\n");
}

function sourceOutcomesFromResponse(response: ResearchResponse): SourceOutcome[] {
  if (response.sourceOutcomes?.length) {
    return response.sourceOutcomes.map((outcome) => ({
      sourceType: outcome.sourceType as SourceOutcome["sourceType"],
      providerId: outcome.providerId,
      resultCount: outcome.resultCount,
      requestCount: outcome.requestCount,
      newEvidenceCount: outcome.newEvidenceCount,
      newClaimCount: outcome.newClaimCount,
      reliabilityGain: outcome.reliabilityGain,
      conflictReduction: outcome.conflictReduction,
    }));
  }
  const signals = response.signals;
  const byType: Array<[SourceOutcome["sourceType"], ResearchResponse["signals"]]> = [
    ["OFFICIAL", signals.filter((signal) => signal.sourceTier === "S")],
    ["PRIMARY", signals.filter((signal) => signal.sourceType === "primary")],
    ["INDEPENDENT_MEDIA", signals.filter((signal) => signal.sourceType === "trusted_media" || signal.sourceType === "industry_media")],
    ["SOCIAL_SIGNAL", signals.filter((signal) => signal.sourceType === "social")],
    ["GENERAL_WEB", signals.filter((signal) => signal.sourceType !== "social")],
  ];
  return byType.map(([sourceType, items]) => ({
    sourceType,
    providerId: sourceType.toLowerCase(),
    resultCount: items.length,
    newEvidenceCount: items.filter((item) => item.knowledgeStatus !== "KNOWN").length,
    newClaimCount: items.reduce((count, item) => count + item.claims.length, 0),
    reliabilityGain: items.length ? Math.max(...items.map((item) => item.reliabilityScore)) : 0,
    conflictReduction: items.filter((item) => item.verificationStatus === "verified").length,
  }));
}

async function applyModelPlanning(options: {
  plan: AgentRunResult["plan"];
  adapter: AgentRunOptions["modelAdapter"];
  userQuery: string;
  relatedKnowledge: string[];
  previousQueries: string[];
  round: number;
}) {
  if (!options.adapter || options.adapter.status !== "configured") return options.plan;
  const result = await options.adapter.planResearch({
    userQuery: options.userQuery,
    relatedKnowledge: options.relatedKnowledge,
    existingEvidence: [],
    previousQueries: options.previousQueries,
    round: options.round,
  });
  if (result.status !== "configured" || !result.plan) return options.plan;
  const queries = [...result.plan.queries, ...options.plan.queries]
    .map((query) => query.trim())
    .filter((query, index, all) => query && all.indexOf(query) === index)
    .slice(0, options.plan.maxQueries);
  return {
    ...options.plan,
    objective: result.plan.objective || options.plan.objective,
    queries,
  };
}

export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  const maxRounds = Math.min(Math.max(options.maxRounds ?? 3, 1), 3);
  const maxQueries = Math.max(options.maxQueriesPerRound ?? 5, 1);
  const startedAt = Date.now();
  const startedAtIso = now();
  const runId = options.runId ?? `agent-run-${randomUUID()}`;
  const steps: AgentStep[] = [];
  const trace: AgentTraceEntry[] = [];
  let phaseContext: { round?: number; attemptId?: string; attemptType?: "primary" | "fallback" | "verification" } = {};
  const markPhase = (phase: string, success = true, itemCount?: number, errorCode?: string, diagnostic?: Record<string, unknown>) =>
    options.onPhase?.({ phase, ...phaseContext, success, itemCount, errorCode, diagnostic });
  const deadlineAt = options.deadlineAt ?? startedAt + (options.maxExecutionTimeMs ?? 30000);
  const budget = new BudgetManager({ deadlineAt });
  const add = (state: AgentState, status: AgentStep["status"], input: unknown, output: unknown, reason?: string) => {
    steps.push({ state, status, input, output });
    trace.push({ state, status, action: state.toLowerCase(), inputSummary: JSON.stringify(input).slice(0, 500), outputSummary: JSON.stringify(output).slice(0, 500), decisionReason: reason, timestamp: now() });
  };

  add("UNDERSTAND", "completed", { query: options.input.currentQuestions || options.input.industry }, { filterContext: "accepted" });
  const persistedKnowledge = options.repository && options.context
    ? await Promise.resolve(options.repository.listPersonalKnowledge(options.context))
    : [];
  const persistedEvidence = options.repository?.listEvidence
    ? await Promise.resolve(options.repository.listEvidence())
    : [];
  const previousRun = options.repository && options.context
    ? await Promise.resolve(options.repository.getLatestRunMetadata(options.context))
    : null;
  const relatedKnowledge = persistedKnowledge.map((record) => record.text);
  add("RETRIEVE", "completed", { query: options.userQuery ?? options.input.currentQuestions }, relatedKnowledge.join("\n") || "none");
  const intent = classifyIntent({
    userQuery: (options.userQuery ?? options.input.currentQuestions) || options.input.industry,
    filterContext: options.input,
    relatedKnowledge,
    currentGoal: options.currentGoal,
  });
  const sourceProfile = sourceProfileForIntent(intent.primaryIntent);
  add("INTENT", "completed", { query: options.userQuery ?? options.input.currentQuestions }, { intent, sourceProfile }, intent.reason);

  const researchInput = {
    ...options.input,
    knownInformation: appendLines(options.input.knownInformation, relatedKnowledge),
  };
  const generatedFromRevision = options.context && options.repository
    ? await Promise.resolve(options.repository.getResearchContextRevision(options.context))
    : options.initialRevision ?? 1;
  const bootstrapStrategy: ResearchStrategy = relatedKnowledge.length > 0 ? "REFRESH" : "INITIAL";
  let plan = createResearchPlan(researchInput, 1, maxQueries, relatedKnowledge, bootstrapStrategy, undefined, intent, sourceProfile);
  markPhase("source_selection_started");
  const bootstrapSelection = selectSource({
    strategy: bootstrapStrategy,
    availableSourceCapabilities: options.availableSourceCapabilities,
    sourceProfile,
    resolvedEntities: plan.resolvedEntities,
  });
  markPhase("source_selection_finished", true, bootstrapSelection.allowedProviderIds.length, undefined, {
    strategy: bootstrapStrategy,
    intent: intent.primaryIntent,
    discoveryMode: bootstrapSelection.discoveryMode,
    resolvedEntities: plan.resolvedEntities,
    selectedSourceType: bootstrapSelection.primarySourceType,
    fallbackSourceTypes: bootstrapSelection.fallbackSourceTypes,
    allowedProviderIds: bootstrapSelection.allowedProviderIds,
    verificationSourceTypes: bootstrapSelection.verificationSourceTypes,
    sourceGap: bootstrapSelection.sourceGap,
    reason: bootstrapSelection.reason,
    sourceSelectionReason: bootstrapSelection.reason,
  });
  add("SOURCE_SELECTOR", "completed", { round: 1, strategy: bootstrapStrategy }, bootstrapSelection, bootstrapSelection.reason);
  plan = {
    ...plan,
    selectedSourceType: bootstrapSelection.primarySourceType,
    fallbackSourceTypes: bootstrapSelection.fallbackSourceTypes,
    allowedProviderIds: bootstrapSelection.allowedProviderIds,
    reason: bootstrapSelection.reason,
    sourceSelectionReason: bootstrapSelection.reason,
  };
  let response: ResearchResponse | undefined;
  const runState = new ResearchRunState();
  let evaluation = evaluateEvidence({ signals: [], status: [], queryPlan: {} as never, progress: [], failures: [], counts: {} as never, overview: {} as never, coverage: {} as never, fetchedAt: now(), dataMode: "demo" }, 1, maxRounds);
  let allKnowledgeChanges: AgentRunResult["knowledgeChanges"] = [];
  let allEvidenceIds: string[] = [];
  let previousSourceOutcomes: SourceOutcome[] = [];
  let previousStrategies: ResearchStrategy[] = (previousRun?.strategies ?? []).filter((strategy): strategy is ResearchStrategy => [
    "STOP", "REFRESH", "DEEPEN", "BROADEN", "ESCALATE_SOURCE", "VERIFY_CONFLICT", "INITIAL",
  ].includes(strategy));
  let rounds = 0;
  const budgetDiagnostics = (snapshot: BudgetSnapshot, extra: Record<string, unknown> = {}) => ({
    remainingDeadlineMsBeforeRound: snapshot.remainingDeadlineMs,
    canStartModelPlanning: snapshot.canStartModelPlanning,
    canStartRetrieval: snapshot.canStartRetrieval,
    cumulativeEvidenceCount: runState.cumulativeEvidenceCount,
    finalEvidenceCount: runState.finalEvidenceCount,
    ...extra,
  });
  const completeWithCumulativeResponse = (round: number, reason: string, extra: Record<string, unknown> = {}): AgentRunResult => {
    const cumulativeResponse = runState.cumulativeResponse;
    if (!cumulativeResponse) {
      return { status: "failed", rounds, plan, evaluation, knowledgeChanges: allKnowledgeChanges, attention: [], steps, trace };
    }
    response = cumulativeResponse;
    evaluation = evaluateEvidence(response, round, maxRounds);
    const status = evaluation.sufficientEvidence ? "completed" : "needs_more_evidence";
    markPhase("agent_finished", true, response.signals.length, undefined, {
      deadlineDegradedGracefully: true,
      cumulativeEvidenceCount: runState.cumulativeEvidenceCount,
      finalEvidenceCount: runState.finalEvidenceCount,
      reason,
      ...extra,
    });
    add("COMPLETE", status === "completed" ? "completed" : "needs_more_evidence", { round }, {
      reason: evaluation.reason,
      carriedForwardEvidence: true,
      deadlineDegradedGracefully: true,
    });
    return { status, rounds, response, plan, evaluation, knowledgeChanges: allKnowledgeChanges, attention: [], steps, trace };
  };
  const prepareRoundResponse = (roundResponse: ResearchResponse) => {
    roundResponse.intent = intent;
    roundResponse.sourceProfile = sourceProfile;
    roundResponse.outputMode = sourceProfile.outputMode;
    roundResponse.intentOutput = mapIntentOutput(roundResponse, sourceProfile);
    return roundResponse;
  };
  const initialPlanningBudget = budget.snapshot();
  markPhase("budget_checked", true, undefined, undefined, budgetDiagnostics(initialPlanningBudget, { round: 1, stage: "initial_planning" }));
  if (initialPlanningBudget.canStartModelPlanning) {
    plan = await applyModelPlanning({
      plan,
      adapter: options.modelAdapter,
      userQuery: (options.userQuery ?? options.input.currentQuestions) || options.input.industry,
      relatedKnowledge,
      previousQueries: [],
      round: 1,
    });
  }
  options.onPlan?.(plan, researchInput, 1);
  markPhase("plan_finished", true, plan.queries.length, undefined, {
    round: 1,
    agentGeneratedQueries: plan.queries,
    selectedSourceType: plan.selectedSourceType,
    fallbackSourceTypes: plan.fallbackSourceTypes,
    allowedProviderIds: plan.allowedProviderIds,
    strategy: plan.strategy,
  });
  add("PLAN", "completed", { round: 1 }, plan);
  for (let round = 1; round <= maxRounds; round += 1) {
    if (Date.now() - startedAt > (options.maxExecutionTimeMs ?? 30000)) break;
    rounds = round;
    add("RESEARCH", "completed", { round, plan }, { started: true });
    let roundResponse: ResearchResponse | undefined;
    let preservation: EvidencePreservationSnapshot | undefined;
    const mergeAttemptResponse = (attemptResponse: ResearchResponse, attemptType: "primary" | "fallback") => {
      phaseContext = { round, attemptId: `round-${round}-${attemptType}`, attemptType };
      const snapshot = runState.mergeRoundResponse(attemptResponse);
      markPhase("evidence_preservation_finished", true, snapshot.cumulativeEvidenceCount, undefined, {
        round,
        attemptType,
        ...snapshot,
      });
      return snapshot;
    };
    try {
      const executeResearch = (currentPlan: typeof plan) => (options.research ?? ((input, selectedPlan) => runResearchPipeline(input, undefined, undefined, toRetrievalPlan(selectedPlan))))(researchInput, currentPlan, round);
      const retrievalBudget = budget.snapshot();
      markPhase("budget_checked", true, undefined, undefined, budgetDiagnostics(retrievalBudget, { round, stage: "retrieval" }));
      if (!retrievalBudget.canStartRetrieval) {
        throw Object.assign(new Error("Worker deadline budget exhausted before research"), { code: "WORKER_DEADLINE" });
      }
      phaseContext = { round, attemptId: `round-${round}-primary`, attemptType: "primary" };
      roundResponse = prepareRoundResponse(await executeResearch(plan));
      preservation = mergeAttemptResponse(roundResponse, "primary");
      if (!roundResponse.signals.length && plan.fallbackSourceTypes?.length) {
        const firstAttemptResponse = roundResponse;
        const fallbackSelection = selectSource({
          strategy: plan.strategy ?? "INITIAL",
          availableSourceCapabilities: plan.fallbackSourceTypes.map((type) => ({
            type,
            available: true,
            supportsFreshness: type !== "MEMORY",
            supportsPrimaryDocuments: type === "OFFICIAL" || type === "PRIMARY",
            supportsDomainFilter: type !== "MEMORY",
            supportsTimeFilter: type !== "MEMORY",
          })),
          sourceProfile,
          previousSourceOutcomes: [
            ...previousSourceOutcomes,
            {
              sourceType: plan.selectedSourceType!,
              providerId: plan.allowedProviderIds?.[0] ?? "unknown",
              resultCount: 0,
              newEvidenceCount: 0,
              newClaimCount: 0,
              reliabilityGain: 0,
              conflictReduction: 0,
            },
          ],
          resolvedEntities: plan.resolvedEntities,
        });
        if (fallbackSelection.primarySourceType && fallbackSelection.primarySourceType !== plan.selectedSourceType) {
          phaseContext = { round, attemptId: `round-${round}-fallback`, attemptType: "fallback" };
          plan = createResearchPlan(researchInput, round, maxQueries, relatedKnowledge, plan.strategy, fallbackSelection, intent, sourceProfile);
          const fallbackPlanningBudget = budget.snapshot();
          markPhase("budget_checked", true, undefined, undefined, budgetDiagnostics(fallbackPlanningBudget, { round, stage: "fallback_planning" }));
          if (fallbackPlanningBudget.canStartModelPlanning) {
            plan = await applyModelPlanning({
              plan,
              adapter: options.modelAdapter,
              userQuery: (options.userQuery ?? options.input.currentQuestions) || options.input.industry,
              relatedKnowledge,
              previousQueries: plan.queries,
              round,
            });
          }
          markPhase("plan_finished", true, plan.queries.length, undefined, {
            round,
            fallback: true,
            agentGeneratedQueries: plan.queries,
            selectedSourceType: plan.selectedSourceType,
            fallbackSourceTypes: plan.fallbackSourceTypes,
            allowedProviderIds: plan.allowedProviderIds,
            strategy: plan.strategy,
          });
          add("SOURCE_SELECTOR", "completed", { round, fallback: true }, fallbackSelection, "首选来源无有效结果，执行 fallback 来源");
          const fallbackRetrievalBudget = budget.snapshot();
          markPhase("budget_checked", true, undefined, undefined, budgetDiagnostics(fallbackRetrievalBudget, { round, stage: "fallback_retrieval" }));
          if (!fallbackRetrievalBudget.canStartRetrieval) {
            throw Object.assign(new Error("Worker deadline budget exhausted before fallback research"), { code: "WORKER_DEADLINE" });
          }
          phaseContext = { round, attemptId: `round-${round}-fallback`, attemptType: "fallback" };
          const fallbackResponse = prepareRoundResponse(await executeResearch(plan));
          preservation = mergeAttemptResponse(fallbackResponse, "fallback");
          roundResponse = prepareRoundResponse(mergeRoundAttempts(firstAttemptResponse, fallbackResponse));
        }
      }
    } catch (error) {
      const errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN_RESEARCH_FAILURE";
      const preservedResponse = runState.cumulativeResponse;
      if (errorCode === "WORKER_DEADLINE" && runState.cumulativeEvidenceCount > 0 && preservedResponse) {
        const snapshot = budget.snapshot();
        markPhase("budget_checked", false, runState.cumulativeEvidenceCount, errorCode, budgetDiagnostics(snapshot, {
          round,
          stage: "deadline_degrade_after_research_error",
          deadlineDegradedGracefully: true,
          skippedNextRoundDueToBudget: true,
        }));
        add("RESEARCH", "needs_more_evidence", { round }, { error: "deadline degraded gracefully" }, error instanceof Error ? error.message : "unknown error");
        return completeWithCumulativeResponse(round, "worker deadline after cumulative evidence", budgetDiagnostics(snapshot, {
          skippedNextRoundDueToBudget: true,
        }));
      }
      markPhase("agent_finished", false, undefined, errorCode);
      add("RESEARCH", "failed", { round }, { error: "research failed" }, error instanceof Error ? error.message : "unknown error");
      if (runState.cumulativeEvidenceCount > 0 && preservedResponse) {
        response = preservedResponse;
        evaluation = evaluateEvidence(response, round, maxRounds);
        const preservation = runState.providerFailureSnapshot();
        markPhase("evidence_preservation_finished", false, preservation.cumulativeEvidenceCount, undefined, {
          round,
          ...preservation,
        });
        const status = evaluation.sufficientEvidence ? "completed" : "needs_more_evidence";
        add("COMPLETE", status === "completed" ? "completed" : "needs_more_evidence", { round }, { reason: evaluation.reason, carriedForwardEvidence: true });
        return { status, rounds, response, plan, evaluation, knowledgeChanges: allKnowledgeChanges, attention: [], steps, trace };
      }
      return { status: "failed", rounds, plan, evaluation, knowledgeChanges: [], attention: [], steps, trace };
    }
    const cumulativeResponse = runState.cumulativeResponse;
    if (!cumulativeResponse) throw Object.assign(new Error("Missing cumulative response after round merge"), { code: "UNKNOWN_RESEARCH_FAILURE" });
    cumulativeResponse.intent = intent;
    cumulativeResponse.sourceProfile = sourceProfile;
    cumulativeResponse.outputMode = sourceProfile.outputMode;
    cumulativeResponse.intentOutput = mapIntentOutput(cumulativeResponse, sourceProfile);
    response = cumulativeResponse;
    reconcileInformationGain(response, persistedKnowledge, persistedEvidence);
    add("RESEARCH", "completed", { round }, {
      signals: response.signals.length,
      dataMode: response.dataMode,
      roundEvidenceCount: preservation?.roundEvidenceCount ?? 0,
      cumulativeEvidenceCount: preservation?.cumulativeEvidenceCount ?? runState.cumulativeEvidenceCount,
      carriedForwardEvidenceCount: preservation?.carriedForwardEvidenceCount ?? 0,
      verificationOutcome: preservation?.verificationOutcome ?? "no_evidence",
    });
    const currentSourceOutcomes = sourceOutcomesFromResponse(roundResponse);
    evaluation = evaluateEvidence(response, round, maxRounds);
    add("EVALUATE", evaluation.decision === "CONTINUE" ? "needs_more_evidence" : "completed", { round }, evaluation, evaluation.reason);
    const reliabilityState = response.signals.length === 0
      ? "unknown"
      : response.signals.every((signal) => signal.reliabilityScore >= 70) ? "high"
        : response.signals.some((signal) => signal.reliabilityScore >= 70) ? "mixed" : "low";
    const freshnessState = response.signals.length > 0 && response.signals.every((signal) => signal.eventStatus === "BACKGROUND")
      ? "stale" : response.signals.length > 0 ? "fresh" : "unknown";
    const policyInput = {
      currentEvidence: response,
      relatedKnowledge,
      conflictState: evaluation,
      sourceCoverage: response.coverage,
      freshnessState,
      reliabilityState,
      informationGain: evaluation.informationGain,
      round,
      maxRounds,
      previousStrategies,
    } as const;
    const policy = chooseResearchStrategy(policyInput);
    add("POLICY", "completed", {
      round,
      informationGain: evaluation.informationGain,
      sourceCoverage: response.coverage.level,
      reliabilityState,
      freshnessState,
    }, policy, policy.reason);
    phaseContext = { round, attemptId: `round-${round}-primary`, attemptType: "primary" };
    markPhase("source_selection_started");
    const sourceSelection = selectSource({
      strategy: policy.strategy,
      availableSourceCapabilities: options.availableSourceCapabilities,
      previousSourceOutcomes,
      sourceProfile,
      resolvedEntities: plan.resolvedEntities,
    });
    markPhase("source_selection_finished", true, sourceSelection.allowedProviderIds.length, undefined, {
      strategy: policy.strategy,
      intent: intent.primaryIntent,
      discoveryMode: sourceSelection.discoveryMode,
      resolvedEntities: plan.resolvedEntities,
      selectedSourceType: sourceSelection.primarySourceType,
      fallbackSourceTypes: sourceSelection.fallbackSourceTypes,
      allowedProviderIds: sourceSelection.allowedProviderIds,
      verificationSourceTypes: sourceSelection.verificationSourceTypes,
      sourceGap: sourceSelection.sourceGap,
      reason: sourceSelection.reason,
      sourceSelectionReason: sourceSelection.reason,
    });
    add("SOURCE_SELECTOR", policy.strategy === "STOP" ? "skipped" : "completed", { round, strategy: policy.strategy }, sourceSelection, sourceSelection.reason);
    trace[trace.length - 1].selectedSourceType = sourceSelection.primarySourceType;
    trace[trace.length - 1].fallbackSourceTypes = sourceSelection.fallbackSourceTypes;
    trace[trace.length - 1].sourceSelectionReason = sourceSelection.reason;
    trace[trace.length - 1].sourceOutcome = sourceSelection.primarySourceType
      ? currentSourceOutcomes.find((outcome) => outcome.sourceType === sourceSelection.primarySourceType)
      : undefined;
    add("STRATEGY", policy.strategy === "STOP" ? "completed" : "needs_more_evidence", { round }, policy, policy.reason);
    trace[trace.length - 1].strategy = policy.strategy;
    trace[trace.length - 1].strategyReason = policy.reason;
    trace[trace.length - 1].policyInputsSummary = JSON.stringify(policyInput).slice(0, 500);
    previousStrategies = [...previousStrategies, policy.strategy];
    previousSourceOutcomes = [...previousSourceOutcomes, ...currentSourceOutcomes];
    if (policy.strategy === "STOP") {
      const changes = compareKnowledge(
        response,
        researchInput.knownInformation,
        generatedFromRevision,
        persistedKnowledge,
        persistedEvidence,
      );
      const finalAttention = !evaluation.sufficientEvidence || evaluation.conflictDetected
        ? []
        : response.signals.map((signal) => signal.attentionDecision);
      if (options.repository && options.context) {
        try {
          markPhase("knowledge_started");
          const updateResult = await updateKnowledgeFromChanges({
            context: options.context,
            repository: options.repository,
            response,
            changes,
            runId,
            now: now(),
          });
          markPhase("knowledge_finished", true, updateResult.evidenceIds.length);
          allKnowledgeChanges = [...allKnowledgeChanges, ...updateResult.persistedChanges];
          allEvidenceIds = Array.from(new Set([...allEvidenceIds, ...updateResult.evidenceIds]));
        } catch (error) {
          add("UPDATE_KNOWLEDGE", "failed", { round }, { error: "knowledge update failed" }, error instanceof Error ? error.message : "unknown error");
          return { status: "failed", rounds, response, plan, evaluation, knowledgeChanges: allKnowledgeChanges, attention: [], steps, trace };
        }
      } else {
        allKnowledgeChanges = [...allKnowledgeChanges, ...changes];
      }
      add("UPDATE_KNOWLEDGE", "completed", { round }, { changes: changes.length });
      add("ATTENTION", "completed", { round }, { decisions: finalAttention });
      add("COMPLETE", "completed", { round }, { reason: evaluation.reason });
      const status = evaluation.sufficientEvidence ? "completed" : "needs_more_evidence";
      if (options.repository && options.context) {
        markPhase("persistence_started");
        await Promise.resolve(options.repository.saveRunMetadata(options.context, {
          id: runId,
          userQuery: options.userQuery,
          startedAt: startedAtIso,
          completedAt: now(),
          status,
          rounds,
          evidenceIds: allEvidenceIds,
          knowledgeChanges: allKnowledgeChanges,
          attentionResult: finalAttention,
          strategies: previousStrategies,
          trace,
          generatedFromResearchContextRevision: generatedFromRevision,
          dataMode: response.dataMode,
          createdAt: startedAtIso,
        }));
        markPhase("persistence_finished", true);
      }
      return { status, rounds, response, plan, evaluation, knowledgeChanges: allKnowledgeChanges, attention: finalAttention, steps, trace };
    }
    if (options.repository && options.context) {
      try {
        markPhase("knowledge_started");
        const evidenceOnly = await persistResearchRecords({ repository: options.repository, response: roundResponse });
        markPhase("knowledge_finished", true, evidenceOnly.evidenceIds.length);
        allEvidenceIds = Array.from(new Set([...allEvidenceIds, ...evidenceOnly.evidenceIds]));
        add("UPDATE_KNOWLEDGE", "skipped", { round }, { evidenceOnly: true, evidenceIds: evidenceOnly.evidenceIds }, "研究未结束，仅保存 Evidence provenance");
      } catch (error) {
        add("UPDATE_KNOWLEDGE", "failed", { round }, { error: "evidence persistence failed" }, error instanceof Error ? error.message : "unknown error");
        return { status: "failed", rounds, response, plan, evaluation, knowledgeChanges: allKnowledgeChanges, attention: [], steps, trace };
      }
    }
    phaseContext = { round: round + 1, attemptId: `round-${round + 1}-primary`, attemptType: "primary" };
    const nextRoundBudget = budget.snapshot();
    markPhase("budget_checked", true, runState.cumulativeEvidenceCount, undefined, budgetDiagnostics(nextRoundBudget, {
      round: round + 1,
      stage: "next_round_planning",
      skippedNextRoundDueToBudget: budget.shouldGracefullyStop(runState.cumulativeEvidenceCount),
    }));
    if (budget.shouldGracefullyStop(runState.cumulativeEvidenceCount)) {
      return completeWithCumulativeResponse(round, "insufficient budget before next round planning", budgetDiagnostics(nextRoundBudget, {
        skippedNextRoundDueToBudget: true,
      }));
    }
    plan = createResearchPlan(researchInput, round + 1, maxQueries, relatedKnowledge, policy.strategy, sourceSelection, intent, sourceProfile);
    const nextPlanningBudget = budget.snapshot();
    markPhase("budget_checked", true, runState.cumulativeEvidenceCount, undefined, budgetDiagnostics(nextPlanningBudget, {
      round: round + 1,
      stage: "model_planning",
    }));
    if (nextPlanningBudget.canStartModelPlanning) {
      try {
        plan = await applyModelPlanning({
          plan,
          adapter: options.modelAdapter,
          userQuery: (options.userQuery ?? options.input.currentQuestions) || options.input.industry,
          relatedKnowledge,
          previousQueries: plan.queries,
          round: round + 1,
        });
      } catch (error) {
        const errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN_RESEARCH_FAILURE";
        if (errorCode === "WORKER_DEADLINE" && runState.cumulativeEvidenceCount > 0) {
          const snapshot = budget.snapshot();
          markPhase("budget_checked", false, runState.cumulativeEvidenceCount, errorCode, budgetDiagnostics(snapshot, {
            round: round + 1,
            stage: "model_planning",
            deadlineDegradedGracefully: true,
            skippedNextRoundDueToBudget: true,
          }));
          return completeWithCumulativeResponse(round, "worker deadline during next round planning", budgetDiagnostics(snapshot, {
            skippedNextRoundDueToBudget: true,
          }));
        }
        throw error;
      }
    }
    options.onPlan?.(plan, researchInput, round + 1);
    markPhase("plan_finished", true, plan.queries.length, undefined, {
      round: round + 1,
      agentGeneratedQueries: plan.queries,
      selectedSourceType: plan.selectedSourceType,
      fallbackSourceTypes: plan.fallbackSourceTypes,
      allowedProviderIds: plan.allowedProviderIds,
      strategy: plan.strategy,
    });
    add("PLAN", "completed", { round: round + 1 }, plan);
  }
  add("COMPLETE", "needs_more_evidence", { rounds }, { reason: "execution limit" });
  return { status: "needs_more_evidence", rounds, response, plan, evaluation, knowledgeChanges: [], attention: [], steps, trace };
}
