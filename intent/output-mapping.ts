import type { ResearchResponse, ResearchSignal } from "../research/types.ts";
import { assessActionability } from "./actionability.ts";
import type { IntentMappedOutput, SourceProfile } from "./types.ts";

function evidenceStatus(signal: ResearchSignal): "FACT" | "INTERPRETATION" | "EARLY_SIGNAL" {
  if (signal.verificationStatus === "verified" && signal.independentEvidenceCount > 1) return "FACT";
  if (signal.sourceTier === "C" || signal.informationType === "SIGNAL" || signal.independentEvidenceCount < 2) return "EARLY_SIGNAL";
  return "INTERPRETATION";
}

export function mapIntentOutput(response: ResearchResponse, profile: SourceProfile): IntentMappedOutput {
  if (profile.outputMode === "JOB_SHORTLIST") {
    return {
      mode: "JOB_SHORTLIST",
      jobs: response.signals.map((signal) => ({
        role: signal.title,
        company: signal.publisher,
        location: signal.tags.find((tag) => /remote|北京|上海|深圳|杭州|US|China/i.test(tag)) || "未确认",
        postedAt: signal.publishedAt,
        matchReason: signal.whyItMatters || signal.summary,
        actionability: assessActionability({ intent: profile.intent, signal }).rating,
        source: signal.sourceUrl,
      })),
    };
  }
  if (profile.outputMode === "OPPORTUNITY_MAP") {
    return {
      mode: "OPPORTUNITY_MAP",
      opportunities: response.signals.map((signal) => ({
        opportunity: signal.title,
        confidence: signal.confidence,
        evidenceSignals: signal.claims.map((claim) => claim.claimText),
        supportingSources: signal.sources.map((source) => source.sourceUrl),
        risks: signal.verificationStatus === "conflicting" ? ["unresolved conflict"] : signal.independentEvidenceCount < 2 ? ["single signal only"] : [],
        status: evidenceStatus(signal),
      })),
    };
  }
  if (profile.outputMode === "TREND_BRIEF") {
    return {
      mode: "TREND_BRIEF",
      trends: response.signals.map((signal) => ({
        trend: signal.title,
        confidence: signal.confidence,
        evidenceSignals: signal.claims.map((claim) => claim.claimText),
        status: evidenceStatus(signal),
      })),
    };
  }
  if (profile.outputMode === "EVIDENCE_MATRIX") {
    return {
      mode: "EVIDENCE_MATRIX",
      rows: response.signals.flatMap((signal) => signal.claims.map((claim) => ({
        claim: claim.claimText,
        verificationStatus: claim.verificationStatus,
        sourceTier: claim.sourceTier,
        source: claim.sourceUrl,
      }))),
    };
  }
  return {
    mode: "GENERAL_BRIEF",
    items: response.signals.map((signal) => ({
      title: signal.title,
      status: signal.informationType,
      source: signal.sourceUrl,
    })),
  };
}
