import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {parseRegisteredFeed} from '../research/registered-feeds.ts';
import {selectRegisteredFeeds} from '../source-registry/feed-catalog.ts';
const feed=selectRegisteredFeeds({entities:['Chrome'],query:''}).find(x=>x.id==='chrome')!;
const entries=parseRegisteredFeed(readFileSync(new URL('./fixtures/d06-chrome.xml',import.meta.url),'utf8'),feed).entries;
const source=readFileSync(new URL('../research/research-pipeline.ts',import.meta.url),'utf8');
const start=source.indexOf('function titleTokens('),end=source.indexOf('function hasConflict(',start);
const {sameEvent,clusterEvents}=new Function(ts.transpile(source.slice(start,end),{target:ts.ScriptTarget.ES2022})+';return {sameEvent,clusterEvents};')();
test('D06 platform, release channel and version delimit distinct announcements',()=>{
 for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
  assert.equal(sameEvent(entries[i],entries[j]),false,entries[i].title+' / '+entries[j].title);
 }
 assert.equal(clusterEvents(entries).length,25);
});
test('same release can cluster but every member must be compatible',()=>{
 const first=entries[0];
 assert.equal(sameEvent(first,{...first,url:first.url+'?mirror=1'}),true);
 // A-B and A-C overlap, but B-C do not: first-only comparison must not bridge them.
 const items=[{title:'alpha beta gamma delta',url:'https://a.example/1',snippet:''},{title:'alpha beta gamma epsilon',url:'https://a.example/2',snippet:''},{title:'alpha beta delta zeta',url:'https://a.example/3',snippet:''}];
 const clusters=clusterEvents(items);
 assert.ok(clusters.every((members:typeof items)=>members.every(a=>members.every(b=>sameEvent(a,b)))));
});
