// Run with Node 24: node --experimental-strip-types scripts/eval-frozen.mjs
// Replays the current deterministic pipeline, NOT a historical end-to-end run.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { runResearchPipeline } from '../research/research-pipeline.ts';
import { readCustomSource } from '../source-enrichment/custom-source.ts';
import { explainZeroDisplay } from '../research/filtering-summary.ts';
import { parseRegisteredFeed } from '../research/registered-feeds.ts';
import { selectRegisteredFeeds } from '../source-registry/feed-catalog.ts';
import { freshnessWindowHours } from '../information/freshness.ts';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output-dir')) {
  throw new Error('Usage: node scripts/eval-frozen.mjs [--output-dir DIRECTORY]');
}
const output = resolve(args[1] ?? 'outputs/eval-frozen');
const metadataUrl = new URL('../tests/fixtures/d06-plan.json', import.meta.url);
const feedUrl = new URL('../tests/fixtures/d06-chrome.xml', import.meta.url);
const metadataBytes = readFileSync(metadataUrl);
const feedBytes = readFileSync(feedUrl);
const fixture = JSON.parse(metadataBytes);
const chromeFeed = selectRegisteredFeeds({entities: ['Chrome'], query: ''}).find(feed => feed.id === 'chrome');
if (!chromeFeed) throw new Error('Missing Chrome catalog entry');
const rawEntries = parseRegisteredFeed(feedBytes.toString('utf8'), chromeFeed).entries;
const now = Date.parse(fixture.asOf);
if (!Number.isFinite(now)) throw new Error('Frozen capture time is required');
let networkRequests = 0;
let fixtureReads = 0;
let unavailableDetailReads = 0;
const rejectNetwork = () => { networkRequests++; throw new Error('OFFLINE_NETWORK_FORBIDDEN'); };
const originals = [];
for (const [object, key] of [[globalThis, 'fetch'], [http, 'request'], [http, 'get'],
  [https, 'request'], [https, 'get'], [net, 'connect'], [net, 'createConnection'], [tls, 'connect']]) {
  originals.push([object, key, object[key]]);
  object[key] = rejectNetwork;
}
const OriginalDate = Date;
const originalTranslationFlag = process.env.TRANSLATION_ENABLED;
process.env.TRANSLATION_ENABLED = 'false';
globalThis.Date = class extends OriginalDate {
  constructor(...values) { super(...(values.length ? values : [now])); }
  static now() { return now; }
};
const cases = [];
try {
 for (const planMode of ['frozen', 'rebuilt']) {
  fixtureReads = 0;
  unavailableDetailReads = 0;
  const result = await runResearchPipeline(fixture.input, undefined, {
    frozenQueryPlan: planMode === 'frozen' ? fixture.plan : undefined,
    deadlineAt: now + 60000,
    customSourceReader: (url, options) => readCustomSource(url, {
      ...options,
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      request: async target => {
        if (target.href !== 'https://chromereleases.googleblog.com/feeds/posts/default') {
          throw new Error('NO_FROZEN_FIXTURE_FOR_SOURCE');
        }
        fixtureReads++;
        return { status: 200, headers: { 'content-type': 'application/atom+xml' }, body: feedBytes.toString('utf8') };
      },
    }),
    // No frozen detail HTML is available. Do not invent it or read the live page.
    detailReadOptions: {
      lookup: async () => { unavailableDetailReads++; throw new Error('FROZEN_DETAIL_UNAVAILABLE'); },
      request: rejectNetwork,
    },
  }, { queries: fixture.plan.searchCombinations, allowedProviderIds: ['registered-feeds'] });
const summary = result.filteringSummary;
if (!summary) throw new Error('Missing pipeline filtering summary');
const start = now - freshnessWindowHours(result.queryPlan.requestedFreshnessWindow) * 3600000;
// Match the product response/summary, including its library section; do not
// silently redefine "displayed" as MUST_READ + WORTH_WATCHING only.
const returnedCards = result.signals;
const formalItems = returnedCards.filter(item => ['MUST_READ', 'WORTH_WATCHING'].includes(item.attentionDecision));
const libraryItems = returnedCards.filter(item => item.attentionDecision === 'LIBRARY_ONLY');
const outsideWindowItems = returnedCards.filter(item => {
  const timestamp = Date.parse(item.publishedAt ?? '');
  return !Number.isFinite(timestamp) || timestamp < start || timestamp > now;
});
if (returnedCards.length !== summary.displayedCount) throw new Error('Returned card/count mismatch');
if (formalItems.length + libraryItems.length !== returnedCards.length) throw new Error('Unclassified returned card');
const row = {
  id: fixture.id, planMode, queryPlan: result.queryPlan, question: fixture.question, asOf: fixture.asOf,
  questionOrigin: fixture.questionOrigin, planOrigin: planMode === 'frozen' ? fixture.planOrigin : 'queries-only upstream plan rebuilt by current pipeline (legacy evaluation path)',
  fetchedCount: result.coverage.outcomes.filter(item => item.searched)
    .reduce((total, item) => total + (item.rawResultCount ?? item.resultCount), 0),
  retrievedCount: summary.retrievedCount, deduplicatedCount: result.overview.deduplicated,
  returnedCardCount: returnedCards.length, formalAttentionCount: formalItems.length, libraryCount: libraryItems.length, possibleRelatedCount: (summary.possibleRelated ?? []).length,
  outsideWindowReturnedCardCount: outsideWindowItems.length,
  outsideWindowReturnedCardIds: outsideWindowItems.map(item => item.id),
  zeroDisplayReason: formalItems.length ? null : explainZeroDisplay({
    retrievedCount: summary.retrievedCount, displayedCount: formalItems.length,
    outcomes: result.coverage.outcomes, allSignals: summary.filteringDetails ?? [],
  }),
  appliedWindow: result.queryPlan.requestedFreshnessWindow, fixtureReads, unavailableDetailReads,
  entries: rawEntries.map((entry, index) => {
    const trace = summary.filteringDetails.find(detail => detail.sources.some(source => source.sourceUrl === entry.url));
    const timestamp = Date.parse(entry.publishedAt ?? '');
    const destination = !trace ? 'NOT_RETAINED_BEFORE_CLUSTER'
      : (summary.possibleRelated ?? []).some(item => item.id === trace.id) ? 'POSSIBLE_RELATED'
      : formalItems.some(item => item.id === trace.id) ? 'FORMAL_ATTENTION'
      : libraryItems.some(item => item.id === trace.id) ? 'LIBRARY_ONLY' : 'FILTERED';
    return { entryId: `D06-${String(index + 1).padStart(2, '0')}`, ...entry,
      inWindow: Number.isFinite(timestamp) && timestamp >= start && timestamp <= now,
      clusterId: trace?.id ?? null, decision: trace?.topicRelevance?.decision ?? null,
      reason: trace?.topicRelevance?.reason ?? null, destination };
  }),
  formalItems, libraryItems, possibleRelated: summary.possibleRelated ?? [],
  filteringDetails: summary.filteringDetails ?? [],
  sources: result.coverage.outcomes.filter(item => item.searched),
};
cases.push(row);
 }
} finally {
  globalThis.Date = OriginalDate;
  if (originalTranslationFlag === undefined) delete process.env.TRANSLATION_ENABLED;
  else process.env.TRANSLATION_ENABLED = originalTranslationFlag;
  for (const [object, key, value] of originals) object[key] = value;
}
if (networkRequests) throw new Error(`OFFLINE_VIOLATION: ${networkRequests} network attempts; no report written`);
if (!fixtureReads) throw new Error('FIXTURE_NOT_EFFECTIVE: no frozen feed was read');
const report = {
  schemaVersion: 2, networkRequests, modelCalls: 0,
  limitations: '只有 D06 一组完整冻结题面与 RSS；没有冻结详情 HTML，详情明确标为不可读取，保留 RSS 摘要。翻译关闭。没有人工金标或历史完整轨迹。不计算误零率、精度，不代表线上效果。',
  fixtures: [metadataUrl, feedUrl].map((url, index) => ({
    path: `tests/fixtures/${url.pathname.split('/').at(-1)}`,
    sha256: createHash('sha256').update(index ? feedBytes : metadataBytes).digest('hex'),
  })),
  cases,
};
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
const columns = cases.map(row => `| ${row.id} / ${row.planMode} | ${row.fetchedCount} | ${row.deduplicatedCount} | ${row.formalAttentionCount} | ${row.libraryCount} | ${row.possibleRelatedCount} | ${row.outsideWindowReturnedCardCount} | ${row.zeroDisplayReason ?? '—'} |`).join('\n');
writeFileSync(resolve(output, 'results.md'), `# 冻结快照离线评测\n\n${report.limitations}\n\n冻结 plan 保留所有字段；重建 plan 复现旧脚本仅传查询词的路径，不等同历史线上计划。retrievedCount 为流水线检索计数，正式关注与资料库分开统计。\n\n| 案例 / plan | 抓取数 | 标题去重后 | 正式关注（MUST_READ/WORTH_WATCHING） | 资料库（LIBRARY_ONLY） | 可能相关 | 窗口外进入返回卡片数 | 零正式关注原因 |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n${columns}\n`);
console.log(`Frozen evaluation: ${fixture.id}; reports: ${output}`);
