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
};
