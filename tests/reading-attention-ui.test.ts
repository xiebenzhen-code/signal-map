import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";
import type { ResearchSignal } from "../research/types.ts";
const require = createRequire(import.meta.url);
function render(event: Partial<ResearchSignal>) {
  const file = new URL("../app/components/reading-attention.tsx", import.meta.url);
  assert.ok(existsSync(file), "reading attention renderer must exist");
  const js = ts.transpileModule(readFileSync(file, "utf8"), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const compiled = {exports: {} as {ReadingAttention: ComponentType<{event: Partial<ResearchSignal>}>}};
  new Function("require", "module", "exports", js)(require, compiled, compiled.exports);
  return renderToStaticMarkup(createElement(compiled.exports.ReadingAttention, {event}));
}
test("reading attention snapshot: default-closed messages retain title source date and original link", t => {
  const html = render({attentionDecision: "MUST_READ", actionabilityStatus: "TEST_NOW", relatedUpdates: [{id: "update", title: "Security update", publisher: "Official", publishedAt: "2026-10-19T08:00:00Z", sourceUrl: "https://official.example/release"} as ResearchSignal]});
  assert.match(html, /可立即试用/);
  assert.match(html, /同一对象的其他新消息/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:[\s=>])/);
  for (const text of ["Security update", "Official", "2026-10-19", 'href="https://official.example/release"']) assert.ok(html.includes(text));
  t.assert.snapshot(html);
});
test("early-signal copy is explicit and no-entry reading is not labeled testable", t => {
  const html = render({attentionDecision: "WORTH_WATCHING", actionabilityStatus: "REVIEW_FIRST"});
  assert.match(html, /24 小时内的早期线索/);
  assert.doesNotMatch(html, /可立即试用/);
  t.assert.snapshot(html);
});
test("homepage actually wires the attention renderer into cards", () => {
  assert.match(readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8"), /<ReadingAttention event=\{event\}/);
});
