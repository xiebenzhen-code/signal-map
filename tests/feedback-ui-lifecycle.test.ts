import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createRequire } from "node:module";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let feedbackCallback = "";
let detailSource = "";
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "EventDetail") detailSource = node.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "applyFeedback" && node.initializer && ts.isCallExpression(node.initializer)) {
    feedbackCallback = node.initializer.arguments[0].getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(feedbackCallback);

test("actual feedback callback keeps the selected detail available for async save status", () => {
  const js = ts.transpileModule(`const callback = ${feedbackCallback}; return callback;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let selected: unknown = { id: "event-1" };
  let draft = { userJudgements: [] as string[], evidenceHistory: [] as string[] };
  const callback = new Function("setKnowledge", "saveEvent", "setFeedbackRecords", "setSelected", "unique", "crypto", js)(
    (update: (current: unknown) => unknown) => { draft = update(draft) as typeof draft; },
    () => {}, () => {}, (next: unknown) => { selected = next; },
    (values: string[]) => [...new Set(values)], { randomUUID: () => "feedback-1" },
  );
  callback({ id: "event-1", title: "具体变化" }, "changed_view");
  assert.deepEqual(draft.userJudgements, ["Changed after evidence: 具体变化"]);
  assert.deepEqual(selected, { id: "event-1" }, "closing the modal removes pending/success/failure status before it can render");
});

for (const outcome of [{ ok: true, scope: "account" }, { ok: false, errorCode: "DB_TIMEOUT" }]) {
  test(`actual detail button retains pending and ${outcome.ok ? "success" : "failure"} UI after feedback`, async () => {
    const state: unknown[] = [];
    let cursor = 0;
    const useState = (initial: unknown) => {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value: unknown) => { state[index] = value; }];
    };
    const compiled = ts.transpileModule(`${detailSource}\nexport default EventDetail;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const mod = { exports: {} as { default: (props: unknown) => ReactElement } };
    new Function("require", "module", "exports", "useState", "statusTone", "verificationLabels", "eventStatusLabels", "X", compiled)(
      createRequire(import.meta.url), mod, mod.exports, useState,
      { verified: "" }, { verified: "已验证" }, { NEW: "新增" }, () => createElement("span"),
    );
    const fixture = JSON.parse(readFileSync(new URL("../docs/reliability/offline-page-fixtures/software-release.json", import.meta.url), "utf8"));
    let resolve!: (result: typeof outcome) => void;
    const promise = new Promise<typeof outcome>((done) => { resolve = done; });
    let clicks = 0;
    const props = { event: fixture.signals[0], saved: false, initialNote: "", onClose() {}, onSave() {}, onFeedback() { clicks++; }, onFeedbackPersist: () => promise };
    const render = () => { cursor = 0; return mod.exports.default(props); };
    const findButton = (value: unknown): { onClick: () => void } | undefined => {
      if (Array.isArray(value)) return value.map(findButton).find(Boolean);
      if (!value || typeof value !== "object") return;
      const element = value as { type?: string; props?: { children?: unknown; onClick?: () => void } };
      if (element.type === "button" && element.props?.children === "改变了我的看法") return element.props as { onClick: () => void };
      return findButton(element.props?.children);
    };
    findButton(render())!.onClick();
    assert.equal(clicks, 1);
    assert.match(renderToStaticMarkup(render()), /正在保存反馈/);
    resolve(outcome);
    await promise;
    await Promise.resolve();
    const html = renderToStaticMarkup(render());
    if (outcome.ok) assert.match(html, /反馈已保存到账号长期记忆/);
    else {
      assert.match(html, /反馈保存失败.*服务暂时不可用/);
      assert.match(html, /本地草稿仍保留，但未写入账号长期记忆/);
      assert.doesNotMatch(html, /反馈已保存/);
    }
  });
}

test("account knowledge display does not promote JUDGEMENT or absent provenance to verified", async () => {
  const badgeStart = source.indexOf("{verificationLabels[(item.provenance.verificationStatus");
  const helperMatch = source.match(/\{accountKnowledgeVerificationLabel\(item\)\}/);
  // Evaluate the production label expression, including its real helper if extracted.
  const expression = helperMatch ? "accountKnowledgeVerificationLabel(item)" : source.slice(badgeStart + 1, source.indexOf("}", badgeStart));
  const helper = helperMatch ? await import("../information/knowledge-labels.ts") : {};
  const labelJs = ts.transpileModule(`return ${expression};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const label = new Function("item", "verificationLabels", "accountKnowledgeVerificationLabel", labelJs);
  const resolve = (helper as { accountKnowledgeVerificationLabel?: unknown }).accountKnowledgeVerificationLabel;
  assert.equal(label({ type: "JUDGEMENT", provenance: {} }, { verified: "已验证" }, resolve), "用户判断");
  assert.equal(label({ type: "KNOWN_INFORMATION", provenance: {} }, { verified: "已验证" }, resolve), "未标注验证状态");
  assert.equal(label({ type: "KNOWN_INFORMATION", provenance: { verificationStatus: "verified" } }, { verified: "已验证" }, resolve), "已验证");
});
