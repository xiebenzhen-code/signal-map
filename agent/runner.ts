import { randomUUID } from "node:crypto";

import { runResearchPipeline } from "../research/research-pipeline.ts";
import type { ResearchResponse } from "../research/types.ts";
import { compareKnowledge, evaluateEvidence } from "./evaluation.ts";
import { persistResearchRecords, updateKnowledgeFromChanges } from "./knowledge-updater.ts";
import { createResearchPlan } from "./query-planner.ts";
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

function mergeResponseSourceOutcomes(previous: ResearchResponse | undefined, next: ResearchResponse) {
  if (!previous?.sourceOutcomes?.length) return next;
  const merged = new Map<string, NonNullable<ResearchResponse["sourceOutcomes"]>[number]>();
  for (const outcome of [...previous.sourceOutcomes, ...(next.sourceOutcomes ?? [])]) {
    const key = `${outcome.sourceType}:${outcome.providerId}`;
    const current = merged.get(key);
    merged.set(key, current
      ? {
          ...outcome,
          executed: current.executed || outcome.executed,
          resultCount: current.resultCount + outcome.resultCount,
          newEvidenceCount: current.newEvidenceCount + outcome.newEvidenceCount,
          newClaimCount: current.newClaimCount + outcome.newClaimCount,
          reliabilityGain: Math.max(current.reliabilityGain, outcome.reliabilityGain),
          conflictReduction: Math.max(current.conflictReduction, outcome.conflictReduction),
        }
      : outcome);
  }
  next.sourceOutcomes = [...merged.values()];
  return next;
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
  const add = (state: AgentState, status: AgentStep["status"], input: unknown, output: unknown, reason?: string) => {
    steps.push({ state, status, input, output });
    trace.push({ state, status, action: state.toLowerCase(), inputSummary: JSON.stringify(input).slice(0, 500), outputSummary: JSON.stringify(output).slice(0, 500), decisionReason: reason, timestamp: now() });
  };

  add("UNDERSTAND", "completed", { query: options.input.currentQuestions || options.input.industry }, { filterContext: "accepted" });
  const persistedKnowledge = options.repository && options.context
    ? await Promise.resolve(options.repository.listPersonalKnowledge(options.context))
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
  const bootstrapSelection = selectSource({
    strategy: bootstrapStrategy,
    availableSourceCapabilities: options.availableSourceCapabilities,
    sourceProfile,
  });
  add("SOURCE_SELECTOR", "completed", { round: 1, strategy: bootstrapStrategy }, bootstrapSelection, bootstrapSelection.reason);
  let plan = createResearchPlan(researchInput, 1, maxQueries, relatedKnowledge, bootstrapStrategy, bootstrapSelection, intent, sourceProfile);
  plan = await applyModelPlanning({
    plan,
    adapter: options.modelAdapter,
    userQuery: (options.userQuery ?? options.input.currentQuestions) || options.input.industry,
    relatedKnowledge,
    previousQueries: [],
    round: 1,
  });
  options.onPlan?.(plan, researchInput, 1);
  add("PLAN", "completed", { round: 1 }, plan);
  let response: ResearchResponse | undefined;
  let evaluation = evaluateEvidence({ signals: [], status: [], queryPlan: {} as never, progress: [], failures: [], counts: {} as never, overview: {} as never, coverage: {} as never, fetchedAt: now(), dataMode: "demo" }, 1, maxRounds);
  let allKnowledgeChanges: AgentRunResult["knowledgeChanges"] = [];
  let allEvidenceIds: string[] = [];
  let previousSourceOutcomes: SourceOutcome[] = [];
  let previousStrategies: ResearchStrategy[] = (previousRun?.strategies ?? []).filter((strategy): strategy is ResearchStrategy => [
    "STOP", "REFRESH", "DEEPEN", "BROADEN", "ESCALATE_SOURCE", "VERIFY_CONFLICT", "INITIAL",
  ].includes(strategy));
  let rounds = 0;
  for (let round = 1; round <= maxRounds; round += 1) {
    if (Date.now() - startedAt > (options.maxExecutionTimeMs ?? 30000)) break;
    rounds = round;
    add("RESEARCH", "completed", { round, plan }, { started: true });
    try {
      const executeResearch = (currentPlan: typeof plan) => (options.research ?? ((input, selectedPlan) => runResearchPipeline(input, undefined, undefined, {
        primarySourceType: selectedPlan.selectedSourceType,
        fallbackSourceTypes: selectedPlan.fallbackSourceTypes,
        allowedProviderIds: selectedPlan.allowedProviderIds,
        reason: selectedPlan.sourceSelectionReason,
      })))(researchInput, currentPlan, round);
      response = await executeResearch(plan);
      response.intent = intent;
      response.sourceProfile = sourceProfile;
      response.outputMode = sourceProfile.outputMode;
      response.intentOutput = mapIntentOutput(response, sourceProfile);
      if (!response.signals.length && plan.fallbackSourceTypes?.length) {
        const firstAttemptResponse = response;
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
        });
        if (fallbackSelection.primarySourceType && fallbackSelection.primarySourceType !== plan.selectedSourceType) {
          plan = createResearchPlan(researchInput, round, maxQueries, relatedKnowledge, plan.strategy, fallbackSelection, intent, sourceProfile);
          plan = await applyModelPlanning({
            plan,
            adapter: options.modelAdapter,
            userQuery: (options.userQuery ?? options.input.currentQuestions) || options.input.industry,
            relatedKnowledge,
            previousQueries: plan.queries,
            round,
          });
          add("SOURCE_SELECTOR", "completed", { round, fallback: true }, fallbackSelection, "首选来源无有效结果，执行 fallback 来源");
          response = await executeResearch(plan);
          response = mergeResponseSourceOutcomes(firstAttemptResponse, response);
          response.intent = intent;
          response.sourceProfile = sourceProfile;
          response.outputMode = sourceProfile.outputMode;
          response.intentOutput = mapIntentOutput(response, sourceProfile);
        }
      }
    } catch (error) {
      add("RESEARCH", "failed", { round }, { error: "research failed" }, error instanceof Error ? error.message : "unknown error");
      return { status: "failed", rounds, plan, evaluation, knowledgeChanges: [], attention: [], steps, trace };
    }
    add("RESEARCH", "completed", { round }, { signals: response.signals.length, dataMode: response.dataMode });
    const currentSourceOutcomes = sourceOutcomesFromResponse(response);
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
    const sourceSelection = selectSource({
      strategy: policy.strategy,
      availableSourceCapabilities: options.availableSourceCapabilities,
      previousSourceOutcomes,
      sourceProfile,
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
      const changes = compareKnowledge(response, researchInput.knownInformation, generatedFromRevision);
      const finalAttention = evaluation.conflictDetected
        ? []
        : response.signals.map((signal) => signal.attentionDecision);
      if (options.repository && options.context) {
        try {
          const updateResult = await updateKnowledgeFromChanges({
            context: options.context,
            repository: options.repository,
            response,
            changes,
            runId,
            now: now(),
          });
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
      }
      return { status, rounds, response, plan, evaluation, knowledgeChanges: allKnowledgeChanges, attention: finalAttention, steps, trace };
    }
    if (options.repository && options.context) {
      try {
        const evidenceOnly = await persistResearchRecords({ repository: options.repository, response });
        allEvidenceIds = Array.from(new Set([...allEvidenceIds, ...evidenceOnly.evidenceIds]));
        add("UPDATE_KNOWLEDGE", "skipped", { round }, { evidenceOnly: true, evidenceIds: evidenceOnly.evidenceIds }, "研究未结束，仅保存 Evidence provenance");
      } catch (error) {
        add("UPDATE_KNOWLEDGE", "failed", { round }, { error: "evidence persistence failed" }, error instanceof Error ? error.message : "unknown error");
        return { status: "failed", rounds, response, plan, evaluation, knowledgeChanges: allKnowledgeChanges, attention: [], steps, trace };
      }
    }
    plan = createResearchPlan(researchInput, round + 1, maxQueries, relatedKnowledge, policy.strategy, sourceSelection, intent, sourceProfile);
    plan = await applyModelPlanning({
      plan,
      adapter: options.modelAdapter,
      userQuery: (options.userQuery ?? options.input.currentQuestions) || options.input.industry,
      relatedKnowledge,
      previousQueries: plan.queries,
      round: round + 1,
    });
    options.onPlan?.(plan, researchInput, round + 1);
    add("PLAN", "completed", { round: round + 1 }, plan);
  }
  add("COMPLETE", "needs_more_evidence", { rounds }, { reason: "execution limit" });
  return { status: "needs_more_evidence", rounds, response, plan, evaluation, knowledgeChanges: [], attention: [], steps, trace };
}
