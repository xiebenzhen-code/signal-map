import type { EvidenceRecord } from "../information/rag-records.ts";
import type { VerificationStatus } from "../research/types.ts";
import type { AgentRunResult } from "./types.ts";

export type EvidenceBoundConclusion = {
  claim: string;
  evidenceIds: string[];
  sourceUrls: string[];
  confidence: number;
  verificationStatus: VerificationStatus;
  statementType: "FACT" | "INTERPRETATION" | "SIGNAL";
};

export type EvidenceBoundSynthesis = {
  summary: string;
  conclusions: EvidenceBoundConclusion[];
  unresolvedItems: string[];
};

export type EvidenceSynthesisInput = {
  objective: string;
  evidence: EvidenceRecord[];
  taskResults: Array<{ taskId: string; result?: AgentRunResult; error?: string }>;
  unresolvedConflicts: string[];
  eligibleEvidenceIds?: string[];
  reliableEvidence?: EvidenceRecord[];
  signalOnly?: boolean;
  unresolvedConflict?: boolean;
  synthesisInstruction?: string;
};

type EvidenceSynthesisAdapter = {
  synthesizeEvidence(input: EvidenceSynthesisInput): Promise<
    | { status: "configured"; synthesis: EvidenceBoundSynthesis }
    | { status: "not_configured" | "error"; errorCode?: string }
  >;
};

export function noReliableEvidenceSynthesis(): EvidenceBoundSynthesis {
  return {
    summary: "No reliable evidence found.",
    conclusions: [],
    unresolvedItems: [],
  };
}

function hasReliableEvidence(evidence: EvidenceRecord[]) {
  return evidence.some((record) =>
    record.sourceType !== "social" &&
    record.sourceTier !== "C" &&
    record.verificationStatus !== "conflicting" &&
    record.verificationStatus !== "unverified",
  );
}

function buildSynthesisContract(input: EvidenceSynthesisInput) {
  const reliableEvidence = input.evidence.filter((record) =>
    record.sourceType !== "social" &&
    record.sourceTier !== "C" &&
    record.verificationStatus !== "conflicting" &&
    record.verificationStatus !== "unverified",
  );
  return {
    ...input,
    eligibleEvidenceIds: reliableEvidence.map((record) => record.id),
    reliableEvidence,
    signalOnly: input.evidence.length > 0 && reliableEvidence.length === 0 && !input.unresolvedConflicts.length,
    unresolvedConflict: input.unresolvedConflicts.length > 0 || input.evidence.some((record) => record.verificationStatus === "conflicting"),
  };
}

function isUnderclaim(synthesis: EvidenceBoundSynthesis, contract: ReturnType<typeof buildSynthesisContract>) {
  return contract.reliableEvidence.length > 0 && synthesis.summary.trim().toLowerCase() === "no reliable evidence found." && !synthesis.conclusions.some((item) => item.statementType === "FACT");
}

function hasConflictStateMismatch(synthesis: EvidenceBoundSynthesis, contract: ReturnType<typeof buildSynthesisContract>) {
  if (!contract.unresolvedConflict) return false;
  return synthesis.conclusions.some((item) => item.statementType === "FACT" || item.verificationStatus !== "conflicting") || !synthesis.unresolvedItems.length;
}

function unresolvedConflictFallback(input: EvidenceSynthesisInput, fallback: () => EvidenceBoundSynthesis) {
  const result = fallback();
  return {
    ...result,
    summary: /conflict|unresolved/i.test(result.summary) ? result.summary : "Conflicting evidence remains unresolved.",
    unresolvedItems: Array.from(new Set([...result.unresolvedItems, ...input.unresolvedConflicts, "Conflicting evidence remains unresolved."])),
    conclusions: result.conclusions.map((item) => ({ ...item, statementType: item.statementType === "FACT" ? "INTERPRETATION" as const : item.statementType, verificationStatus: "conflicting" as const })),
  };
}

function reliableEvidenceFallback(input: EvidenceSynthesisInput, fallback: () => EvidenceBoundSynthesis, reliableEvidence: EvidenceRecord[]) {
  const result = fallback();
  if (result.conclusions.length > 0) return result;
  const supporting = reliableEvidence[0];
  if (!supporting) return result;
  return {
    ...result,
    summary: supporting.evidenceSnippet,
    conclusions: [{
      claim: supporting.evidenceSnippet,
      evidenceIds: [supporting.id],
      sourceUrls: [supporting.sourceUrl],
      confidence: 0,
      verificationStatus: supporting.verificationStatus,
      statementType: "FACT" as const,
    }],
  };
}

function evidenceById(evidence: EvidenceRecord[]) {
  return new Map(evidence.map((item) => [item.id, item]));
}

export function validateEvidenceBoundSynthesis(
  synthesis: EvidenceBoundSynthesis,
  evidence: EvidenceRecord[],
): EvidenceBoundSynthesis {
  const byId = evidenceById(evidence);
  for (const conclusion of synthesis.conclusions) {
    if (conclusion.statementType === "FACT" && conclusion.evidenceIds.length === 0) {
      throw new Error("FACT requires evidenceIds");
    }
    const referenced = conclusion.evidenceIds.map((id) => {
      const record = byId.get(id);
      if (!record) throw new Error(`unknown evidenceId: ${id}`);
      return record;
    });
    if (referenced.some((record) => record.sourceType === "social" || record.sourceTier === "C") && conclusion.statementType !== "SIGNAL") {
      throw new Error("social evidence can only support SIGNAL");
    }
    if (referenced.some((record) => record.verificationStatus === "conflicting") && conclusion.verificationStatus !== "conflicting") {
      throw new Error("conflicting evidence must remain conflicting");
    }
  }
  return synthesis;
}

export async function synthesizeEvidenceWithModel(input: {
  adapter: EvidenceSynthesisAdapter;
  input: EvidenceSynthesisInput;
  fallback: () => EvidenceBoundSynthesis;
}) {
  const contract = buildSynthesisContract(input.input);
  if (!hasReliableEvidence(input.input.evidence) && !contract.unresolvedConflict) return noReliableEvidenceSynthesis();
  let modelResult = await input.adapter.synthesizeEvidence(contract);
  if (modelResult.status !== "configured") {
    return validateEvidenceBoundSynthesis(contract.unresolvedConflict ? unresolvedConflictFallback(input.input, input.fallback) : reliableEvidenceFallback(input.input, input.fallback, contract.reliableEvidence), input.input.evidence);
  }
  let synthesis = modelResult.synthesis;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const underclaim = isUnderclaim(synthesis, contract);
      const conflictMismatch = hasConflictStateMismatch(synthesis, contract);
      if (underclaim || conflictMismatch) {
        if (attempt === 0) {
          modelResult = await input.adapter.synthesizeEvidence({ ...contract, synthesisInstruction: underclaim
            ? "Reliable eligible evidence exists. Return a FACT supported only by eligibleEvidenceIds."
            : "Unresolved conflict exists. Preserve conflicting/unresolved state and do not return a confirmed FACT." });
          if (modelResult.status !== "configured") break;
          synthesis = modelResult.synthesis;
          continue;
        }
        return validateEvidenceBoundSynthesis(conflictMismatch ? unresolvedConflictFallback(input.input, input.fallback) : reliableEvidenceFallback(input.input, input.fallback, contract.reliableEvidence), input.input.evidence);
      }
      return validateEvidenceBoundSynthesis(synthesis, input.input.evidence);
    } catch {
      return validateEvidenceBoundSynthesis(input.fallback(), input.input.evidence);
    }
  }
  return validateEvidenceBoundSynthesis(contract.unresolvedConflict ? unresolvedConflictFallback(input.input, input.fallback) : reliableEvidenceFallback(input.input, input.fallback, contract.reliableEvidence), input.input.evidence);
}
