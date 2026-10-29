// Read-only attribution. Detailed outputs stay outside the repository in PRIVATE files.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolveFreshness } from '../information/freshness.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2];
if (!output || !isAbsolute(output) || !relative(root, output).startsWith('..')) throw new Error('Absolute outside-repository output directory required');
const baseline = '145b22ba388ee83d8f95766a8fe933e64f40cdb7';
const paths = ['research/actionability.ts','research/research-pipeline.ts','information/freshness.ts','research/topic-relevance.ts'];
for (const path of paths) {
  const hash = ref => execFileSync('git',['rev-parse',`${ref}:${path}`],{cwd:root,encoding:'utf8'}).trim();
  if (hash('HEAD') !== hash(baseline)) throw new Error('Product baseline drift');
}
const input = resolve(root,'../d06-judgment-diagnosis-20261029/PRIVATE-judgment-report.json');
const bytes = readFileSync(input);
const prior = JSON.parse(bytes);
const replay = JSON.parse(readFileSync(resolve(dirname(input),'PRIVATE-results.json'),'utf8'));
const rebuilt = replay.cases.find(row=>row.planMode==='rebuilt');
const cards = prior.cards.filter(row=>row.mode==='rebuilt');
if (cards.length !== 11) throw new Error('Expected eleven library cards');
function counts(values) {
  return values.reduce((out,value)=>{out[value]=(out[value]??0)+1;return out;},{});
}
function distribution(values) {
  const sorted = values.toSorted((a,b)=>a-b);
  if (!sorted.length || sorted.some(value=>!Number.isFinite(value))) throw new Error('Invalid distribution');
  const middle = Math.floor(sorted.length/2);
  return {count:sorted.length,min:sorted[0],median:sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2,max:sorted.at(-1)};
}
const ages = cards.map(({card})=>{
  const publishedAgeHours=(Date.parse(rebuilt.asOf)-Date.parse(card.publishedAt))/3600000;
  const effective=resolveFreshness(card.lastUpdatedAt?{eventOccurredAt:card.lastUpdatedAt}:{eventOccurredAt:card.originalOccurredAt,publishedAt:card.publishedAt},new Date(rebuilt.asOf));
  if (effective.score!==card.freshnessScore) throw new Error('Freshness calculation differs from replay');
  return {id:card.id,publishedAt:card.publishedAt,windowEnd:rebuilt.asOf,publishedAgeHours,effective,freshnessScore:card.freshnessScore};
});
const clusters = new Map();
for (const row of prior.transitions) {
  if (!clusters.has(row.before.clusterId)) clusters.set(row.before.clusterId,[]);
  clusters.get(row.before.clusterId).push(row);
}
const clusterTransitions = [...clusters].map(([id,members])=>({id,members,
  destinations:[...new Set(members.map(row=>row.after.destination))],
  rules:[...new Set(members.map(row=>`${row.after.destination} / ${row.finalFilteringRecord.reason ?? 'RETURNED_LIBRARY'} / topic:${row.after.reason}`))]}));
if (clusterTransitions.some(row=>row.destinations.length!==1 || row.rules.length!==1)) throw new Error('Split cluster requires separate attribution');
const allTransitionGroups=counts(clusterTransitions.map(row=>row.rules[0]));
const removed=clusterTransitions.filter(row=>row.destinations[0]==='FILTERED');
const summary={
  rebuiltCards:cards.length,appliedWindow:rebuilt.appliedWindow,windowEnd:rebuilt.asOf,eventStatuses:counts(cards.map(row=>row.card.eventStatus)),
  actionabilityStatuses:counts(cards.map(row=>row.card.actionabilityStatus)),
  executionEntryCount:cards.filter(row=>row.card.hasExecutableAction).length,
  freshnessScore:distribution(ages.map(row=>row.freshnessScore)),
  freshnessScoreCounts:counts(ages.map(row=>row.freshnessScore)),
  publicationAgeHours:distribution(ages.map(row=>row.publishedAgeHours)),
  publicationAgeBuckets:counts(ages.map(row=>row.publishedAgeHours<=24?'0–24h':row.publishedAgeHours<=72?'24–72h':row.publishedAgeHours<=168?'72–168h':row.publishedAgeHours<=720?'168–720h':'>720h')),
  publicationAge24HourBuckets:counts(ages.map(row=>`${Math.floor(row.publishedAgeHours/24)*24}–${(Math.floor(row.publishedAgeHours/24)+1)*24}h`)),
  allPriorPossibleClusters:clusterTransitions.length,allTransitionGroups,
  disappearedFilteredClusters:removed.length,disappearedFilteredEntries:removed.reduce((sum,row)=>sum+row.members.length,0),
  disappearedGroups:counts(removed.map(row=>row.rules[0])),
};
const findings=[
  {question:1,locations:['research/actionability.ts:3-7','research/actionability.ts:82-145','research/actionability.ts:148-159','research/actionability.ts:167-242','research/research-pipeline.ts:2550-2578'],
    analysis:'TEST_NOW requires an executable API/SDK, demo, repository or workflow entry plus the quality gate (verified or partially verified, relevance >=75, reliability >=70, freshness >=65 OR in requested window). Earlier branches exclude BACKGROUND, no information gain and academic-only material. The other statuses are REVIEW_FIRST, LIBRARY_ONLY and BACKGROUND; MUST_READ accepts only TEST_NOW. A security announcement is not categorically excluded, but its update/download/settings action is not itself one of the recognized entry types. It can reach TEST_NOW if it really supplies a recognized executable entry and satisfies the remaining gates; TEST_NOW is necessary, not sufficient, for MUST_READ.'},
  {question:2,locations:['research/research-pipeline.ts:2031-2040','research/research-pipeline.ts:2179-2187','research/research-pipeline.ts:2214-2224','research/research-pipeline.ts:2583-2604'],
    analysis:'eventStatus SIGNAL is socialOnly OR verificationStatus unverified. It requires no multiple independent sources. A primary source without a conflict sets verified; other event statuses then follow tracking/update/window checks. Do not confuse eventStatus with informationType or fusion.signalType. WORTH_WATCHING specifically requires eventStatus SIGNAL, so an official NEW announcement cannot pass this branch merely by adding more corroborating sources.'},
  {question:3,locations:['information/freshness.ts:86-121','research/research-pipeline.ts:2125-2131','research/research-pipeline.ts:2207-2224','research/research-pipeline.ts:2591','research/actionability.ts:209-220'],
    analysis:'Freshness is absolute age versus now (the frozen replay fixes now to asOf/window end), using latest update when inferred/explicit, otherwise original occurrence then publication. Scores: <=0.5h 100; <=1h 96; <=6h 90; <=24h 80; <=72h 65; <=168h 48; <=720h 25; older 15. A requested window does not rescale this score. TEST_NOW has an in-window alternative, WORTH_WATCHING freshness>=80 does not. Publication-age statistics below are publication dates, not silently substituted effective occurrence dates.'},
  {question:4,locations:['research/topic-relevance.ts:590-592','research/topic-relevance.ts:629-641','research/filtering-summary.ts:125-140','research/research-pipeline.ts:2235-2245','research/research-pipeline.ts:2608-2611'],
    analysis:'原有可能相关共 13 簇，其中 3 簇转入资料库，10 簇变为 FILTERED：8 簇任务约束不匹配，2 簇虽匹配任务但在时间窗口外，最终标记 BACKGROUND_ONLY。离开可能相关不等于全部丢弃。安全概念变为可判断后，未命中可从 UNCERTAIN 变为 TOPIC_MISMATCH。逐条映射仅在 PRIVATE 文件中。BACKGROUND_ONLY 的展示归因见 research/filtering-summary.ts:65-75，窗口资格见 research/research-pipeline.ts:2207-2245。'},
];
const analysis=[
  {gate:'TEST_NOW',fit:'Suitable for immediately testable tools, too narrow as a general importance prerequisite for security advisories or release announcements with no recognized execution link. A single official source is not excluded by this gate itself.',alternatives:[
    {scope:'Separate immediate execution from formal attention, retaining evidence, relevance and date gates',tests:['tests/upgrade-answer-presentation.test.ts','tests/actionability-window.test.ts','tests/public-alpha-research.test.ts','tests/reliability-positive.test.ts']},
    {scope:'Broaden executable-entry semantics to genuine update/patch actions only',tests:['tests/upgrade-answer-presentation.test.ts','tests/actionability-window.test.ts','tests/source-enrichment.test.ts']}]},
  {gate:'eventStatus === SIGNAL',fit:'Suitable if WORTH_WATCHING means early unverified leads; unsuitable if it also means credible official changes worth reading. This is a semantic category gate, not a source-count requirement.',alternatives:[
    {scope:'Keep the early-signal meaning and separately define attention to verified announcements',tests:['tests/signal-fusion.test.ts','tests/source-enrichment.test.ts','tests/public-alpha-research.test.ts']},
    {scope:'Extend WORTH_WATCHING event categories while retaining reliability/date/topic constraints',tests:['tests/signal-fusion.test.ts','tests/reliability-positive.test.ts','tests/task-relevance.test.ts','tests/d06-event-grouping.test.ts']}]},
  {gate:'freshnessScore >= 80',fit:'Suitable for near-real-time <=24h early signals, not for treating every valid item in a seven-day requested window as equally eligible. It must not be confused with timestamp correctness.',alternatives:[
    {scope:'Use requested-window eligibility for attention while retaining absolute age as ranking information',tests:['tests/actionability-window.test.ts','tests/freshness-parsing.test.ts','tests/today-window.test.ts','tests/comfyui-pipeline-window.test.ts','tests/eval-frozen.test.mjs']},
    {scope:'Keep the <=24h early-signal lane and make its narrower meaning explicit',tests:['tests/research-diagnostics-ui.test.ts','tests/coverage-notice.test.ts','tests/user-facing-labels.test.ts']}]},
];
for (const row of analysis) for (const alternative of row.alternatives) for (const test of alternative.tests) readFileSync(resolve(root,test));
mkdirSync(output,{recursive:true});
const report={baseline,node:process.version,input:{path:input,sha256:createHash('sha256').update(bytes).digest('hex')},summary,findings,ages,clusterTransitions,analysis,
  limitations:['Existing PRIVATE replay is reused; no new online or model run.','Step 3 comes from the prior frozen offline artifact, not a fresh run of its historical commit.','No full frozen detail HTML or human gold labels; no product-effectiveness claim.'],networkRequests:0,modelCalls:0};
writeFileSync(resolve(output,'PRIVATE-gate-semantics.json'),JSON.stringify(report,null,2)+'\n');
writeFileSync(resolve(output,'PRIVATE-gate-semantics.md'),'# 正式关注门禁语义确认\n\n'+findings.map(row=>`## ${row.question}\n\n${row.analysis}\n\n代码：${row.locations.join('；')}`).join('\n\n')+
  '\n\n## 汇总分布\n\n```json\n'+JSON.stringify(summary,null,2)+'\n```\n\n## 适用性与可能调整范围（未实施）\n\n'+analysis.map(row=>`### ${row.gate}\n\n${row.fit}\n\n`+row.alternatives.map(value=>`- ${value.scope}；需复核测试：${value.tests.join('、')}`).join('\n')).join('\n\n')+
  '\n\n## 未验证项\n\n'+report.limitations.map(value=>`- ${value}`).join('\n')+'\n');
console.log(JSON.stringify(summary));
