import assert from "node:assert/strict";
import test from "node:test";
import { runAgent } from "../agent/runner.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
import type { PersonalKnowledgeType } from "../information/rag-records.ts";
import { runResearchPipeline } from "../research/research-pipeline.ts";
import type { ResearchInput, ResearchResponse } from "../research/types.ts";
import type { CandidateSelectionAudit } from "../research/candidate-selection.ts";

const context = { authenticatedUserId: "feedback-test-a", filterId: "filter-a" };
const title = "comfyanonymous/ComfyUI v0.37.0";
const input: ResearchInput = {
  identity: "用户", industry: "开源开发与 AI 工具", focusAreas: "ComfyUI",
  currentQuestions: "ComfyUI 最近一个月在 GitHub 发布了哪些版本？",
  knownInformation: "", informationGaps: "", trackedEntities: "ComfyUI",
  trackedEvents: "", userJudgements: "", evidenceHistory: "", freshnessWindow: "30d",
};
type RecordSeed = { type: PersonalKnowledgeType; text: string };

async function run(options: {
  records?: RecordSeed[];
  draft?: Partial<ResearchInput>;
  foreign?: { authenticatedUserId: string; filterId: string };
} = {}) {
  const repository = new InMemorySignalRepository();
  const owner = options.foreign ?? context;
  repository.saveFilter(owner, { id: owner.filterId, userId: owner.authenticatedUserId, name: "测试", createdAt: "", updatedAt: "" });
  if (options.foreign && options.foreign.filterId !== context.filterId) repository.saveFilter(context, { id: context.filterId, userId: context.authenticatedUserId, name: "测试", createdAt: "", updatedAt: "" });
  for (const record of options.records ?? []) repository.addPersonalKnowledge(owner, record, new Date().toISOString());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (target) => {
    const url = new URL(String(target));
    assert.notEqual(url.hostname, "api.deepseek.com", "离线验证禁止模型调用");
    if (url.hostname === "api.github.com" && url.pathname.endsWith("/releases")) {
      return Response.json([{
        id: 3003, tag_name: "v0.37.0", name: "v0.37.0",
        html_url: "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.37.0",
        body: "Release Notes\n* Add transparent background support for image nodes\n* Fix sampler memory leak after long sessions\n* Improve remote model loading with retry support",
        published_at: new Date(Date.now() - 3_600_000).toISOString(),
      }]);
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  let consumed: ResearchInput | undefined;
  let pipeline: ResearchResponse | undefined;
  let audits: CandidateSelectionAudit[] = [];
  try {
    const result = await runAgent({
      input: { ...input, ...options.draft }, repository, context, maxRounds: 1,
      modelAdapter: { status: "not_configured", planResearch: async () => ({ status: "not_configured" }) },
      research: async (assembled) => {
        consumed = assembled;
        const response = await runResearchPipeline(assembled, undefined, {
          onCandidateSelectionAudit: (value) => { audits = value; },
        }, {
          primarySourceType: "OFFICIAL", fallbackSourceTypes: [],
          allowedProviderIds: ["github-releases"], reason: "离线反馈接线验证",
        });
        pipeline = structuredClone(response);
        return response;
      },
    });
    assert.ok(consumed, "必须经过真实 runner 组装");
    assert.ok(pipeline, "必须执行真实管线");
    const signal = pipeline.signals.find((item) => item.sourceUrl.endsWith("/v0.37.0"));
    const audit = audits.find((item) => item.eligibilityAudit?.noveltyAttribution?.title === title)?.eligibilityAudit?.noveltyAttribution;
    assert.ok(audit, "必须有版本评估审计，禁止空取证通过");
    if (!options.draft?.evidenceHistory && !options.records?.some((item) => item.type === "KNOWN_INFORMATION" && item.text === title)) {
      assert.ok(signal, "新版本必须展示，禁止空结果通过");
    }
    return { consumed, signal: signal!, audit, result };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("已知反馈进入真实管线并识别同一版本为已知", async () => {
  const value = await run({ records: [{ type: "KNOWN_INFORMATION", text: title }] });
  assert.equal(value.consumed.knownInformation, title);
  assert.equal(value.audit.knownFactPenalty, 74);
  assert.equal(value.audit.knownMatches[0]?.origin, "knownInformation");
});

test("持久化负向判断进入 userJudgements，不进入已知事实", async () => {
  const baseline = await run();
  const value = await run({ records: [{ type: "JUDGEMENT", text: `Not useful: ${title}` }] });
  assert.equal(value.consumed.knownInformation, "");
  assert.equal(value.consumed.userJudgements, `Not useful: ${title}`);
  assert.ok(value.signal.noveltyScore < baseline.signal.noveltyScore, "负向判断保留现有扣分");
  assert.equal(value.signal.reliabilityScore, baseline.signal.reliabilityScore);
  assert.equal(value.signal.verificationStatus, baseline.signal.verificationStatus);
});

test("改变看法不扣无用分且不提升可信度", async () => {
  const baseline = await run();
  const value = await run({ records: [{ type: "JUDGEMENT", text: `Changed after evidence: ${title}` }] });
  assert.equal(value.consumed.knownInformation, "");
  assert.equal(value.consumed.userJudgements, `Changed after evidence: ${title}`);
  assert.equal(value.signal.noveltyScore, baseline.signal.noveltyScore);
  assert.equal(value.signal.reliabilityScore, baseline.signal.reliabilityScore);
  assert.equal(value.signal.knowledgeStatus, baseline.signal.knowledgeStatus);
});

test("手写判断保留现有匹配扣分行为", async () => {
  const baseline = await run();
  const value = await run({ draft: { userJudgements: "transparent" } });
  assert.equal(value.signal.noveltyScore, baseline.signal.noveltyScore - 6);
});

test("历史多行 changed_view 标题续行不得进入负向匹配", async () => {
  const baseline = await run();
  const value = await run({ records: [{ type: "JUDGEMENT", text: `Changed after evidence: ${title}\ntransparent` }] });
  assert.equal(value.signal.noveltyScore, baseline.signal.noveltyScore);
});

test("前端和服务端同一判断只消费一份", async () => {
  const text = `Not useful: ${title}`;
  const single = await run({ records: [{ type: "JUDGEMENT", text }] });
  const both = await run({ records: [{ type: "JUDGEMENT", text }], draft: { userJudgements: text } });
  assert.equal(both.consumed.userJudgements, text);
  assert.equal(both.signal.noveltyScore, single.signal.noveltyScore);
});

test("负向判断不影响无关内容", async () => {
  const baseline = await run();
  const value = await run({ records: [{ type: "JUDGEMENT", text: "Not useful: OtherUnrelatedProduct" }] });
  assert.equal(value.signal.noveltyScore, baseline.signal.noveltyScore);
  assert.equal(value.signal.reliabilityScore, baseline.signal.reliabilityScore);
});

test("改变看法的阅读历史仍识别读过，但不是负向判断", async () => {
  const read = await run({ draft: { evidenceHistory: title } });
  const changed = await run({ records: [{ type: "JUDGEMENT", text: `Changed after evidence: ${title}` }], draft: { evidenceHistory: title } });
  assert.equal(changed.consumed.knownInformation, "");
  assert.equal(changed.consumed.evidenceHistory, title);
  assert.equal(changed.audit.knownMatches[0]?.origin, "evidenceHistory");
  assert.equal(changed.audit.knownFactPenalty, 74);
  assert.equal(changed.audit.noveltyScore, read.audit.noveltyScore);
});

test("前端和服务端已知信息去重且新版本不误判已知", async () => {
  const known = "comfyanonymous/ComfyUI v0.36.0";
  const value = await run({ records: [{ type: "KNOWN_INFORMATION", text: known }], draft: { knownInformation: known } });
  assert.equal(value.consumed.knownInformation, known);
  assert.notEqual(value.signal.knowledgeStatus, "KNOWN");
});

for (const foreign of [
  { authenticatedUserId: "feedback-test-b", filterId: "filter-a" },
  { authenticatedUserId: context.authenticatedUserId, filterId: "filter-b" },
]) {
  test(`反馈不越过作用域：${foreign.authenticatedUserId}/${foreign.filterId}`, async () => {
    const baseline = await run();
    const value = await run({ foreign, records: [{ type: "JUDGEMENT", text: `Not useful: ${title}` }] });
    assert.equal(value.consumed.userJudgements, "");
    assert.equal(value.signal.noveltyScore, baseline.signal.noveltyScore);
  });
}
