import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
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
