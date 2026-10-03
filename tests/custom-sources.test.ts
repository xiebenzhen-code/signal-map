import assert from "node:assert/strict";
import test from "node:test";
import { parseCustomSources } from "../lib/custom-sources.ts";
import { readCustomSource } from "../source-enrichment/custom-source.ts";
import { runResearchPipeline } from "../research/research-pipeline.ts";
import { composeActiveKnowledgeContext, createEmptyFilterKnowledge, updateFilterResearchConfig } from "../information/knowledge-state.ts";
import { createResearchRequest } from "../information/research-request.ts";
import type { InformationFilter } from "../information/types.ts";

const page = '<html><head><title>ComfyUI sampling update</title><meta property="article:published_time" content="2026-10-02T08:00:00Z"></head><body><nav>navigation account login</nav><article><h1>ComfyUI sampling update</h1><p>Improve sampling performance and reduce memory usage in ComfyUI workflows. '+ 'The update adds a new preview option and fixes the documented sampling issue. '.repeat(8)+'</p></article></body></html>';
const publicLookup = async () => [{address:"93.184.216.34",family:4}];
test("source input normalizes public links and refuses credentials/local addresses", () => {
  const result = parseCustomSources("example.com/updates\nhttps://example.com/updates#section\nhttp://localhost/a\nhttps://user:password@example.com");
  assert.deepEqual(result.urls,["https://example.com/updates"]);
  assert.equal(result.errors.length,2);
  assert.doesNotMatch(JSON.stringify(result.errors),/password/);
});
test("source input has a five-link cap", () => {
  const result=parseCustomSources(Array.from({length:6},(_,i)=>`https://example.com/${i}`));
  assert.equal(result.urls.length,5);
  assert.ok(result.errors.length);
});

test("source URL validation rejects compressed transition IPv6 and excessively long links",()=>{
  for(const url of ["http://[2001::1]/","http://[2001:0000::1]/",`https://example.com/${"a".repeat(2100)}`]) {
    assert.ok(parseCustomSources(url).errors.length);
  }
});
test("source reader keeps article text and publication date without certifying the source", async () => {
  const result=await readCustomSource("https://example.com/update",{lookup:publicLookup,request:async()=>({status:200,headers:{"content-type":"text/html"},body:page})});
  assert.equal(result.status,"readable");
  assert.match(result.content ?? "",/Improve sampling/);
  assert.doesNotMatch(result.content ?? "",/navigation account login/);
  assert.equal(result.publishedAt,"2026-10-02T08:00:00Z");
});
test("private DNS targets are blocked before transport", async () => {
  let requests=0;
  const result=await readCustomSource("https://example.com/update",{lookup:async()=>[{address:"127.0.0.1",family:4}],request:async()=>{requests++;return {status:200,headers:{},body:page};}});
  assert.equal(result.status,"blocked");assert.equal(requests,0);
});
test("redirect to private host is blocked rather than fetched", async () => {
  let requests=0;
  const result=await readCustomSource("https://example.com/update",{lookup:publicLookup,request:async()=>{requests++;return {status:302,headers:{location:"http://127.0.0.1/admin"},body:""};}});
  assert.equal(result.status,"blocked");assert.equal(requests,1);
});
test("login-required and thin pages have honest separate outcomes", async () => {
  for(const [status,body,expected] of [[401,"login","login_required"],[200,"<nav>Menu</nav>","too_thin"]] as const){
    const result=await readCustomSource("https://example.com/update",{lookup:publicLookup,request:async()=>({status,headers:{"content-type":"text/html"},body})});
    assert.equal(result.status,expected);
  }
});
test("deadline prevents any custom-source request", async () => {
  let requests=0;
  const result=await readCustomSource("https://example.com/update",{deadlineAt:Date.now()-1,lookup:publicLookup,request:async()=>{requests++;return {status:200,headers:{},body:page};}});
  assert.equal(result.status,"not_searched");assert.equal(requests,0);
});
test("sources are scoped to filters and transported only from the active context", () => {
  const a:InformationFilter={id:"a",filterName:"A",industry:"tools",focusAreas:[],freshnessWindow:"30d",sourceScope:"hybrid",customSources:["https://example.com/a"],createdAt:"",updatedAt:""};
  const b={...a,id:"b",customSources:["https://example.com/b"]};
  const knowledge=createEmptyFilterKnowledge("2026-10-03");
  const changed=updateFilterResearchConfig(a,knowledge,{customSources:["https://example.com/new"]},"2026-10-03");
  assert.ok(changed.knowledge.researchContextRevision>knowledge.researchContextRevision);
  assert.deepEqual(b.customSources,["https://example.com/b"]);
  const req=createResearchRequest(composeActiveKnowledgeContext({defaultIdentity:"builder"},changed.filter,changed.knowledge));
  assert.deepEqual(JSON.parse(String(req.body)).customSources,["https://example.com/new"]);
});
test("real pipeline consumes supplied links even when automatic providers exclude them",async(t)=>{
  let calls=0;
  t.mock.method(globalThis,"fetch",async()=>new Response("",{status:404}));
  const response=await runResearchPipeline({identity:"builder",industry:"tools",focusAreas:"ComfyUI",currentQuestions:"ComfyUI sampling update",knownInformation:"",informationGaps:"",trackedEntities:"ComfyUI",trackedEvents:"",userJudgements:"",evidenceHistory:"",freshnessWindow:"30d",customSources:"https://example.com/update"},undefined,
    {customSourceReader:async()=>{calls++;return {url:"https://example.com/update",canonicalUrl:"https://example.com/update",status:"readable",reason:"正文可读取",content:page,title:"ComfyUI sampling update",publishedAt:"2026-10-02T08:00:00Z",requestCount:1};}} as never,
    {allowedProviderIds:["not-configured-test-provider"],primarySourceType:"OFFICIAL",fallbackSourceTypes:[],reason:"test"});
  assert.equal(calls,1);
  assert.ok((response.evidenceAccounting?.discoveredCandidateCount ?? 0)>0,"custom source must enter the candidate pool");
  assert.ok(response.evidenceRecords?.some(record=>record.sourceUrl==="https://example.com/update"),"custom page body must produce evidence, even if gates reject it");
  const checks=(response as typeof response & {customSourceChecks?:Array<{status:string}>}).customSourceChecks;
  assert.equal(checks?.[0]?.status,"readable");
  assert.match(response.customSourceChecks?.[0]?.reason ?? "",/本次结果|未通过本次筛选/);
  assert.ok(response.sourceOutcomes?.some(o=>o.providerId==="custom-sources" && o.executed));
  assert.ok(response.signals.every(s=>s.sourceTier!=="S"));
});

test("source-check endpoint does not run research or expose fetched content",async()=>{
  const {createSourceCheckHandler}=await import("../backend/custom-sources.ts");
  let calls=0;
  const handler=createSourceCheckHandler(async(url)=>{calls++;return {url,status:"readable",reason:"正文可读取",requestCount:1,content:"PRIVATE RESPONSE TEXT"};});
  const request=new Request("http://localhost:8080/api/sources/check",{method:"POST",headers:{Origin:"http://localhost:3000","Content-Type":"application/json"},body:JSON.stringify({urls:["https://example.com/update"]})});
  const response=await handler(request);
  assert.equal(response.status,200);assert.equal(calls,1);
  assert.doesNotMatch(await response.text(),/PRIVATE RESPONSE TEXT/);
});
test("source-check refuses hostile origin and invalid URLs without fetching",async()=>{
  const {createSourceCheckHandler}=await import("../backend/custom-sources.ts");
  let calls=0;
  const handler=createSourceCheckHandler(async(url)=>{calls++;return {url,status:"failed",reason:"unexpected",requestCount:0};});
  for(const [origin,url,expected] of [["http://evil.example","https://example.com",403],["http://localhost:3000","http://127.0.0.1",400]] as const){
    const response=await handler(new Request("http://localhost:8080/api/sources/check",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({urls:[url]})}));
    assert.equal(response.status,expected);
  }
  assert.equal(calls,0);
});
