export type TimestampValidationStatus =
  | "valid"
  | "missing"
  | "future"
  | "metadata_conflict"
  | "suspected_retrieval_copy";

export type TimestampInput = {
  publishedAt?: string;
  eventOccurredAt?: string;
  retrievedAt?: string;
  metadataPublishedAt?: string;
};

export type FreshnessResult = {
  referenceAt?: string;
  referenceType?: "eventOccurredAt" | "publishedAt";
  ageHours?: number;
  label: string;
  score: number;
  timestampStatus: TimestampValidationStatus;
};

const HOUR = 60 * 60 * 1000;

function timestamp(value?: string) {
  if (!value) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function freshnessWindowHours(value: string) {
  const amount = Number.parseInt(value, 10);
  if (!Number.isFinite(amount)) return 24 * 7;
  if (/h|小时/i.test(value)) return amount;
  return amount * 24;
}

export function validateTimestamp(
  input: TimestampInput,
  now = new Date(),
): TimestampValidationStatus {
  const published = timestamp(input.publishedAt);
  const occurred = timestamp(input.eventOccurredAt);
  const effective = occurred ?? published;
  if (effective === undefined) return "missing";
  if (effective > now.getTime() + 5 * 60 * 1000) return "future";

  const metadata = timestamp(input.metadataPublishedAt);
  if (published !== undefined && metadata !== undefined && Math.abs(published - metadata) > 24 * HOUR) {
    return "metadata_conflict";
  }

  const retrieved = timestamp(input.retrievedAt);
  if (
    occurred === undefined &&
    published !== undefined &&
    retrieved !== undefined &&
    Math.abs(published - retrieved) < 1000
  ) {
    return "suspected_retrieval_copy";
  }
  return "valid";
}

function formatFreshness(ageHours: number) {
  if (ageHours < 0.5) return "刚刚";
  if (ageHours < 1.5) return "1小时前";
  if (ageHours < 24) return `${Math.max(1, Math.round(ageHours))}小时前`;
  const days = ageHours / 24;
  if (days < 2) return "24小时前";
  if (days < 30) return `${Math.max(2, Math.round(days))}天前`;
  const months = days / 30.44;
  if (months < 12) return `${Math.max(1, Math.round(months))}个月前`;
  return `${Math.max(1, Math.round(months / 12))}年前`;
}

function freshnessScore(ageHours: number) {
  if (ageHours <= 0.5) return 100;
  if (ageHours <= 1) return 96;
  if (ageHours <= 6) return 90;
  if (ageHours <= 24) return 80;
  if (ageHours <= 72) return 65;
  if (ageHours <= 168) return 48;
  if (ageHours <= 720) return 25;
  return 15;
}

export function resolveFreshness(
  input: TimestampInput,
  now = new Date(),
): FreshnessResult {
  const timestampStatus = validateTimestamp(input, now);
  if (timestampStatus !== "valid") {
    return { label: "发布时间未知", score: 0, timestampStatus };
  }
  const occurred = timestamp(input.eventOccurredAt);
  const published = timestamp(input.publishedAt);
  const reference = occurred ?? published;
  if (reference === undefined) {
    return { label: "发布时间未知", score: 0, timestampStatus: "missing" };
  }
  const ageHours = Math.max(0, (now.getTime() - reference) / HOUR);
  return {
    referenceAt: new Date(reference).toISOString(),
    referenceType: occurred !== undefined ? "eventOccurredAt" : "publishedAt",
    ageHours,
    label: formatFreshness(ageHours),
    score: freshnessScore(ageHours),
    timestampStatus,
  };
}

export function latestValidTimestamp(values: Array<string | undefined>, now = new Date()) {
  const valid = values
    .map(timestamp)
    .filter((value): value is number => value !== undefined && value <= now.getTime() + 5 * 60 * 1000);
  return valid.length ? new Date(Math.max(...valid)).toISOString() : undefined;
}

export function earliestValidTimestamp(values: Array<string | undefined>, now = new Date()) {
  const valid = values
    .map(timestamp)
    .filter((value): value is number => value !== undefined && value <= now.getTime() + 5 * 60 * 1000);
  return valid.length ? new Date(Math.min(...valid)).toISOString() : undefined;
}
