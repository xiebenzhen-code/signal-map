# Signal Map Architecture Contracts

This document records boundaries that must not drift when Signal Map moves between runtimes, hosts, or deployment channels.

## Agent Plan to Retrieval

- Agent owns semantic planning: intent, source selection, user-facing research objective, and final query list.
- `ResearchPlan` is an Agent-internal object.
- `RetrievalPlan` is the explicit cross-layer contract produced from `ResearchPlan`.
- Retrieval consumes `RetrievalPlan`; it does not own semantic query, intent, or source planning.
- Retrieval may perform deterministic adapter mapping: provider query slicing, fixed domain hints, and provider routing from `allowedProviderIds` / `selectedSourceType`.
- Retrieval must not reinterpret intent, source preference, or query semantics when a valid upstream `RetrievalPlan.queries` list exists.

## Runtime Migration Boundary

Runtime migration may change:

- hosting platform
- process model
- network path
- secrets injection
- database connection mechanism
- API reverse proxy or gateway

Runtime migration must not change:

- Intent semantics
- ResearchPlan semantics
- RetrievalPlan query list
- SourceSelection semantics
- Provider routing semantics
- Evidence contract
- Knowledge semantics
- Attention / filtering thresholds

## Fallback Rules

Pipeline fallback planning is allowed only when:

- no upstream `RetrievalPlan` is provided; or
- upstream `RetrievalPlan.queries` is missing, empty, or only whitespace.

When fallback planning happens, the trace must record:

- `fallbackUsed=true`
- `retrievalPlanSource=pipeline_fallback_plan`
- a concrete `fallbackReason`

When a valid upstream plan exists, the trace must record:

- `fallbackUsed=false`
- `retrievalPlanSource=upstream_agent_plan`
- `agentGeneratedQueries`
- `pipelineActualQueries`

`pipelineActualQueries` must match `agentGeneratedQueries`, except for explicit deterministic adapter mapping that is visible in trace.

## Multi-round Research Run State

- A round-local `ResearchResponse` may be replaced by retry or verification attempts inside the same round.
- Run-level cumulative state is owned by `ResearchRunState`.
- Run-level cumulative evidence, claims, sources, and source outcomes must be merged forward; a later round must not overwrite or clear earlier successful evidence.
- Verification rounds may upgrade metadata for an existing evidence item, such as verification status or reliability, but must not duplicate the same evidence identity.
- Provider failure or zero-result verification can lower confidence / keep `needs_more_evidence`, but must preserve previously collected evidence in the final run response.
- Final evaluation and final response must read from run-level cumulative state, not only the latest round-local response.

## Multi-round Budget Boundary

- Deadline and guard reads are owned by `BudgetManager`.
- `BudgetManager` does not choose research strategy, source routing, evidence thresholds, Knowledge updates, or Attention behavior.
- Current guard values remain `9000ms` before model planning and `4000ms` before retrieval.
- When run-level cumulative evidence already exists and the remaining budget is insufficient to safely start another planning round, AgentRunner may gracefully stop and return the cumulative response.
- A deadline after successful evidence collection must not clear cumulative evidence or be reported as an early source-selection failure.
- With no cumulative evidence, deadline failures must not fabricate evidence or a completed result.

## Required Contract Regression Tests

Any migration or Agent/Retrieval refactor must pass tests that prove:

- upstream `RetrievalPlan.queries` is consumed without self-planning;
- deterministic derived fields such as `englishKeywords`, `synonyms`, and `searchCombinations` are not required for upstream plan validity;
- missing or invalid upstream queries trigger fallback planning with trace metadata;
- source and provider routing survive plan resolution;
- `ResearchPlan -> RetrievalPlan` serialization preserves cross-layer semantics;
- runtime environment changes do not change query or routing semantics.
- round-local empty or failed verification does not clear run-level cumulative evidence;
- duplicate evidence can be verification-upgraded without double counting.
- existing cumulative evidence can gracefully complete when next-round planning budget is unsafe;
- deadline without cumulative evidence does not fabricate results.
