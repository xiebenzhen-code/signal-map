import assert from "node:assert/strict";
import test from "node:test";
import { deduplicateSocialEvidence } from "../social/evidence-dedup.ts";

const signal = (id: string, title: string, url: string) => ({
  id,
  title,
  url,
  snippet: title,
  source: "X",
  publishedAt: "2026-08-28T08:00:00.000Z",
  retrievedAt: "2026-08-28T09:00:00.000Z",
  dataOrigin: "live" as const,
  channel: "社区" as const,
  authority: 60,
  origin: "x" as const,
});

test("copy and quote variants share one social evidence chain", () => {
  const result = deduplicateSocialEvidence([
    signal("1", "OpenAI launches an Agent safety update", "https://x.com/a/status/1"),
    signal("2", "Quote: OpenAI launches Agent safety update", "https://x.com/b/status/2"),
    signal("3", "OpenAI launches an Agent safety update", "https://x.com/c/status/3"),
  ]);

  assert.equal(result.representatives.length, 1);
  assert.equal(result.chains.length, 1);
  assert.equal(result.independentEvidenceCount, 1);
  assert.equal(result.chains[0].propagationCount, 3);
});

test("separate evidence chains remain independently countable while propagation does not inflate them", () => {
  const result = deduplicateSocialEvidence([
    signal("1", "OpenAI launches an Agent safety update", "https://x.com/a/status/1"),
    signal("2", "OpenAI launches an Agent safety update", "https://x.com/b/status/2"),
    signal("3", "OpenAI releases an API pricing update", "https://x.com/c/status/3"),
  ]);

  assert.equal(result.chains.length, 2);
  assert.equal(result.independentEvidenceCount, 2);
  assert.equal(result.chains[0].propagationCount, 2);
});
