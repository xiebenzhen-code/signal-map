import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {hasOppositeClaims} from '../signal-fusion/claim-conflict.ts';
import {parseRegisteredFeed} from '../research/registered-feeds.ts';
import {selectRegisteredFeeds} from '../source-registry/feed-catalog.ts';
const feed=selectRegisteredFeeds({entities:['Chrome'],query:''}).find(x=>x.id==='chrome')!;
const entries=parseRegisteredFeed(readFileSync(new URL('./fixtures/d06-chrome.xml',import.meta.url),'utf8'),feed).entries;
const source=readFileSync(new URL('../research/research-pipeline.ts',import.meta.url),'utf8');
const start=source.indexOf('function hasConflict('),end=source.indexOf('\nfunction clamp(',start);
const hasConflict=new Function('hasOppositeClaims',ts.transpile(source.slice(start,end))+';return hasConflict;')(hasOppositeClaims);
test('D06 CVE incorrect authorization is a defect description, not a dispute',()=>{
 assert.ok(entries.some(x=>/incorrect/i.test(x.snippet)),'real CVE canary');
 assert.equal(hasConflict(entries),false);
});
test('opposite statements require the same locatable proposition',()=>{
 const item=(snippet:string)=>({title:'Product announcement',snippet});
 assert.equal(hasConflict([item('Model X is available.'),item('Model X is not available.')]),true);
 assert.equal(hasConflict([item('Model X is available.'),item('Model Y is not available.')]),false);
});
