import assert from "node:assert/strict";
import test from "node:test";

import {
  closePostgresPool,
  createPostgresRepository,
  databaseConfigured,
  getPostgresPool,
  runRagCoreMigration,
} from "../backend/postgres.ts";

const context = {
  authenticatedUserId: `integration-user-${Date.now()}`,
  filterId: "integration-filter",
};

test("real PostgreSQL migration and repository round trip", {
  skip: databaseConfigured() ? undefined : "DATABASE_URL not configured",
}, async () => {
  const pool = getPostgresPool();
  await runRagCoreMigration(pool);
  const repository = createPostgresRepository(pool);
  const now = new Date().toISOString();

  const record = await repository.addPersonalKnowledge(context, {
    type: "KNOWN_INFORMATION",
    text: "Integration test knowledge",
  }, now);
  const notification = await repository.saveNotification(context, {
    id: `integration-notification-${Date.now()}`,
    notificationKey: "integration-notification-key",
    userId: context.authenticatedUserId,
    filterId: context.filterId,
    attention: "MUST_READ",
    deliveryAction: "IMMEDIATE",
    relatedEvidenceIds: ["e1"],
    relatedRevisionId: "rev-1",
    status: "PENDING",
    createdAt: now,
  });
  const records = await repository.listPersonalKnowledge(context);
  const revision = await repository.getResearchContextRevision(context);
  const persistedNotification = await repository.getNotificationByKey(context, "integration-notification-key");
  const claimedNotification = await repository.claimNotification(context, notification.id, "worker-a", new Date(Date.parse(now) + 60_000).toISOString(), now);

  assert.equal(record.userId, context.authenticatedUserId);
  assert.equal(records.length, 1);
  assert.equal(records[0].text, "Integration test knowledge");
  assert.equal(revision, 2);
  assert.equal(persistedNotification?.relatedEvidenceIds[0], "e1");
  assert.equal(claimedNotification?.leaseOwner, "worker-a");
  assert.equal(await repository.getNotificationByKey({ authenticatedUserId: "other-user", filterId: context.filterId }, "integration-notification-key"), null);

  await pool.query(
    "DELETE FROM personal_knowledge WHERE user_id = $1 AND filter_id = $2",
    [context.authenticatedUserId, context.filterId],
  );
  await pool.query(
    "DELETE FROM notifications WHERE user_id = $1 AND filter_id = $2",
    [context.authenticatedUserId, context.filterId],
  );
  await pool.query(
    "DELETE FROM research_context_revisions WHERE user_id = $1 AND filter_id = $2",
    [context.authenticatedUserId, context.filterId],
  );
  await closePostgresPool();
});
