import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverOfficialGithubReleases,
  discoverOfficialUpdatePages,
} from "../research/github-discovery.ts";
import { planQuery } from "../research/query-planner.ts";
import { buildSourceCoverage } from "../research/source-coverage.ts";
import { classifySource } from "../research/source-classifier.ts";

test("GitHub release discovery records a real execution outcome", async () => {
  const result = await discoverOfficialGithubReleases(
    ["Codex"],
    async () =>
      new Response(
        // The discovery now reads the releases LIST endpoint (newest first),
        // so the injected payload is an array of releases.
        JSON.stringify([
          {
            id: 42,
            name: "v1.2.0",
            tag_name: "v1.2.0",
            html_url: "https://github.com/openai/codex/releases/tag/v1.2.0",
            body: "Adds a new developer-facing limitation.",
            published_at: "2026-08-28T08:00:00.000Z",
          },
        ]),
        { status: 200 },
      ),
  );

  assert.equal(result.outcome.source, "GitHub Releases");
  assert.equal(result.outcome.execution, "searched_with_results");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].origin, "github");
  assert.equal(result.items[0].publishedAt, "2026-08-28T08:00:00.000Z");
});

test("a tracked product entity discovers its official changelog without a benchmark query", async () => {
  const plan = planQuery({
    identity: "",
    industry: "AI developer tools",
    focusAreas: "AI coding agents, Codex, Claude Code, developer tooling, recent releases, limitations, workflow changes",
    currentQuestions: "What changed in AI coding agent workflows?",
    knownInformation: "Codex is available",
    informationGaps: "recent releases, limitations, workflow changes",
    trackedEntities: "Codex, Claude Code",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: "7d",
  });
  assert.equal(plan.requestedFreshnessWindow, "7d");
  assert.ok(plan.searchCombinations.includes("Claude Code release notes changelog"));

  const result = await discoverOfficialUpdatePages(
    plan.entities,
    async (input) => {
      assert.equal(input, "https://code.claude.com/docs/en/changelog");
      return new Response(
        `<!doctype html><html><head><title>Claude Code changelog</title></head>
        <body><main><h2>Latest release</h2><p>August 28, 2026</p>
        <p>Reliability improvements for developer workflows.</p></main></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    },
  );

  assert.equal(result.outcome.execution, "searched_with_results");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].url, "https://code.claude.com/docs/en/changelog");
  assert.equal(result.items[0].origin, "official");
  assert.equal(result.items[0].publishedAt, new Date("August 28, 2026").toISOString());
});

test("community and developer pages classify as social discovery, not primary evidence", () => {
  assert.equal(
    classifySource("Community.OpenAI.com", "https://community.openai.com/t/example/1"),
    "social",
  );
  assert.equal(
    classifySource("GitHub Discussions", "https://github.com/openai/codex/discussions/1"),
    "social",
  );
  assert.equal(
    classifySource("Hacker News", "https://news.ycombinator.com/item?id=1"),
    "social",
  );
  assert.equal(
    classifySource("Stack Overflow", "https://stackoverflow.com/questions/1"),
    "social",
  );
});

test("a missing X credential does not reduce coverage from GitHub, Reddit, and Public Web", () => {
  const coverage = buildSourceCoverage([
    { source: "X", execution: "not_configured", searched: false, resultCount: 0 },
    { source: "GitHub Releases", execution: "searched_with_results", searched: true, resultCount: 1 },
    { source: "Reddit", execution: "searched_no_results", searched: true, resultCount: 0 },
    { source: "Public Web Community", execution: "searched_with_results", searched: true, resultCount: 2 },
  ]);

  assert.equal(coverage.level, "Broad");
  assert.deepEqual(coverage.usedProviders, ["GitHub Releases", "Reddit", "Public Web Community"]);
  assert.deepEqual(coverage.notConfiguredProviders, ["X"]);
});
