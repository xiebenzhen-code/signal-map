import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as todayCopy from "../information/today-copy.ts";

type NoticeInput = {
  loading: boolean;
  error: string;
  filterId: string;
  researchContextRevision: number;
  previousRun: { filterId: string; generatedFromResearchContextRevision: number } | null;
};
type Notice = { kind: "never_researched" | "stale"; message: string } | null;

function notice(overrides: Partial<NoticeInput> = {}): Notice {
  const resolve = (todayCopy as unknown as {
    todayContextNotice?: (input: NoticeInput) => Notice;
  }).todayContextNotice;
  assert.equal(typeof resolve, "function", "missing context-aware notice for the blank today view");
  return resolve!({
    loading: false, error: "", filterId: "filter-a", researchContextRevision: 2,
    previousRun: { filterId: "filter-a", generatedFromResearchContextRevision: 1 },
    ...overrides,
  });
}

test("a same-filter revision mismatch explains the hidden results", () => {
  const result = notice();
  assert.equal(result?.kind, "stale");
  assert.match(result!.message, /认知.*更新/);
  assert.match(result!.message, /重新过滤/);
});

test("no previous run invites first research rather than claiming cognition changed", () => {
  const result = notice({ previousRun: null });
  assert.equal(result?.kind, "never_researched");
  assert.doesNotMatch(result!.message, /认知.*更新/);
});

test("another filter's run cannot be labelled as this filter's stale knowledge", () => {
  assert.equal(notice({ previousRun: { filterId: "filter-b", generatedFromResearchContextRevision: 1 } })?.kind, "never_researched");
});

test("a current run has no empty-state notice", () => {
  assert.equal(notice({ researchContextRevision: 1 }), null);
});

test("research in progress suppresses stale and first-run notices", () => {
  assert.equal(notice({ loading: true }), null);
  assert.equal(notice({ loading: true, previousRun: null }), null);
});

test("request failure takes precedence over stale and first-run notices", () => {
  assert.equal(notice({ error: "Request failed" }), null);
  assert.equal(notice({ error: "Request failed", previousRun: null }), null);
});

test("restored failed research is explained as failure, not a successful blank or cognition change", () => {
  const result = notice({ researchContextRevision: 1, previousRun: { filterId: "filter-a", generatedFromResearchContextRevision: 1, ...({ status: "failed" } as object) } });
  assert.match(result?.message ?? "", /研究未完成/);
  assert.doesNotMatch(result?.message ?? "", /认知.*更新|没有需要/);
});

test("failed cached research takes precedence over a later context revision change", () => {
  const result = notice({ previousRun: { filterId: "filter-a", generatedFromResearchContextRevision: 1, ...({ status: "failed" } as object) } });
  assert.match(result?.message ?? "", /研究未完成/);
  assert.doesNotMatch(result?.message ?? "", /认知.*更新/);
});

// Render the actual status JSX from EventDetail, with controlled save states.
// This verifies UI output only; it does not simulate a real button or DB save.
const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const statusStart = pageSource.indexOf("{persistState?.pending &&");
const statusEnd = pageSource.indexOf("</section>", statusStart);
assert.ok(statusStart >= 0 && statusEnd > statusStart, "EventDetail must expose its feedback save status");
const statusJsx = pageSource.slice(statusStart, statusEnd);
const compiled = ts.transpileModule(
  `import React from 'react'; export default function Status({persistState}) { return <>${statusJsx}</>; }`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
).outputText;
const renderedModule = { exports: {} as { default?: React.ComponentType<{ persistState: unknown }> } };
new Function("require", "module", "exports", compiled)(createRequire(import.meta.url), renderedModule, renderedModule.exports);
function renderStatus(persistState: unknown) {
  return renderToStaticMarkup(createElement(renderedModule.exports.default!, { persistState }));
}

for (const errorCode of ["DB_TIMEOUT", "UNAUTHORIZED", "HTTP_400"]) {
  test(`a controlled ${errorCode} save failure shows local-only feedback and no account success`, () => {
    const html = renderStatus({ ok: false, errorCode });
    assert.match(html, /反馈保存失败/);
    assert.match(html, /本地草稿仍保留/);
    assert.match(html, /未写入账号长期记忆/);
    assert.doesNotMatch(html, /反馈已保存/);
  });
}

test("pending save is not rendered as account success", () => {
  const html = renderStatus({ pending: true });
  assert.match(html, /正在保存反馈/);
  assert.doesNotMatch(html, /反馈已保存|反馈保存失败/);
});

test("confirmed account success is distinct from failure", () => {
  const html = renderStatus({ ok: true, scope: "account" });
  assert.match(html, /反馈已保存到账号长期记忆/);
  assert.doesNotMatch(html, /反馈保存失败|正在保存反馈/);
});

test("no save attempt renders no save outcome", () => {
  assert.equal(renderStatus(null), "");
});
