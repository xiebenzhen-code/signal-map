import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseRegisteredFeed } from "../research/registered-feeds.ts";
import { selectRegisteredFeeds } from "../source-registry/feed-catalog.ts";

const source = readFileSync(new URL("../research/research-pipeline.ts", import.meta.url), "utf8");
const start = source.indexOf("function unique(items:");
const end = source.indexOf("\nfunction related(", start);
assert.ok(start >= 0 && end > start, "must exercise the actual pipeline deduplication function");
const compiled = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 });
const unique = new Function(`${compiled}; return unique;`)() as <T>(items: T[]) => T[];
const feed = selectRegisteredFeeds({entities: ["Chrome"], query: ""}).find(item => item.id === "chrome");
assert.ok(feed);
const entries = parseRegisteredFeed(readFileSync(new URL("./fixtures/d06-chrome.xml", import.meta.url), "utf8"), feed).entries;

// Exercise the ID expression actually used when building pipeline candidates,
// including its private helpers, rather than a separately exported test copy.
const idHelpers = source.slice(source.indexOf("function stableEventId("), source.indexOf("async function enrichDiscoveryCandidates("));
const idExpression = source.slice(source.indexOf("const primaryPresentation =")).match(/const id = ([^;]+);/)?.[1];
assert.ok(idExpression);
const candidateId = new Function(ts.transpile(`${idHelpers}\nreturn (item: ResearchCandidate) => ${idExpression};`,
  { target: ts.ScriptTarget.ES2022 }))() as (item: {url: string; title: string; source?: string; publishedAt?: string}) => string;

test("same-title announcements with distinct normalized links have distinct candidate IDs", () => {
  const [first, second] = entries.filter(item => item.title === "Stable Channel Update for Desktop"
    && /2026-10-(13|15)T/.test(item.publishedAt ?? ""));
  assert.ok(first && second, "real D06 fixture must contain both dated Stable announcements");
  assert.equal(first.title, second.title);
  assert.notEqual(first.url, second.url);
  assert.notEqual(candidateId(first), candidateId(second));
});

test("same normalized link keeps its candidate identity despite a changed title", () => {
  const first = entries[0];
  const repeated = {...first, title: "Changed title", url: first.url.replace("chromereleases.googleblog.com", "CHROMERELEASES.googleblog.com:80") + "#section"};
  assert.equal(candidateId(first), candidateId(repeated));
  assert.equal(unique([first, repeated]).length, 1);
});

test("candidate URL identity retains meaningful path case, punctuation and query", () => {
  const first = {...entries[0], url: "https://example.com/Release-a?version=1"};
  for (const url of ["https://example.com/release-a?version=1", "https://example.com/Releasea?version=1", "https://example.com/Release-a?version=2"]) {
    assert.notEqual(candidateId(first), candidateId({...first, url}));
  }
});

test("linkless candidate identity includes source, title and publication time", () => {
  const first = {url: "", source: "Official publisher", title: "Release announcement", publishedAt: "2026-10-13T00:00:00Z"};
  assert.equal(candidateId(first), candidateId({...first}));
  assert.notEqual(candidateId(first), candidateId({...first, source: "Other publisher"}));
  assert.notEqual(candidateId(first), candidateId({...first, publishedAt: "2026-10-15T00:00:00Z"}));
  assert.notEqual(candidateId(first), candidateId({...first, title: "Another announcement"}));
});

test("D06 chrome-14 and chrome-15 retain distinct clusters through candidate selection", () => {
  const directory = mkdtempSync(join(tmpdir(), "candidate-id-d06-"));
  try {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/eval-frozen.mjs", "--output-dir", directory], {encoding: "utf8", timeout: 30000});
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(readFileSync(join(directory, "results.json"), "utf8"));
    for (const run of result.cases) {
      const releases = [run.entries[13], run.entries[14]];
      assert.ok(releases.every(item => item.clusterId && item.destination !== "NOT_RETAINED_BEFORE_CLUSTER"), run.planMode);
      assert.equal(new Set(releases.map(item => item.clusterId)).size, 2, run.planMode);
      assert.equal(run.outsideWindowReturnedCardCount, 0);
    }
    assert.equal(result.networkRequests, 0);
    assert.equal(result.modelCalls, 0);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test("D06 same-title Stable Channel announcements on October 13 and 15 both survive", () => {
  const releases = entries.filter(item => item.title === "Stable Channel Update for Desktop"
    && /2026-10-(13|15)T/.test(item.publishedAt ?? ""));
  assert.equal(releases.length, 2, "real frozen fixture must contain both announcements");
  assert.equal(new Set(releases.map(item => item.url)).size, 2);
  assert.deepEqual(unique(releases), releases);
});

test("same normalized URL remains one candidate despite changed title or date", () => {
  const original = entries[0];
  const duplicate = {...original, title: "Changed headline", publishedAt: "2026-10-15T00:00:00Z",
    url: original.url.replace("chromereleases.googleblog.com", "CHROMERELEASES.googleblog.com:80") + "#section"};
  assert.deepEqual(unique([original, duplicate]), [original]);
});

test("distinct links and dates survive while exact repeated source entries collapse", () => {
  assert.equal(unique(entries).length, 25);
  assert.deepEqual(unique([entries[0], entries[0]]), [entries[0]]);
});
