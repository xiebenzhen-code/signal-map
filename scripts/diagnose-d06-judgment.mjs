// Offline diagnostic only. All per-item outputs must remain outside Git in PRIVATE files.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, isAbsolute, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = '0ad804a4481110b18a00e5806a3ebbe3a1f3f29a';
const output = process.argv[2];
if (!output || !isAbsolute(output) || !relative(root, output).startsWith('..')) throw new Error('Output must be an absolute path outside the repository');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
// Permit subsequent diagnostic-only commits, but require the same product blob.
const product = 'research/research-pipeline.ts';
const blob = ref => execFileSync('git', ['rev-parse', `${ref}:${product}`], { cwd: root, encoding: 'utf8' }).trim();
if (blob(head) !== blob(baseline)) throw new Error('Product baseline drift');
mkdirSync(output, { recursive: true });
const privatePath = name => resolve(output, `PRIVATE-${name}`);
const original = readFileSync(resolve(root, product), 'utf8');
let source = original;
const lineOf = (expression, start) => {
  const offset = original.indexOf(expression, start);
  if (offset < 0) throw new Error('Source location not found');
  return original.slice(0, offset).split('\n').length;
};
// Parse conjunctions structurally: preserve nested ORs and execute every independent gate.
function clauses(expression) {
  const node = ts.createSourceFile('gate.ts', `const gate = ${expression};`, ts.ScriptTarget.Latest, true);
  const initializer = node.statements[0].declarationList.declarations[0].initializer;
  const result = [];
  function visit(value) {
    if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      visit(value.left); visit(value.right);
    } else result.push(value.getText(node));
  }
  visit(initializer);
  return result;
}
for (const [variable, gate] of [['passesGates', 'MUST_READ'], ['canWatch', 'WORTH_WATCHING']]) {
  const pattern = new RegExp(`const ${variable} =([\\s\\S]*?);`);
  const match = source.match(pattern);
  if (!match) throw new Error('Gate anchor missing');
  const checks = clauses(match[1]);
  const gateStart = original.indexOf(`const ${variable} =`);
  const records = checks.map(expression => `{expression:${JSON.stringify(expression)},location:${JSON.stringify(`${product}:${lineOf(expression, gateStart)}`)},pass:Boolean(${expression})}`).join(',');
  source = source.replace(pattern, `const ${variable} = (() => { const checks = [${records}]; globalThis.__d06.gates.push({gate:${JSON.stringify(gate)},signal:structuredClone(signal),checks}); return checks.every(check => check.pass); })();`);
}
source = source.replace('const topicRelevance = assessTopicRelevance(clusterText, plan);',
  'const topicRelevance = assessTopicRelevance(clusterText, plan); globalThis.__d06.clusters.push({members:structuredClone(ordered),clusterText,topicRelevance});');
source = source.replace('const protectedReasons: ProtectedReason[] = [',
  'globalThis.__d06.actionability.push({id,assessment:structuredClone(actionability)}); const protectedReasons: ProtectedReason[] = [');
function absoluteImports(text, base) {
  return text.replace(/(from\s*|import\s*)(["'])(\.[^"']+)\2/g, (_all, prefix, quote, specifier) => `${prefix}${quote}${new URL(specifier, pathToFileURL(base)).href}${quote}`);
}
const pipelineFile = privatePath('instrumented-pipeline.mjs');
const transpiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
writeFileSync(pipelineFile, absoluteImports(transpiled, resolve(root, product)));
let runner = absoluteImports(readFileSync(resolve(root, 'scripts/eval-frozen.mjs'), 'utf8').replaceAll('\r\n','\n'), resolve(root, 'scripts/eval-frozen.mjs'));
runner = runner.replace(pathToFileURL(resolve(root, product)).href, pathToFileURL(pipelineFile).href);
runner = runner.replace('const cases = [];', 'const cases = []; globalThis.__d06 = {gates:[],clusters:[],actionability:[]};');
runner = runner.replace('fixtureReads = 0;\n  unavailableDetailReads = 0;', 'fixtureReads = 0;\n  unavailableDetailReads = 0; globalThis.__d06 = {gates:[],clusters:[],actionability:[]};');
runner = runner.replace('cases.push(row);', 'row.diagnostic = structuredClone(globalThis.__d06); cases.push(row);');
runner = runner.replace("new URL('../tests/fixtures/d06-plan.json', import.meta.url)", JSON.stringify(pathToFileURL(resolve(root, 'tests/fixtures/d06-plan.json')).href));
// The fallback above needs a URL object, not a string.
runner = runner.replace(`: ${JSON.stringify(pathToFileURL(resolve(root, 'tests/fixtures/d06-plan.json')).href)}`, `: new URL(${JSON.stringify(pathToFileURL(resolve(root, 'tests/fixtures/d06-plan.json')).href)})`);
runner = runner.replace("'results.json'", "'PRIVATE-results.json'").replace("'results.md'", "'PRIVATE-results.md'");
writeFileSync(privatePath('runner.mjs'), runner);
const run = spawnSync(process.execPath, ['--experimental-strip-types', privatePath('runner.mjs'), '--output-dir', output], { cwd: root, encoding: 'utf8' });
writeFileSync(privatePath('replay.log'), `${run.stdout ?? ''}\n${run.stderr ?? ''}\nexit=${run.status}\n`);
if (run.status !== 0) throw new Error('Replay failed; see PRIVATE-replay.log');
const result = JSON.parse(readFileSync(privatePath('results.json'), 'utf8'));
const step3Path = resolve(root, '../d06-four-repairs/step3/results.json');
const previous = JSON.parse(readFileSync(step3Path, 'utf8'));
const reference = JSON.parse(readFileSync(resolve(root, '../d06-four-repairs/final-d06/results.json'), 'utf8'));
for (const mode of result.cases) {
  const expected = reference.cases.find(row=>row.planMode===mode.planMode);
  for (const key of ['entries','libraryItems','formalItems','possibleRelated','filteringDetails']) {
    if (JSON.stringify(mode[key]) !== JSON.stringify(expected[key])) throw new Error(`Replay differs from uninstrumented baseline: ${mode.planMode}/${key}`);
  }
}
const summary = [];
const cards = [];
for (const mode of result.cases) {
  for (const card of mode.libraryItems) {
    const members = mode.entries.filter(entry => entry.clusterId === card.id);
    const gates = mode.diagnostic.gates.filter(record => record.signal.id === card.id);
    if (gates.length !== 2) throw new Error('Incomplete gate capture');
    for (const gate of gates) for (const check of gate.checks) {
      check.actualValues = Object.fromEntries([...check.expression.matchAll(/signal\.([A-Za-z]+)/g)].map(match => [match[1], gate.signal[match[1]] ?? null]));
    }
    cards.push({mode:mode.planMode,card,members,gates,actionability:mode.diagnostic.actionability.find(record=>record.id===card.id),blockingConditions:gates.flatMap(gate => gate.checks.filter(check => !check.pass).map(check => ({gate:gate.gate,...check}))),
      quotaAndEntitySuppression:'No prior promoted cards in this replay: quotas and repeated-entity guards do not suppress these library cards.'});
  }
  const blockers = new Map();
  for (const card of cards.filter(card => card.mode === mode.planMode)) for (const check of card.blockingConditions) {
    const key = `${check.gate}: ${check.expression}`;
    blockers.set(key, (blockers.get(key) ?? 0) + 1);
  }
  summary.push({mode:mode.planMode,library:mode.libraryCount,formal:mode.formalAttentionCount,possible:mode.possibleRelatedCount,
    blockers:[...blockers].map(([condition,count])=>({condition,count})).sort((a,b)=>b.count-a.count)});
}
const frozen = result.cases.find(row => row.planMode === 'frozen');
const old = previous.cases.find(row => row.planMode === 'frozen');
const transitions = old.entries.filter(entry => entry.destination === 'POSSIBLE_RELATED').map(entry => {
  const next = frozen.entries.find(value => value.entryId === entry.entryId);
  const cluster = frozen.diagnostic.clusters.find(value => value.members.some(member => member.url === entry.url));
  const oldCluster = old.filteringDetails.find(value => value.id === entry.clusterId);
  return {entryId:entry.entryId,before:entry,after:next,previousCluster:oldCluster,
    actualJudgmentText:cluster?.clusterText ?? null,verdict:cluster?.topicRelevance ?? null,
    securityInRawRss:/security|安全/i.test(`${entry.title} ${entry.snippet}`),
    securityInJudgmentText:cluster ? /security|安全/i.test(cluster.clusterText) : null,
    conceptWordsInJudgmentText:cluster ? [...new Set(cluster.clusterText.match(/\b(?:security|secure|vulnerability|vulnerabilities|scan|scanning)\b|安全/gi) ?? [])] : null,
    snippetComparisons:cluster?.members.map(member=>({url:member.url,rawRssSnippet:entry.url===member.url?entry.snippet:null,judgedSnippet:member.snippet,
      rawSecurityVisible:entry.url===member.url?/security|安全/i.test(entry.snippet):null,judgedSecurityVisible:/security|安全/i.test(member.snippet)})),
    finalFilteringRecord:frozen.filteringDetails.find(detail=>detail.id===next?.clusterId),
    detailBodyAvailable:false,absenceConclusion:cluster && /security|安全/i.test(cluster.clusterText)
      ? 'Security terms visible in actual judgment input.' : 'Not visible in available RSS/judgment text; no frozen detail HTML, so cannot conclude original article lacks security content.',
    ruleLocations:['research/topic-relevance.ts:590-592 (extract/match concepts)','research/topic-relevance.ts:636-641 (constraint hit or judgeable miss)',
      'research/filtering-summary.ts:125-140 (only UNCERTAIN enters possibleRelated)',`${product}:2235 (library eligibility)`,`${product}:2608 (returned confirmed partition)`]};
});
if (cards.filter(card=>card.mode==='frozen').length !== 3 || cards.filter(card=>card.mode==='rebuilt').length !== 11) throw new Error('Expected counts differ');
const report = {baseline,head,node:process.version,networkRequests:result.networkRequests,modelCalls:result.modelCalls,
  sourceHash:createHash('sha256').update(original).digest('hex'),step3Artifact:{path:step3Path,sha256:createHash('sha256').update(readFileSync(step3Path)).digest('hex')},
  summary,cards,transitions,limitations:['No frozen detail HTML or human labels; article-level absence cannot be established.',
    'Step 3 is an existing offline artifact, not a rerun of its historical commit.',
    'In-memory instrumentation records the same gate expressions; repository product files remain untouched.'],
  possibleAdjustmentPoints:[{point:'Formal-attention / executable-entry policy (diagnosis only; no change authorized)',tests:['tests/actionability-window.test.ts','tests/task-relevance.test.ts','tests/registered-feeds.test.ts']},
    {point:'Task-constraint extraction and uncertain routing (diagnosis only)',tests:['tests/task-relevance.test.ts','tests/coverage-notice.test.ts']},
    {point:'Missing detail-text observability (diagnosis only)',tests:['tests/detail-enrichment.test.ts','tests/detail-fetch-safety.test.ts']}]};
writeFileSync(privatePath('judgment-report.json'), JSON.stringify(report,null,2)+'\n');
const cardSections = cards.map(record=>`### ${record.mode} / ${record.card.id}\n\n`+
  `成员：${record.members.map(member=>`${member.entryId}；${member.publishedAt}；窗口内=${member.inWindow}`).join('\n\n')}\n\n`+
  `得分：${JSON.stringify(Object.fromEntries(Object.entries(record.card).filter(([key])=>/Score$/.test(key))))}\n\n`+
  `可执行性归因：${JSON.stringify(record.actionability)}；源码 research/actionability.ts:82-145、209-239。\n\n`+
  '| 目标档位 | 条件（含阈值） | 代码 | 实际值 | 通过 |\n| --- | --- | --- | --- | --- |\n'+
  record.gates.flatMap(gate=>gate.checks.map(check=>`| ${gate.gate} | ${check.expression.replaceAll('|','\\|')} | ${check.location} | ${JSON.stringify(check.actualValues)} | ${check.pass} |`)).join('\n')+
  `\n\n${record.quotaAndEntitySuppression}\n`).join('\n');
const transitionSections = transitions.map(record=>`### ${record.entryId}\n\n`+
  `前后去向：${record.before.destination} → ${record.after?.destination}；前后簇：${record.before.clusterId} → ${record.after?.clusterId}\n\n`+
  `实际判定：${JSON.stringify(record.verdict)}\n\n最终过滤记录：${JSON.stringify(record.finalFilteringRecord)}\n\n`+
  `RSS 含 security/安全=${record.securityInRawRss}；判断文本含词=${record.securityInJudgmentText}；安全概念组命中词=${JSON.stringify(record.conceptWordsInJudgmentText)}；${record.absenceConclusion}\n\n`+
  `规则：${record.ruleLocations.join('；')}。可能相关仅接收 UNCERTAIN；最终去向由实际过滤记录和返回集合交叉匹配，未将“离开可能相关”等同正式通过。\n\n`+
  `实际判断全文（未经截短）：\n\n\`\`\`text\n${record.actualJudgmentText}\n\`\`\`\n\n`+
  `RSS/判断摘要对照：\n\n\`\`\`json\n${JSON.stringify(record.snippetComparisons,null,2)}\n\`\`\`\n`).join('\n');
writeFileSync(privatePath('judgment-report.md'), '# D06 PRIVATE 判断层归因\n\n逐卡全部得分、成员日期和每个门禁布尔值见同名 JSON。未通过条件逐项列出；未修改阈值。重要度以实际 judgementImpactScore 列示，不另造一个不存在的分数。\n\n'+
  summary.map(row=>`## ${row.mode}\n\n资料库 ${row.library}；正式关注 ${row.formal}；可能相关 ${row.possible}\n\n| 阻挡条件 | 次数 |\n| --- | ---: |\n`+row.blockers.map(item=>`| ${item.condition} | ${item.count} |`).join('\n')).join('\n\n')+
  '\n\n以上频次按模式内卡片计数，不是唯一材料数；两个备选档位的阻挡不得相加解释为独立材料。\n\n## 逐卡完整门禁\n\n'+cardSections+
  '\n\n## 第 3 步到第 4 步的逐条去向\n\n'+transitionSections+
  '\n\n## 未验证项\n'+report.limitations.map(value=>`- ${value}`).join('\n')+
  '\n- RSS 解析本身存在 12000 字符上限（research/registered-feeds.ts:102）；正文未冻结，不能把摘要中无词证明为全文无词。摘要对照只能定位 RSS 解析后到判断输入之间的变化。\n'+
  '\n\n## 可能的调整点（仅列范围，不提出或实施修改）\n'+report.possibleAdjustmentPoints.map(value=>`- ${value.point}：${value.tests.join(', ')}`).join('\n')+'\n');
console.log(JSON.stringify({baseline,node:process.version,networkRequests:result.networkRequests,modelCalls:result.modelCalls,summary,transitionCount:transitions.length}));
