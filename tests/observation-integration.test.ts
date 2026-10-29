import assert from "node:assert/strict";
import test, { describe, beforeEach } from "node:test";

import { runResearchPipeline } from "../research/research-pipeline.ts";
import { readCustomSource } from "../source-enrichment/custom-source.ts";
import type { ResearchInput } from "../research/types.ts";

// Fixed reference time: these contract fixtures must remain inside their requested window.
describe("frozen observation-integration.test.ts", () => {
 beforeEach(t => { if ("mock" in t) t.mock.timers.enable({apis: ["Date"], now: new Date("2026-10-20T12:00:00Z")}); });

// 集成回放（离线，无模型、无真实外呼）：
// mock globalThis.fetch —— arXiv 返回与问题无关的真实形状 Atom 条目（候选在
// candidate_admission 被判 TOPIC_MISMATCH 并携带 url/publishedAt/summary），
// 其余所有外呼一律 500 快速失败。走 runResearchPipeline 真实筛选与响应组装，
// 证明"正式结果为 0，但待判断候选进入最终产品响应"，且构建观察层不触发
// 任何翻译服务调用。

const INPUT: ResearchInput = {
  identity: "builder",
  industry: "software",
  focusAreas: "",
  currentQuestions: "过去30天，Kdenlive 官方发布了哪些维护更新？请列出发布日期、适用版本与官方链接，排除测试招募和无关工具。",
  knownInformation: "",
  informationGaps: "",
  trackedEntities: "Kdenlive",
  trackedEvents: "",
  userJudgements: "",
  evidenceHistory: "",
  freshnessWindow: "30d",
};

const ARXIV_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2610.12345v1</id>
    <title>Quantum endoscopy benchmark for clinical navigation</title>
    <summary>We benchmark a quantum endoscopy dataset for clinical navigation tasks.</summary>
    <published>2026-10-18T09:00:00Z</published>
    <updated>2026-10-18T09:00:00Z</updated>
  </entry>
</feed>`;

test("集成回放：正式结果 0 条，待判断候选进入最终响应；不触发翻译服务", async (t) => {
  const calledUrls: string[] = [];
  t.mock.method(globalThis, "fetch", ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calledUrls.push(url);
    if (url.includes("export.arxiv.org")) {
      return Promise.resolve(new Response(ARXIV_ATOM, { status: 200, headers: { "Content-Type": "application/atom+xml" } }));
    }
    return Promise.resolve(new Response(JSON.stringify({ error: "offline replay" }), { status: 500 }));
  }) as typeof fetch);

  // P2-N3a: registered feeds read through the safe reader (node:https), which no
  // fetch mock can intercept. Inject a frozen kdenlive-shaped fixture via the
  // reader's options.request/options.lookup — no real network, fixed dates.
  const FROZEN_KDENLIVE_FEED = `<rss><channel><title>Kdenlive News</title><item><title>PCB 测试方案发布会</title><link>https://kdenlive.org/news/pcb-fixture</link><pubDate>Sun, 18 Oct 2026 09:00:00 GMT</pubDate><description>冻结夹具：与问题无关的硬件条目，固定日期。</description></item></channel></rss>`;
  const frozenReader: typeof readCustomSource = (url, options) => readCustomSource(url, {
    ...options,
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async (target) => {
      if (new URL(String(target)).hostname === "kdenlive.org") {
        return { status: 200, headers: { "content-type": "application/xml" }, body: FROZEN_KDENLIVE_FEED };
      }
      throw new Error(`offline fixture: unexpected host ${new URL(String(target)).hostname}`);
    },
  });

  const response = await runResearchPipeline(INPUT, undefined, { deadlineAt: Date.now() + 30000, customSourceReader: frozenReader });

  // 正式结果为 0
  assert.equal(response.signals.length, 0, "无相关候选时正式结果必须为 0");
  // 注册源按冻结快照离线读取，并输出明确的覆盖观察（非静默 0 条）
  const feedOutcome = (response.coverage?.outcomes ?? []).find(outcome => outcome.sourceId === "kdenlive");
  assert.ok(feedOutcome?.coverage, "冻结注入的注册源必须携带覆盖观察");
  assert.match(feedOutcome.coverage.notice, /最近 1 条/);
  // 待判断候选进入最终产品响应
  assert.ok(response.observation, "响应必须携带观察层");
  assert.ok(response.observation.items.length >= 1, "至少一条待判断候选可见");
  const item = response.observation.items[0];
  assert.equal(item.reason, "TOPIC_MISMATCH", "保留原始筛选理由");
  assert.equal(item.title, "Quantum endoscopy benchmark for clinical navigation");
  assert.equal(item.url, "http://arxiv.org/abs/2610.12345v1", "原始链接保留");
  assert.equal(item.summary, "We benchmark a quantum endoscopy dataset for clinical navigation tasks.", "摘要从拒绝样本透传");
  assert.equal(item.publishedAt, "2026-10-18T09:00:00Z", "原始日期保留");
  // 观察层构建不触发翻译服务：全部条目保持原文，且无任何翻译域名外呼
  for (const entry of response.observation.items) {
    assert.equal(entry.titleTranslated, undefined, "第一阶段观察层只显示原文");
  }
  for (const url of calledUrls) {
    assert.equal(url.toLowerCase().includes("translate"), false, `不得外呼翻译服务：${url}`);
  }
  // 候选不进入长期确认知识（正式信号为 0）；冻结夹具候选按溯源保留证据行，
  // 且在筛选明细中携带明确的 TOPIC_MISMATCH 原因——不是静默 0 条。
  assert.ok((response.evidenceRecords ?? []).every(record => record.sourceUrl.includes("kdenlive.org")), "证据行只来自冻结夹具候选");
  const fixtureRow = (response.filteringSummary?.filteringDetails ?? []).find(row => row.title.includes("PCB 测试方案"));
  assert.ok(fixtureRow, "冻结夹具条目必须在筛选明细中留痕");
  assert.equal(fixtureRow.decision, "filtered");
  assert.equal(fixtureRow.topicRelevance?.decision, "TOPIC_MISMATCH", "明确原因：主题不匹配");
});

});
