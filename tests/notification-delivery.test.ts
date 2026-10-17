import assert from "node:assert/strict";
import test from "node:test";

import { deliverAttention, retryPendingNotifications, collectDigest, notificationKey } from "../notification/delivery.ts";
import { decideDelivery } from "../notification/delivery-policy.ts";
import type { DeliveryAdapter } from "../notification/types.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";

const context = { authenticatedUserId: "notify-user", filterId: "notify-filter" };
const now = "2026-09-07T10:00:00.000Z";

function adapter(result: "delivered" | "failed" = "delivered", retryable = false, deliveredIds: string[] = []): DeliveryAdapter {
  return {
    channel: "TEST",
    deliver: (notification) => {
      deliveredIds.push(notification.id);
      return { status: result, retryable, failureSummary: result === "failed" ? "temporary delivery failure" : undefined };
    },
  };
}

test("DeliveryPolicy maps final attention without changing Attention Gate semantics", () => {
  assert.equal(decideDelivery({ finalAttention: "IGNORE" }).action, "SILENT");
  assert.equal(decideDelivery({ finalAttention: "STORE_ONLY" }).action, "SILENT");
  assert.equal(decideDelivery({ finalAttention: "LIBRARY_ONLY" }).action, "SILENT");
  assert.equal(decideDelivery({ finalAttention: "SURFACE" }).action, "IN_APP");
  assert.equal(decideDelivery({ finalAttention: "WORTH_WATCHING" }).action, "IN_APP");
  assert.equal(decideDelivery({ finalAttention: "SURFACE", userDeliveryPreference: "digest" }).action, "DIGEST");
  assert.equal(decideDelivery({ finalAttention: "MUST_READ", userDeliveryPreference: "digest" }).action, "IMMEDIATE");
});

test("same notificationKey is delivered once and later suppressed", async () => {
  const repository = new InMemorySignalRepository();
  const delivered: string[] = [];
  const first = await deliverAttention({
    context,
    repository,
    adapter: adapter("delivered", false, delivered),
    finalAttention: "MUST_READ",
    relatedEvidenceIds: ["e1"],
    relatedRevisionId: "rev-1",
    now,
  });
  const second = await deliverAttention({
    context,
    repository,
    adapter: adapter("delivered", false, delivered),
    finalAttention: "MUST_READ",
    relatedEvidenceIds: ["e1"],
    relatedRevisionId: "rev-1",
    now: "2026-09-07T10:01:00.000Z",
  });
  assert.equal(first.notification?.status, "DELIVERED");
  assert.equal(second.notification?.status, "SUPPRESSED");
  assert.equal(delivered.length, 1);
});

test("new revision and attention upgrade can notify again", async () => {
  const repository = new InMemorySignalRepository();
  const delivered: string[] = [];
  await deliverAttention({ context, repository, adapter: adapter("delivered", false, delivered), finalAttention: "SURFACE", relatedEvidenceIds: ["e1"], relatedRevisionId: "rev-1", now });
  await deliverAttention({ context, repository, adapter: adapter("delivered", false, delivered), finalAttention: "MUST_READ", relatedEvidenceIds: ["e1"], relatedRevisionId: "rev-1", now: "2026-09-07T10:01:00.000Z" });
  await deliverAttention({ context, repository, adapter: adapter("delivered", false, delivered), finalAttention: "MUST_READ", relatedEvidenceIds: ["e2"], relatedRevisionId: "rev-2", now: "2026-09-07T10:02:00.000Z" });
  assert.equal(delivered.length, 3);
  assert.equal(repository.listNotifications(context).filter((item) => item.status === "DELIVERED").length, 3);
});

test("repeated AgentRun and scheduler retry do not duplicate delivered notification", async () => {
  const repository = new InMemorySignalRepository();
  const delivered: string[] = [];
  const request = {
    context,
    repository,
    adapter: adapter("delivered", false, delivered),
    finalAttention: "MUST_READ" as const,
    goalId: "goal-1",
    relatedEvidenceIds: ["e1"],
    relatedRevisionId: "rev-1",
  };
  await deliverAttention({ ...request, now });
  await deliverAttention({ ...request, now: "2026-09-07T10:01:00.000Z" });
  await deliverAttention({ ...request, now: "2026-09-07T10:02:00.000Z" });
  assert.equal(delivered.length, 1);
});

test("retry reuses the same NotificationRecord and notificationKey", async () => {
  const repository = new InMemorySignalRepository();
  const failed = await deliverAttention({
    context,
    repository,
    adapter: adapter("failed", true),
    finalAttention: "MUST_READ",
    relatedEvidenceIds: ["e1"],
    relatedRevisionId: "rev-1",
    now,
  });
  assert.equal(failed.notification?.status, "PENDING");
  const key = failed.notification!.notificationKey;
  const id = failed.notification!.id;
  const retried = await retryPendingNotifications({
    context,
    repository,
    adapter: adapter("delivered"),
    now: "2026-09-07T10:01:00.000Z",
  });
  assert.equal(retried[0]?.id, id);
  assert.equal(retried[0]?.notificationKey, key);
  assert.equal(retried[0]?.status, "DELIVERED");
});

test("digest groups surface notifications by user, filter, and window while Must Read remains immediate", async () => {
  const repository = new InMemorySignalRepository();
  await deliverAttention({ context, repository, adapter: adapter(), finalAttention: "SURFACE", userDeliveryPreference: "digest", relatedEvidenceIds: ["e1"], now });
  await deliverAttention({ context, repository, adapter: adapter(), finalAttention: "SURFACE", userDeliveryPreference: "digest", relatedEvidenceIds: ["e2"], now: "2026-09-07T10:05:00.000Z" });
  const mustRead = await deliverAttention({ context, repository, adapter: adapter(), finalAttention: "MUST_READ", userDeliveryPreference: "digest", relatedEvidenceIds: ["e3"], now: "2026-09-07T10:06:00.000Z" });
  const digest = await collectDigest({ context, repository, windowId: "2026-09-07T10:00:00.000Z" });
  assert.equal(digest.length, 2);
  assert.equal(mustRead.decision.action, "IMMEDIATE");
  assert.equal(mustRead.notification?.status, "DELIVERED");
});

test("completed Goal can notify while waiting and blocked stay silent by default", async () => {
  const repository = new InMemorySignalRepository();
  const completed = await deliverAttention({ context, repository, adapter: adapter(), finalAttention: "MUST_READ", goalId: "goal-1", goalStatus: "completed", relatedEvidenceIds: ["e1"], now });
  const waiting = await deliverAttention({ context, repository, adapter: adapter(), finalAttention: "MUST_READ", goalId: "goal-2", goalStatus: "waiting", relatedEvidenceIds: ["e2"], now });
  const blocked = await deliverAttention({ context, repository, adapter: adapter(), finalAttention: "MUST_READ", goalId: "goal-3", goalStatus: "blocked", relatedEvidenceIds: ["e3"], now });
  assert.equal(completed.notification?.status, "DELIVERED");
  assert.equal(waiting.decision.action, "SILENT");
  assert.equal(blocked.decision.action, "SILENT");
});

test("repository rebuild keeps dedupe history", async () => {
  const repository = new InMemorySignalRepository();
  const key = notificationKey({ userId: context.authenticatedUserId, filterId: context.filterId, attention: "MUST_READ", relatedEvidenceIds: ["e1"], relatedRevisionId: "rev-1" });
  await deliverAttention({ context, repository, adapter: adapter(), finalAttention: "MUST_READ", relatedEvidenceIds: ["e1"], relatedRevisionId: "rev-1", now });
  const rebuilt = repository;
  assert.equal(rebuilt.getNotificationByKey(context, key)?.status, "DELIVERED");
  const duplicate = await deliverAttention({ context, repository: rebuilt, adapter: adapter(), finalAttention: "MUST_READ", relatedEvidenceIds: ["e1"], relatedRevisionId: "rev-1", now: "2026-09-07T10:01:00.000Z" });
  assert.equal(duplicate.notification?.status, "SUPPRESSED");
});

test("only one worker can claim and deliver a pending notification", async () => {
  const repository = new InMemorySignalRepository();
  const failed = await deliverAttention({ context, repository, adapter: adapter("failed", true), finalAttention: "MUST_READ", relatedEvidenceIds: ["e1"], relatedRevisionId: "rev-1", now });
  const first = repository.claimNotification(context, failed.notification!.id, "worker-a", "2026-09-07T10:05:00.000Z", "2026-09-07T10:01:00.000Z");
  const second = repository.claimNotification(context, failed.notification!.id, "worker-b", "2026-09-07T10:05:00.000Z", "2026-09-07T10:01:00.000Z");
  assert.ok(first);
  assert.equal(second, null);
});
