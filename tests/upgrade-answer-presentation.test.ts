// Counterexamples for the "what changed / worth upgrading / how to verify"
// answer content. Materials are replayed verbatim from the saved real response
// (docs/reliability/acceptance-final-submission-3.json) through the REAL
// processing chain: cleanContent → extractClaim → mapSignalPresentation, plus
// assessSignalActionability for the test-action fields. Software-specific
// wording (upgrade value / license / cost / hardware) is only expected when
// the request itself is a software-release question (upgradeContext).
import assert from "node:assert/strict";
import test from "node:test";

import { cleanContent, extractClaim, mapSignalPresentation } from "../content-processing/index.ts";
import { assessSignalActionability } from "../research/actionability.ts";
import type { PresentationInput } from "../content-processing/types.ts";

// Saved real materials (release bullets + the title-only newest version).
const V038_TITLE_ONLY = "Release v0.38.0 · Comfy-Org/ComfyUI · GitHub";
const V037_BULLET =
  "* [Partner Nodes] feat(OpenAI): add transparent background support for GPT Image 2 by @bigcat88 in https://github.com/Comfy-Org/ComfyUI/pull/16366";
const V036_BULLET =
  "* Add new model blueprints and reorganize subgraph categories by @comfyui-wiki in https://github.com/Comfy-Org/ComfyUI/pull/14785";
const V035_BULLET =
  "* [Partner Nodes] feat(Recraft): add V4 Styles by @bigcat88 in https://github.com/Comfy-Org/ComfyUI/pull/15903";

// A neutral, non-software announcement (fictional) used for context checks.
const SCHEDULE_ANNOUNCEMENT =
  "每周项目例会时间由周三 14:00 变更为周四 14:00，自下周一起生效，会议室不变。";

const USER_CONTEXT = {
  questionMatches: ["ComfyUI"],
  gapMatches: [],
  entityMatches: ["ComfyUI"],
};

function replay(
  rawContent: string,
  title: string,
  options: { upgradeContext?: boolean } = {},
): ReturnType<typeof mapSignalPresentation> {
  const cleaned = cleanContent(`${title}\n${rawContent}`, title);
  const claim = extractClaim(cleaned, title);
  const input: PresentationInput = {
    title,
    sourceName: "GitHub · comfyanonymous/ComfyUI",
    sourceUrl: "https://github.com/Comfy-Org/ComfyUI/releases",
    sourceType: "primary" as const,
    verificationStatus: "verified" as const,
    informationType: "FACT" as const,
    userContext: USER_CONTEXT,
    cleaned,
    claim,
    upgradeContext: options.upgradeContext,
  };
  return mapSignalPresentation(input);
}

test("RED: a release body with a specific change must surface that change in the presentation", async () => {
  const presentation = replay(V037_BULLET, "comfyanonymous/ComfyUI v0.37.0", { upgradeContext: true });
  assert.equal(presentation.contentQuality, "VALID");
  const rendered = JSON.stringify([
    presentation.oneLineSummary,
    presentation.fact,
    presentation.whyItMatters,
  ]);
  assert.match(
    rendered,
    /transparent background/i,
    "the presentation must carry the specific change, not only the version title",
  );
  assert.doesNotMatch(
    rendered,
    /该结论由 .* 的证据片段直接支撑/,
    "the evidence-support formula must not replace the change description",
  );
  assert.notEqual(
    presentation.whyItMatters,
    "这直接回应了你正在核对的“ComfyUI”。",
    "whyItMatters must not be the entity echo",
  );
});

test("RED: neutral announcements must not carry software-upgrade copy", async () => {
  const presentation = replay(SCHEDULE_ANNOUNCEMENT, "内部协作例会安排");
  assert.equal(presentation.contentQuality, "VALID");
  const rendered = JSON.stringify([
    presentation.oneLineSummary,
    presentation.fact,
    presentation.whyItMatters,
  ]);
  assert.match(rendered, /周四 14:00/, "the actual change must still be surfaced");
  for (const banned of ["升级", "硬件", "兼容", "商用许可", "许可"]) {
    assert.doesNotMatch(rendered, new RegExp(banned), `neutral announcement must not contain: ${banned}`);
  }
});

test("software-release questions still show the change and the software-specific unknowns", async () => {
  const presentation = replay(V037_BULLET, "comfyanonymous/ComfyUI v0.37.0", { upgradeContext: true });
  const rendered = JSON.stringify([presentation.oneLineSummary, presentation.fact, presentation.whyItMatters]);
  assert.match(rendered, /transparent background/i);
  assert.match(rendered, /商用许可|许可/);
  assert.match(rendered, /升级价值/);
});

test("RED: title-only material must state the gap instead of definite upgrade advice", async () => {
  const presentation = replay("", V038_TITLE_ONLY);
  const rendered = JSON.stringify([
    presentation.oneLineSummary,
    presentation.fact,
    presentation.whyItMatters,
    presentation.contentQuality,
  ]);
  assert.match(
    rendered,
    /具体变化|变化说明|INSUFFICIENT/,
    "the presentation must state that no change detail is available",
  );
  assert.ok(
    presentation.whyItMatters && /不足|未包含|未知/.test(presentation.whyItMatters),
    `whyItMatters itself must state the gap, got ${JSON.stringify(presentation.whyItMatters)}`,
  );
  assert.doesNotMatch(rendered, /值得升级|建议升级|应该升级/, "no definite upgrade advice without change evidence");
  // It must not borrow other versions' changes either.
  assert.doesNotMatch(rendered, /transparent background|model blueprints|V4 Styles/i);
});

test("RED: different versions must not mix each other's release highlights", async () => {
  const v037 = replay(V037_BULLET, "comfyanonymous/ComfyUI v0.37.0", { upgradeContext: true });
  const v036 = replay(V036_BULLET, "comfyanonymous/ComfyUI v0.36.0", { upgradeContext: true });
  const v035 = replay(V035_BULLET, "comfyanonymous/ComfyUI v0.35.0", { upgradeContext: true });
  const rendered037 = JSON.stringify([v037.oneLineSummary, v037.fact, v037.whyItMatters]);
  const rendered036 = JSON.stringify([v036.oneLineSummary, v036.fact, v036.whyItMatters]);
  const rendered035 = JSON.stringify([v035.oneLineSummary, v035.fact, v035.whyItMatters]);
  assert.match(rendered037, /transparent background/i);
  assert.doesNotMatch(rendered037, /model blueprints|V4 Styles/i);
  assert.match(rendered036, /model blueprints/i);
  assert.doesNotMatch(rendered036, /transparent background|V4 Styles/i);
  assert.match(rendered035, /V4 Styles/i);
  assert.doesNotMatch(rendered035, /transparent background|model blueprints/i);
});

test("RED: a change without an execution entry must advise checking the source, not running anything", async () => {
  const assessment = assessSignalActionability({
    title: "内部协作例会安排",
    summary: "每周项目例会时间由周三 14:00 变更为周四 14:00",
    sourceUrl: "https://example.org/announcements/schedule-change",
    tags: ["例会"],
    sourceType: "primary" as const,
    sourceTier: "S" as const,
    eventStatus: "NEW" as const,
    knowledgeStatus: "NOVEL" as const,
    noveltyScore: 86,
    relevanceScore: 100,
    reliabilityScore: 92,
    freshnessScore: 80,
    verificationStatus: "verified" as const,
    informationType: "FACT" as const,
    evidenceText: SCHEDULE_ANNOUNCEMENT,
    changeStatement: "每周项目例会时间由周三 14:00 变更为周四 14:00",
    eventAgeHours: 5,
    requestedFreshnessHours: 720,
  });
  assert.equal(assessment.executionEntry, undefined, "this material has no execution entry");
  assert.match(assessment.action, /核查|原文/, "the action must advise checking the original source");
  assert.doesNotMatch(assessment.action, /触发一次|运行一个|做最小验证/, "no run/test instruction without an entry");
});

test("RED: test suggestions must target the specific change, not a generic README run", async () => {
  const base = {
    title: "comfyanonymous/ComfyUI v0.37.0",
    summary: "add transparent background support for GPT Image 2",
    sourceUrl: "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.37.0",
    tags: ["ComfyUI"],
    sourceType: "primary" as const,
    sourceTier: "S" as const,
    eventStatus: "NEW" as const,
    knowledgeStatus: "NOVEL" as const,
    noveltyScore: 86,
    relevanceScore: 100,
    reliabilityScore: 92,
    freshnessScore: 80,
    verificationStatus: "verified" as const,
    informationType: "FACT" as const,
  };
  const withChange = assessSignalActionability({
    ...base,
    evidenceText: V037_BULLET,
    changeStatement: "add transparent background support for GPT Image 2",
    eventAgeHours: 20,
    requestedFreshnessHours: 720,
  });
  assert.match(withChange.action, /transparent background/i, "the test action must reference the actual change");
  assert.doesNotMatch(withChange.action, /按 README/, "the generic README template must not be used when a change is known");

  const otherChange = assessSignalActionability({
    ...base,
    evidenceText: V036_BULLET,
    changeStatement: "add new model blueprints and reorganize subgraph categories",
    eventAgeHours: 20,
    requestedFreshnessHours: 720,
  });
  assert.match(otherChange.action, /model blueprints/i);
  assert.notEqual(withChange.action, otherChange.action, "different changes must yield different test actions");

  // Regression: without a change statement the existing per-type template stays.
  const withoutChange = assessSignalActionability({
    ...base,
    evidenceText: V037_BULLET,
    eventAgeHours: 20,
    requestedFreshnessHours: 720,
  });
  assert.match(withoutChange.action, /按 README/);
});

test("RED: 'License: TBD / pricing not announced' must not clear the unknown hints", async () => {
  const presentation = replay(
    `${V037_BULLET} License: TBD; pricing not announced yet.`,
    "comfyanonymous/ComfyUI v0.37.0",
    { upgradeContext: true },
  );
  const rendered = JSON.stringify([presentation.oneLineSummary, presentation.fact, presentation.whyItMatters]);
  assert.match(rendered, /商用许可|许可/, "a license mention paired with TBD stays unknown");
  assert.match(rendered, /成本/, "pricing 'not announced' stays unknown");
});

test("RED: without hardware/cost/license evidence the presentation marks unknowns and asserts no guarantees", async () => {
  const presentation = replay(V037_BULLET, "comfyanonymous/ComfyUI v0.37.0", { upgradeContext: true });
  const rendered = JSON.stringify([presentation.oneLineSummary, presentation.fact, presentation.whyItMatters]);
  assert.match(rendered, /未知|未说明/, "unsupported conditions must be marked unknown");
  assert.match(rendered, /商用许可|许可/, "license must be named as unknown when the evidence is silent");
  for (const guarantee of ["完全免费", "兼容所有", "无需付费", "适用于所有"]) {
    assert.doesNotMatch(rendered, new RegExp(guarantee), `must not assert: ${guarantee}`);
  }
});

test("offline replay: every saved in-window version yields a change-specific answer contract", async () => {
  // The saved real materials, one per in-window version (v0.38.0 is title-only
  // and covered by its own test above).
  const savedVersions = [
    { tag: "v0.37.0", bullet: V037_BULLET, phrase: /transparent background/i },
    { tag: "v0.36.0", bullet: V036_BULLET, phrase: /model blueprints/i },
    { tag: "v0.35.0", bullet: V035_BULLET, phrase: /V4 Styles/i },
  ];
  for (const version of savedVersions) {
    const presentation = replay(version.bullet, `comfyanonymous/ComfyUI ${version.tag}`, { upgradeContext: true });
    assert.equal(presentation.contentQuality, "VALID", version.tag);
    assert.ok(presentation.changeStatement, `${version.tag} must carry a change statement`);
    assert.match(presentation.oneLineSummary || "", version.phrase, `${version.tag} summary must name its change`);
    assert.match(presentation.whyItMatters || "", version.phrase, `${version.tag} whyItMatters must name its change`);
    assert.match(presentation.whyItMatters || "", /未知|未说明/, `${version.tag} must mark unknown conditions`);

    const action = assessSignalActionability({
      title: `comfyanonymous/ComfyUI ${version.tag}`,
      summary: presentation.oneLineSummary || presentation.fact,
      sourceUrl: `https://github.com/Comfy-Org/ComfyUI/releases/tag/${version.tag}`,
      tags: ["ComfyUI"],
      sourceType: "primary" as const,
      sourceTier: "S" as const,
      eventStatus: "NEW" as const,
      knowledgeStatus: "NOVEL" as const,
      noveltyScore: 86,
      relevanceScore: 100,
      reliabilityScore: 92,
      freshnessScore: 80,
      verificationStatus: "verified" as const,
      informationType: "FACT" as const,
      evidenceText: version.bullet,
      changeStatement: presentation.changeStatement,
      eventAgeHours: 20,
      requestedFreshnessHours: 720,
    });
    assert.match(action.action, version.phrase, `${version.tag} test action must target its own change`);
  }
});

test("regression on independent material: the same contract holds for a different product's release", async () => {
  const independentBullet =
    "* Add incremental backup verification for long-running clusters by @coredev in https://github.com/example/tools/pull/42";
  const presentation = replay(independentBullet, "example/tools v2.1.0", { upgradeContext: true });
  assert.equal(presentation.contentQuality, "VALID");
  assert.match(presentation.oneLineSummary || "", /incremental backup verification/i);
  assert.match(presentation.whyItMatters || "", /incremental backup verification/i);
  assert.match(presentation.whyItMatters || "", /未知|未说明/);
  const action = assessSignalActionability({
    title: "example/tools v2.1.0",
    summary: presentation.oneLineSummary || presentation.fact,
    sourceUrl: "https://github.com/example/tools/releases/tag/v2.1.0",
    tags: ["tools"],
    sourceType: "primary" as const,
    sourceTier: "S" as const,
    eventStatus: "NEW" as const,
    knowledgeStatus: "NOVEL" as const,
    noveltyScore: 80,
    relevanceScore: 95,
    reliabilityScore: 90,
    freshnessScore: 80,
    verificationStatus: "verified" as const,
    informationType: "FACT" as const,
    evidenceText: independentBullet,
    changeStatement: presentation.changeStatement,
    eventAgeHours: 30,
    requestedFreshnessHours: 720,
  });
  assert.match(action.action, /incremental backup verification/i);
  assert.doesNotMatch(action.action, /按 README/);
});

test("regression: navigation-chrome content and BACKGROUND versions keep honest failure modes", async () => {
  // Docs-navigation-like content must not become a feature-update presentation.
  const nav = replay(
    "ComfyUI Docs 获取帮助 联系支持人员 在 Comfy Registry 上共享您的自定义节点 安装 自定义节点",
    "ComfyUI · Docs",
  );
  const navRendered = JSON.stringify([nav.oneLineSummary, nav.fact, nav.whyItMatters, nav.contentQuality]);
  assert.doesNotMatch(navRendered, /建议升级|值得升级/, "navigation chrome must not become upgrade advice");

  // A BACKGROUND (out-of-window) version must not schedule tests.
  const background = assessSignalActionability({
    title: "comfyanonymous/ComfyUI v0.34.0",
    summary: "add MiniMaxH3AddGuide for anchoring image and audio guides at any frame",
    sourceUrl: "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.34.0",
    tags: ["ComfyUI"],
    sourceType: "primary" as const,
    sourceTier: "S" as const,
    eventStatus: "BACKGROUND",
    knowledgeStatus: "NOVEL" as const,
    noveltyScore: 86,
    relevanceScore: 100,
    reliabilityScore: 92,
    freshnessScore: 25,
    verificationStatus: "verified" as const,
    informationType: "FACT" as const,
    evidenceText: V037_BULLET,
    changeStatement: "add transparent background support for GPT Image 2",
  });
  assert.equal(background.actionabilityStatus, "BACKGROUND");
  assert.match(background.action, /仅作背景参考/);
});
