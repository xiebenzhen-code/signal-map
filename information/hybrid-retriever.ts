import {
  normalizeText,
  type ClaimRecord,
  type EventRecord,
  type EvidenceRecord,
  type PersonalKnowledgeRecord,
} from "./rag-records.ts";
import type { AuthenticatedFilterContext } from "./repositories/types.ts";

export type VectorScorer = {
  score(query: string, record: PersonalKnowledgeRecord): number;
};

export type RetrievalResult = {
  record?: PersonalKnowledgeRecord;
  recordId: string;
  recordType: "knowledge" | "event" | "claim" | "evidence";
  matchedText: string;
  lexicalScore: number;
  vectorScore?: number;
  fusedScore: number;
  sourceUrl?: string;
};

type SyncRagRepository = {
  listPersonalKnowledge(context: AuthenticatedFilterContext): PersonalKnowledgeRecord[];
  listEvents?(): EventRecord[];
  listClaims?(): ClaimRecord[];
  listEvidence?(): EvidenceRecord[];
};

type RetrievableRecord = {
  recordId: string;
  recordType: RetrievalResult["recordType"];
  matchedText: string;
  sourceUrl?: string;
  record?: PersonalKnowledgeRecord;
};

function terms(value: string) {
  return normalizeText(value).split(" ").filter(Boolean);
}

function lexicalScoreText(query: string, text: string) {
  const queryTerms = new Set(terms(query));
  const recordTerms = new Set(terms(text));
  const overlap = Array.from(queryTerms).filter((term) => recordTerms.has(term)).length;
  return queryTerms.size ? overlap / queryTerms.size : 0;
}

export class HybridRetriever {
  private repository: SyncRagRepository;
  private vectorScorer?: VectorScorer;

  constructor(
    repository: SyncRagRepository,
    vectorScorer?: VectorScorer,
  ) {
    this.repository = repository;
    this.vectorScorer = vectorScorer;
  }

  retrieve(context: AuthenticatedFilterContext, query: string) {
    const records: RetrievableRecord[] = [
      ...this.repository.listPersonalKnowledge(context).map((record) => ({
        recordId: record.id,
        recordType: "knowledge" as const,
        matchedText: record.text,
        record,
      })),
      ...(this.repository.listEvents?.() ?? []).map((record) => ({
        recordId: record.id,
        recordType: "event" as const,
        matchedText: `${record.canonicalTitle} ${record.entities.join(" ")} ${record.tags.join(" ")}`,
      })),
      ...(this.repository.listClaims?.() ?? []).map((record) => ({
        recordId: record.id,
        recordType: "claim" as const,
        matchedText: record.claimText,
      })),
      ...(this.repository.listEvidence?.() ?? []).map((record) => ({
        recordId: record.id,
        recordType: "evidence" as const,
        matchedText: record.evidenceSnippet,
        sourceUrl: record.sourceUrl,
      })),
    ];
    return this.retrieveFromRetrievableRecords(records, query);
  }

  retrieveFromRecords(records: PersonalKnowledgeRecord[], query: string): RetrievalResult[] {
    return this.retrieveFromRetrievableRecords(records.map((record) => ({
      recordId: record.id,
      recordType: "knowledge",
      matchedText: record.text,
      record,
    })), query);
  }

  private retrieveFromRetrievableRecords(records: RetrievableRecord[], query: string): RetrievalResult[] {
    return records
      .map((record) => {
        const lexical = lexicalScoreText(query, record.matchedText);
        const vector = record.record ? this.vectorScorer?.score(query, record.record) : undefined;
        const fused = vector === undefined
          ? lexical
          : (lexical * 0.5) + (vector * 0.5);
        return {
          record: record.record,
          recordId: record.recordId,
          recordType: record.recordType,
          matchedText: record.matchedText,
          lexicalScore: lexical,
          vectorScore: vector,
          fusedScore: fused,
          sourceUrl: record.sourceUrl,
        };
      })
      .filter((result) => result.fusedScore > 0)
      .sort((left, right) => right.fusedScore - left.fusedScore);
  }
}
