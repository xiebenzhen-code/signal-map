import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {assessTopicRelevance} from '../research/topic-relevance.ts';
import {registeredPublisherNames,selectRegisteredFeeds} from '../source-registry/feed-catalog.ts';
import {parseRegisteredFeed} from '../research/registered-feeds.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/d06-plan.json',import.meta.url),'utf8'));
const entries=parseRegisteredFeed(readFileSync(new URL('./fixtures/d06-chrome.xml',import.meta.url),'utf8'),selectRegisteredFeeds({entities:['Chrome'],query:''}).find(x=>x.id==='chrome')!).entries;
const source=readFileSync(new URL('../research/topic-relevance.ts',import.meta.url),'utf8').replace(/^import .*$/gm,'').replace(/\bexport /g,'');
const {constraintTermsFrom}=new Function('registeredPublisherNames',ts.transpile(source,{target:ts.ScriptTarget.ES2022})+';return {constraintTermsFrom};')(registeredPublisherNames);
test('D06 compound security wording extracts the task without browser or temporal residue',()=>{
 assert.deepEqual(constraintTermsFrom(['安全更新','浏览器安全','浏览器','browser','this','week'],new Set(['chrome'])),['安全']);
});
test('D06 real security bulletin matches while entity-only release remains unconfirmed',()=>{
 const security=entries.find(x=>/CVE-/i.test(x.snippet))!;
 assert.ok(security);
 const result=assessTopicRelevance(security.title+' '+security.snippet,fixture.plan);
 assert.equal(result.decision,'MATCH');
 assert.ok(result.matchedTaskConstraints.includes('安全'));
 const ordinary=entries.find(x=>/Dev for Desktop/.test(x.title))!;
 assert.notEqual(assessTopicRelevance(ordinary.title+' '+ordinary.snippet,fixture.plan).decision,'MATCH');
});
