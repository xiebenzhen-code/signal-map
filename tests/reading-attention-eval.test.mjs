import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
test('frozen evaluation counts main reading cards and nested updates separately with all dates checked', () => {
 const dir=mkdtempSync(join(tmpdir(),'PRIVATE-a6-eval-'));
 try {
  const child=spawnSync(process.execPath,['--experimental-strip-types','scripts/eval-frozen.mjs','--output-dir',dir],{encoding:'utf8',timeout:30000});
  assert.equal(child.status,0,child.stderr);
  const report=JSON.parse(readFileSync(join(dir,'results.json'),'utf8'));
  for(const row of report.cases){
   assert.equal(row.mustReadMainCount,row.formalItems.filter(item=>item.attentionDecision==='MUST_READ').length);
   assert.ok(row.mustReadMainCount > 0, 'real frozen official announcements without execution entries must reach reading attention');
   assert.ok(row.formalItems.filter(item=>item.attentionDecision==='MUST_READ').every(item=>item.actionabilityStatus!=='TEST_NOW' && !item.executionEntry), 'reading priority must not invent an execution entry');
   assert.equal(row.relatedUpdateCount,row.formalItems.flatMap(item=>item.relatedUpdates??[]).length);
   assert.equal(row.worthWatchingCount,row.formalItems.filter(item=>item.attentionDecision==='WORTH_WATCHING').length);
   assert.equal(row.compressionRatio,row.mustReadMainCount?row.fetchedCount/row.mustReadMainCount:null);
   assert.equal(row.outsideWindowReturnedCardCount,0);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
