import assert from "node:assert/strict";
import test from "node:test";

import { buildObservationLayer } from "../information/observation.ts";
import type { SourceExecutionOutcome } from "../research/source-coverage.ts";

// 候选观察层（第一阶段）：把"是否正式入选"与"是否允许用户查看"分开。
// 数据来自管线已记录的 ProviderRejectionSample（候选与筛选理由），纯展示分流，
// 不改筛选规则、不进长期知识持久化。全部离线构造，无网络、无模型。

function outcome(overrides: Partial<SourceExecutionOutcome> = {}): SourceExecutionOutcome {
  return {
    source: overrides.source ?? "Official Feed · Example Releases",
    execution: "searched_with_results",
    searched: true,
    resultCount: 3,
    rawResultCount: 4,
    normalizedCandidateCount: 4,
    rejectedRawCount: 1,
    requestCount: 1,
    ...overrides,
  } as SourceExecutionOutcome;
}

const TOPIC_MISMATCH = {
  title: "Example CMS adds markdown export",
  summary: "The export dialog now preserves heading levels.",
  url: "https://example.com/blog/markdown-export",
  publishedAt: "2026-10-12T00:00:00.000Z",
  urlPresent: true,
  rejectionStage: "candidate_admission" as const,
  rejectionReason: "TOPIC_MISMATCH",
};

test("正式结果为 0 的 outcomes 仍产生可见的待判断候选", async () => {
  const layer = await buildObservationLayer([
    outcome({
      source: "Official Feed · Example Releases",
      candidateAdmissionRejectionReasons: { TOPIC_MISMATCH: 1 },
      candidateAdmissionRejectedSamples: [TOPIC_MISMATCH],
    }),
  ]);
  assert.equal(layer.items.length, 1, "待判断候选必须可见");
  assert.equal(layer.items[0].title, "Example CMS adds markdown export");
  assert.equal(layer.items[0].status, "pending_review");
});

test("TOPIC_MISMATCH 材料保留原始筛选阶段与理由（不改写）", async () => {
  const layer = await buildObservationLayer([
    outcome({ candidateAdmissionRejectedSamples: [TOPIC_MISMATCH] }),
  ]);
  assert.equal(layer.items[0].stage, "candidate_admission");
  assert.equal(layer.items[0].reason, "TOPIC_MISMATCH");
  assert.ok(layer.items[0].reasonZh.includes("主题"), "必须给出中文说明");
  assert.equal(layer.items[0].url, "https://example.com/blog/markdown-export", "原始链接保留");
  assert.equal(layer.items[0].publishedAt, "2026-10-12T00:00:00.000Z", "原始日期保留");
  assert.equal(layer.items[0].summary, "The export dialog now preserves heading levels.", "摘要从拒绝样本透传");
});

test("没有摘要时不编造，不用标题拼接充当摘要", async () => {
  const layer = await buildObservationLayer([
    outcome({
      candidateAdmissionRejectedSamples: [
        { ...TOPIC_MISMATCH, summary: undefined },
      ],
    }),
  ]);
  assert.equal(layer.items[0].summary, undefined, "缺摘要保持缺省");
  assert.ok(!String(layer.items[0].summary ?? "").includes(layer.items[0].title), "不得用标题充当摘要");
});

test("明确无关材料默认收起，重复标题折叠并保留首条代表与计数", async () => {
  const layer = await buildObservationLayer([
    outcome({
      source: "Source A",
      normalizationRejectionReasons: { invalid_url: 1 },
      normalizationRejectedSamples: [
        { title: "Random aggregator page", urlPresent: true, rejectionStage: "normalization", rejectionReason: "invalid_url" },
      ],
    }),
    outcome({
      source: "Official Feed · Example Releases",
      candidateAdmissionRejectedSamples: [TOPIC_MISMATCH],
    }),
    outcome({
      source: "Source B",
      candidateAdmissionRejectedSamples: [
        { ...TOPIC_MISMATCH, url: "https://mirror.example.com/markdown-export" },
      ],
    }),
  ]);
  assert.equal(layer.items.length, 1, "重复标题折叠为一条");
  assert.equal(layer.items[0].duplicateCount, 1, "重复计数并关联原候选");
  assert.equal(layer.items[0].source, "Official Feed · Example Releases", "折叠保留首个代表来源");
  assert.equal(layer.excludedSafetyCount, 1, "明确无效材料只计数量，不展开");
  assert.equal(layer.collapsedCount, 1, "同标题镜像计入重复折叠");
  assert.equal(layer.overflowCount, 0, "未超上限时超限计数为 0");
  assert.equal(
    layer.items.some((item) => item.reason === "invalid_url"),
    false,
    "invalid_url 属明确无效，不进入可查看列表",
  );
});

test("私网/安全拒绝与无效内容不能进入候选区", async () => {
  const layer = await buildObservationLayer([
    outcome({
      source: "Official Feed · Private Feed",
      execution: "failed",
      searched: true,
      requestCount: 0,
      resultCount: 0,
      failureCode: "upstream_error",
    }),
    outcome({
      normalizationRejectionReasons: { missing_title: 2 },
      normalizationRejectedSamples: [
        { title: "[untitled]", urlPresent: false, rejectionStage: "normalization", rejectionReason: "missing_title" },
      ],
    }),
  ]);
  assert.equal(layer.items.length, 0, "安全/无效内容不得进入观察区");
  assert.ok(layer.excludedSafetyCount >= 1, "至少记录安全排除计数");
  assert.equal(
    JSON.stringify(layer).includes("FEED_PRIVATE_ADDRESS"),
    false,
    "私网判定细节不进入观察层输出",
  );
});

test("翻译失败回退原文；数字、链接、日期不被改写", async () => {
  const layer = await buildObservationLayer(
    [outcome({ candidateAdmissionRejectedSamples: [TOPIC_MISMATCH] })],
    {
      translate: async () => {
        throw new Error("translation service down");
      },
    },
  );
  assert.equal(layer.items[0].title, "Example CMS adds markdown export", "翻译失败显示原文");
  assert.equal(layer.items[0].titleTranslated, undefined, "失败的译文不得出现");
  assert.equal(layer.items[0].url, "https://example.com/blog/markdown-export");
  assert.equal(layer.items[0].publishedAt, "2026-10-12T00:00:00.000Z");
});

test("译文数字一致时提供中文标题并保留原文切换", async () => {
  const layer = await buildObservationLayer(
    [outcome({
      candidateAdmissionRejectedSamples: [
        { ...TOPIC_MISMATCH, title: "Example CMS 26.04.1 adds markdown export" },
      ],
    })],
    { translate: async () => "示例 CMS 26.04.1 增加导出功能" },
  );
  assert.equal(layer.items[0].titleTranslated, "示例 CMS 26.04.1 增加导出功能");
  assert.equal(layer.items[0].title, "Example CMS 26.04.1 adds markdown export", "原文仍保留供切换");
});

test("原文数字在译文中被新增、删除或改变时回退原文", async () => {
  const title = "Example CMS 26.04.1 adds markdown export";
  const layer = await buildObservationLayer(
    [outcome({
      candidateAdmissionRejectedSamples: [
        { ...TOPIC_MISMATCH, title },
        { ...TOPIC_MISMATCH, title: "Example CMS 26.04.1 adds 2 export modes" },
      ],
    })],
    {
      translate: async (text) => text.includes("2 export modes")
        ? "示例 CMS 26.04.1 增加 3 种导出模式"   // 数字被改变
        : "示例 CMS v26.04.2 增加导出功能",        // 版本号被改变
    },
  );
  for (const item of layer.items) {
    assert.equal(item.titleTranslated, undefined, "数字不一致的译文必须回退原文");
    assert.equal(item.title.includes("26.04.1"), true, "原文版本号保持不变");
  }
});

test("观察层不携带持久化字段，仅随响应展示", async () => {
  const layer = await buildObservationLayer([
    outcome({ candidateAdmissionRejectedSamples: [TOPIC_MISMATCH] }),
  ]);
  const blob = JSON.stringify(layer);
  for (const forbidden of ["knowledgeStatus", "attentionDecision", "knowledgeChanges", "evidenceRecords"]) {
    assert.equal(blob.includes(forbidden), false, `观察层不得携带持久化字段：${forbidden}`);
  }
  assert.deepEqual(Object.keys(layer).sort(), ["collapsedCount", "excludedSafetyCount", "items", "overflowCount"]);
});

test("条数边界：可查看候选不超过 8 条", async () => {
  const samples = Array.from({ length: 12 }, (_, index) => ({
    ...TOPIC_MISMATCH,
    title: `Example CMS release ${index + 1}`,
    url: `https://example.com/blog/post-${index + 1}`,
  }));
  const layer = await buildObservationLayer([
    outcome({ candidateAdmissionRejectedSamples: samples }),
  ]);
  assert.equal(layer.items.length, 8);
  assert.equal(layer.overflowCount, 4, "超出展示上限的候选单独计数");
  assert.equal(layer.collapsedCount, 0, "超限材料不得被称为重复材料");
});
