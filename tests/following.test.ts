import assert from "node:assert/strict";
import test from "node:test";

import { createFollowGoal, followGoalId, nextCheckAtForFollow, toFollowView } from "../agent/following.ts";
import { getControlFollows, createControlFollow } from "../backend/control-plane.ts";
import { handleBackendRequest } from "../backend/node-server.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";

const context = { authenticatedUserId: "follow-user-a", filterId: "follow-filter-a" };
const now = "2026-09-12T10:00:00.000Z";

test("follow topic becomes a waiting goal with a POLL resume condition", () => {
  const goal = createFollowGoal(context, {
    topic: "  AI 视频工具  ",
    intensity: "major_only",
    delivery: "weekly",
  }, now);

  assert.equal(goal.id, followGoalId(context, "AI 视频工具"));
  assert.equal(goal.status, "waiting");
  assert.equal(goal.watch?.resumeCondition.type, "POLL");
  assert.equal(goal.watch?.followTopic, "AI 视频工具");
  assert.equal(goal.watch?.followIntensity, "major_only");
  assert.equal(goal.watch?.deliveryPreference, "weekly");
  assert.equal(goal.completedCriteria.length, 0);
  assert.equal(goal.remainingCriteria.length, goal.successCriteria.length);
  assert.ok(goal.successCriteria.some((criterion) => criterion.includes("改变已有判断或行动")));
  assert.ok(goal.successCriteria.some((criterion) => criterion.includes("新机会")));
  assert.ok(goal.successCriteria.some((criterion) => criterion.includes("风险、价格、政策或产品能力变化")));
});

test("follow cadence sets a bounded next check time without exposing internal policy labels", () => {
  assert.equal(nextCheckAtForFollow("important", now), "2026-09-12T16:00:00.000Z");
  assert.equal(nextCheckAtForFollow("daily", now), "2026-09-13T10:00:00.000Z");
  assert.equal(nextCheckAtForFollow("weekly", now), "2026-09-19T10:00:00.000Z");

  const view = toFollowView(createFollowGoal(context, {
    topic: "DeepSeek 产品变化",
    intensity: "worth_knowing",
    delivery: "daily",
  }, now));

  assert.equal(view.intensityLabel, "值得知道时告诉我");
  assert.equal(view.deliveryLabel, "每日摘要");
  assert.doesNotMatch(JSON.stringify(view), /watch policy|novelty threshold|attention score|refresh interval|source coverage/i);
});

test("control follows persist through the existing Goal repository and stay tenant-scoped", async () => {
  const repository = new InMemorySignalRepository();
  const created = await createControlFollow({
    context,
    repository,
    follow: { topic: "AIGC 岗位", intensity: "more", delivery: "important" },
    now,
  });
  await createControlFollow({
    context: { authenticatedUserId: "follow-user-b", filterId: "follow-filter-a" },
    repository,
    follow: { topic: "Other account", intensity: "more", delivery: "important" },
    now,
  });

  const goals = await repository.listGoals(context);
  assert.equal(goals.length, 1);
  assert.equal(goals[0]?.id, created.goalId);
  assert.equal(goals[0]?.watch?.resumeCondition.target, "AIGC 岗位");

  const follows = await getControlFollows({ context, repository });
  assert.equal(follows.follows.length, 1);
  assert.equal(follows.follows[0]?.topic, "AIGC 岗位");
  assert.equal(follows.follows[0]?.deliveryLabel, "重要提醒");
});

test("follow API rejects unauthenticated writes and uses the same auth boundary as Control", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const response = await handleBackendRequest(new Request("http://localhost/api/control/follows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "AI 视频工具" }),
    }));

    assert.equal(response.status, 401);
  } finally {
    if (databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = databaseUrl;
  }
});
