import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {parseRegisteredFeed} from '../research/registered-feeds.ts';
import {selectRegisteredFeeds} from '../source-registry/feed-catalog.ts';
import {fuseSignal} from '../signal-fusion/fusion.ts';
import type {FusionEvidence} from '../signal-fusion/types.ts';
const feed=selectRegisteredFeeds({entities:['Chrome'],query:''}).find(x=>x.id==='chrome')!;
const entries=parseRegisteredFeed(readFileSync(new URL('./fixtures/d06-chrome.xml',import.meta.url),'utf8'),feed).entries;
const evidence=(entry:typeof entries[number],i:number):FusionEvidence & {contentText:string}=>({evidenceId:String(i),claim:entry.title,contentText:entry.snippet,sourceUrl:entry.url,publisher:'Chrome',publishedAt:entry.publishedAt,sourceType:'primary',sourceTier:'S',verificationStatus:'verified',reliabilityScore:92,noveltyScore:85});
test('D06 different official Stable announcements are not duplicate noise',()=>{
 const releases=entries.filter(x=>x.title==='Stable Channel Update for Desktop' && /2026-10-(13|15)T/.test(x.publishedAt??''));
 assert.equal(releases.length,2);
 const result=fuseSignal(releases.map(evidence));
 assert.equal(result.cluster.duplicateCount,0);
 assert.equal(result.independentSourceCount,1,'one publisher remains one publisher');
 assert.notEqual(result.signalType,'NOISE');
});
test('D06 exact-content cross-domain republication remains a copy, not independent confirmation',()=>{
 const original=evidence(entries[0],0);
 const result=fuseSignal([original,{...original,evidenceId:'copy',sourceUrl:'https://mirror.example/reprint',publisher:'Mirror'}]);
 assert.equal(result.cluster.duplicateCount,1);
 assert.equal(result.independentSourceCount,1);
});
test('same official URL repeated remains a duplicate',()=>{
 const original=evidence(entries[0],0);
 assert.equal(fuseSignal([original,{...original,evidenceId:'repeat'}]).cluster.duplicateCount,1);
});
