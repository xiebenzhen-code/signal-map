import test from "node:test";
import assert from "node:assert/strict";
import { cleanContent, extractClaim, buildEvidenceSnippet, mapSignalPresentation } from "../content-processing/index.ts";
import { buildFilteringSummary } from "../research/filtering-summary.ts";
import type { ResearchSignal } from "../research/types.ts";

test("Content Cleaner removes CSS, JS, attributes, navigation, footer, cookies, and repeated titles", () => {
  const raw = `
    <nav>Login Menu Sign up</nav>
    <style>:root { --dotcom-chart-color: red; } .x{color:var(--color-blue)}</style>
    <script>const dataDotcomChartThemeProvider = true;</script>
    <h1>Claude Code update</h1>
    <h1>Claude Code update</h1>
    <article className="template" data-dotcom-chart-theme-provider="x">
      Anthropic updated Claude Code with a new planning workflow for longer coding tasks.
      The release notes describe how the workflow changes task execution.
    </article>
    <footer>Privacy Terms Cookie</footer>
  `;
  const cleaned = cleanContent(raw, "Claude Code update");
  assert.equal(cleaned.quality, "VALID");
  assert.match(cleaned.mainContent, /Anthropic updated Claude Code/);
  assert.doesNotMatch(cleaned.mainContent, /--dotcom-chart-color|data-dotcom|className=|var\(--|const dataDotcom|Login|Privacy/i);
  assert.equal((cleaned.mainContent.match(/Claude Code update/g) || []).length <= 1, true);
});

test("Content Cleaner keeps changelog body and marks title-only content insufficient", () => {
  const valid = cleanContent("Claude Code changelog\nAnthropic released Claude Code hooks support in the September changelog.", "Claude Code changelog");
  assert.equal(valid.quality, "VALID");
  assert.match(valid.mainContent, /hooks support/);
  const insufficient = cleanContent("<h1>OpenAI News | OpenAI</h1>", "OpenAI News | OpenAI");
  assert.equal(insufficient.quality, "INSUFFICIENT_CONTENT");
});

test("Claim extraction requires a supported subject and action and cannot return only the title", () => {
  const cleaned = cleanContent("OpenAI News | OpenAI\nOpenAI released a Codex update with improved long-running task support.", "OpenAI News | OpenAI");
  const claim = extractClaim(cleaned, "OpenAI News | OpenAI");
  assert.equal(claim.quality, "VALID");
  assert.match(claim.statement, /OpenAI released/);
  assert.notEqual(claim.statement, "OpenAI News | OpenAI");

  const noClaim = extractClaim(cleanContent("OpenAI News | OpenAI", "OpenAI News | OpenAI"), "OpenAI News | OpenAI");
  assert.equal(noClaim.quality, "INSUFFICIENT_CONTENT");
});

test("Claim extraction does not let newsroom navigation become the fact", () => {
  const cleaned = cleanContent(
    "Newsroom \\ Anthropic Skip to main content Skip to footer Research Policy Commitments Learn News Try Claude Newsroom Press inquiries press@anthropic.com Media assets Download press kit Introducing Claude Fable 5.1 and Claude Mythos 5.1 Announcements Sep 1, 2026 Our most advanced models for coding and knowledge work.",
    "Newsroom \\ Anthropic",
  );
  const claim = extractClaim(cleaned, "Newsroom \\ Anthropic");
  assert.equal(claim.quality, "VALID");
  assert.match(claim.statement, /Introducing Claude Fable 5\.1/);
  assert.doesNotMatch(claim.statement, /Skip to main content|Press inquiries|Download press kit/i);
});

test("Evidence snippet keeps only claim-supporting sentences", () => {
  const cleaned = cleanContent([
    "Cookie settings and navigation.",
    "Anthropic updated Claude Code with a new planning workflow.",
    "Unrelated sidebar recommends other articles.",
    "The changelog says the workflow supports longer coding tasks.",
  ].join("\n"), "Claude Code changelog");
  const claim = extractClaim(cleaned, "Claude Code changelog");
  const snippet = buildEvidenceSnippet(cleaned, claim);
  assert.match(snippet, /Anthropic updated Claude Code/);
  assert.doesNotMatch(snippet, /Cookie settings|sidebar/i);
});

test("Presentation separates FACT, interpretation, and EARLY_SIGNAL boundaries", () => {
  const cleaned = cleanContent("Product Hunt signal\nA founder launched Neon Video Agent as a new AI video tool.", "Product Hunt signal");
  const claim = extractClaim(cleaned, "Product Hunt signal");
  const signal = mapSignalPresentation({
    title: "Product Hunt signal",
    sourceName: "Product Hunt",
    sourceUrl: "https://producthunt.com/products/neon-video-agent",
    sourceType: "social",
    verificationStatus: "unverified",
    informationType: "SIGNAL",
    cleaned,
    claim,
  });
  assert.equal(signal.contentQuality, "VALID");
  assert.match(signal.fact, /早期信号，尚未充分确认/);
  assert.equal(signal.evidence.length, 1);

  const interpretation = mapSignalPresentation({
    title: "AI video tool trend",
    sourceName: "Hugging Face",
    sourceUrl: "https://huggingface.co/spaces/example/video",
    sourceType: "industry_media",
    verificationStatus: "partially_verified",
    informationType: "INTERPRETATION",
    cleaned,
    claim,
  });
  assert.match(interpretation.interpretation || "", /不等同于已确认事实/);
});

test("INSUFFICIENT_CONTENT enters FilteringSummary", () => {
  const hidden = {
    id: "signal-insufficient",
    verificationStatus: "unverified",
    signalType: "NOISE",
    knowledgeStatus: "NOVEL",
    timestampStatus: "valid",
    freshnessScore: 80,
    reliabilityScore: 80,
    relevanceScore: 80,
    judgementImpactScore: 80,
    noveltyScore: 80,
    overallScore: 80,
    confirmationGain: false,
    claims: [],
    independentEvidenceCount: 0,
    informationType: "SIGNAL",
    contentQuality: "INSUFFICIENT_CONTENT",
  } as unknown as ResearchSignal;
  const summary = buildFilteringSummary({
    retrievedCount: 8,
    clusteredCount: 1,
    allSignals: [hidden],
    displayedSignals: [],
  });
  assert.equal(summary.filteredReasons.insufficientContent, 1);
  assert.match(summary.summaryText, /INSUFFICIENT_CONTENT|正文提取不足|insufficient/i);
});
