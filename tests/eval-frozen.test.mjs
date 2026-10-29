import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { partitionBackground } from '../research/background.ts';

test('frozen evaluation replays real fixtures deterministically without external requests', () => {
  const directory = mkdtempSync(join(tmpdir(), 'signal-map-eval-'));
  try {
    const replay = () => {
      const child = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/eval-frozen.mjs', '--output-dir', directory],
        { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 30000 });
      assert.equal(child.status, 0, child.stderr || child.stdout);
      return JSON.parse(readFileSync(join(directory, 'results.json'), 'utf8'));
    };
    const first = replay();
    assert.deepEqual(replay(), first, 'same frozen input and clock must reproduce results');
    assert.equal(first.networkRequests, 0);
    assert.equal(first.modelCalls, 0);
    assert.equal(first.cases.length, 2, 'one fixture, two explicitly separated plan modes');
    assert.deepEqual(first.cases.map(item => item.planMode), ['frozen', 'rebuilt']);
    const row = first.cases[0];
    assert.equal(row.id, 'D06');
    assert.equal(row.fetchedCount, 25);
    assert.ok(row.fixtureReads > 0, 'fixture must actually be consumed');
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/d06-plan.json', import.meta.url), 'utf8'));
    assert.deepEqual(row.queryPlan, fixture.plan, 'complete frozen plan must survive unchanged');
    assert.equal('admittedCount' in row, false);
    for (const item of first.cases) {
      assert.equal(item.formalAttentionCount, item.formalItems.length);
      assert.equal(item.libraryCount, item.libraryItems.length);
      assert.equal(item.returnedCardCount, item.formalAttentionCount + item.libraryCount);
      assert.equal(item.possibleRelatedCount, item.possibleRelated.length);
      assert.equal(item.outsideWindowReturnedCardCount, item.outsideWindowReturnedCardIds.length);
      assert.equal(item.outsideWindowReturnedCardCount, 0, 'D06 dates must gate library cards too');
      assert.ok(Number.isInteger(item.retrievedCount));
      assert.equal(item.entries.length, 25);
      assert.equal(new Set(item.entries.map(entry => entry.entryId)).size, 25);
      assert.ok(item.formalAttentionCount > 0 || item.zeroDisplayReason);
      assert.ok(item.fixtureReads > 0, 'each mode must consume the real frozen feed');
    }
    assert.match(readFileSync(join(directory, 'results.md'), 'utf8'), /资料库.*可能相关.*窗口外进入返回卡片数/);
    assert.match(readFileSync(join(directory, 'results.md'), 'utf8'), /D06/);
    assert.match(first.limitations, /人工/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('D03 complete OBS control snapshot is actually replayed in both modes', () => {
 const directory=mkdtempSync(join(tmpdir(),'signal-map-control-'));
 try {
 const child=spawnSync(process.execPath,['--experimental-strip-types','scripts/eval-frozen.mjs','--output-dir',directory,'--fixture','tests/fixtures/d03-plan.json'],{encoding:'utf8',timeout:30000});
 assert.equal(child.status,0,child.stderr);
 const report=JSON.parse(readFileSync(join(directory,'results.json'),'utf8'));
 assert.deepEqual(report.cases.map(row=>row.id),['D03','D03']);
 for(const row of report.cases){assert.ok(row.fixtureReads>0);assert.equal(row.fetchedCount,10);assert.equal(row.outsideWindowReturnedCardCount,0,'OBS control dates must gate library cards too');}
 assert.equal(report.networkRequests,0);
 } finally {rmSync(directory,{recursive:true,force:true});}
});


test('D06 outside-window entries are metadata-only background, never judged or returned cards', () => {
 const directory = mkdtempSync(join(tmpdir(), 'signal-background-'));
 try {
  const child = spawnSync(process.execPath, ['--experimental-strip-types','scripts/eval-frozen.mjs','--output-dir',directory], {encoding:'utf8',timeout:30000});
  assert.equal(child.status,0,child.stderr);
  const report=JSON.parse(readFileSync(join(directory,'results.json'),'utf8'));
  for(const row of report.cases){
   const outside=row.entries.filter(entry=>!entry.inWindow);
   assert.equal(outside.length,9,'the real D06 snapshot must be consumed');
   assert.equal(row.backgroundCount,9);
   assert.equal(row.background.length,9);
   for(const entry of outside){
    const background=row.background.find(item=>item.url===entry.url);
    assert.ok(background,'each old entry must survive as background metadata');
    assert.equal(background.publishedAt,entry.publishedAt);
    assert.ok(background.title && background.source && background.url);
    assert.deepEqual(Object.keys(background).sort(),['publishedAt','source','title','url']);
    assert.equal(entry.decision,null,'background must not reach relevance judgement');
    assert.equal(entry.destination,'BACKGROUND');
    assert.ok(!row.filteringDetails.some(item=>item.sources.some(source=>source.sourceUrl===entry.url)));
   }
   assert.equal(row.outsideWindowReturnedCardCount,0);
  }
  assert.match(readFileSync(join(directory,'results.md'),'utf8'),/背景数/);
 } finally {rmSync(directory,{recursive:true,force:true});}
});


test('background partition does not launder invalid or future timestamps and deduplicates URLs', () => {
 const old={title:'archived announcement',source:'Official',url:'https://example.org/old',publishedAt:'2000-01-01T00:00:00.000Z'};
 const future={...old,url:'https://example.org/future',publishedAt:'2999-01-01T00:00:00.000Z'};
 const invalid={...old,url:'https://example.org/invalid',publishedAt:'not a date'};
 const missing={...old,url:'https://example.org/missing',publishedAt:undefined};
 const metadataConflict={...old,url:'https://example.org/conflict',metadataPublishedAt:'2001-01-01T00:00:00.000Z'};
 const result=partitionBackground([old,old,future,invalid,missing,metadataConflict],'7d');
 assert.equal(result.background.length,1);
 assert.deepEqual(result.current,[future,invalid,missing,metadataConflict]);
 assert.deepEqual(Object.keys(result.background[0]).sort(),['publishedAt','source','title','url']);
});
