export type SourceCapabilityRole = "DISCOVERY" | "EVIDENCE" | "BOTH";

export type DetailEnrichmentStatus =
  | "SUCCESS"
  | "NO_DETAIL"
  | "FETCH_FAILED"
  | "UNSUPPORTED"
  | "TOO_THIN";

export type DetailEnrichmentInput = {
  providerId: string;
  canonicalId?: string;
  url?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  /** Absolute epoch-ms deadline shared by search, body fetch, and response reading. */
  deadlineAt?: number;
};

export type DetailEnrichmentResult = {
  status: DetailEnrichmentStatus;
  canonicalUrl?: string;
  title?: string;
  publishedAt?: string;
  rawContent?: string;
  contentType?: "html" | "markdown" | "metadata";
  discoveredBy: string;
  evidenceFrom?: string;
  officialUrl?: string;
  /** Actual HTTP requests issued for this candidate (search + body fetch), distinct from the candidate count. */
  fetchCalls?: number;
};

export type DetailEnrichmentMetadata = {
  attempted: boolean;
  status: DetailEnrichmentStatus;
  discoveredBy: string;
  evidenceFrom?: string;
  canonicalUrl?: string;
};

export type DetailEnrichmentSummary = {
  detailAttempted: number;
  detailSucceeded: number;
  detailFailed: number;
  stillInsufficient: number;
  /** Actual HTTP requests issued across all candidates (kept separate from detailAttempted). */
  detailFetchCalls?: number;
};
