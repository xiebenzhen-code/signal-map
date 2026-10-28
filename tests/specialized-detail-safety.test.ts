import assert from "node:assert/strict";
import test from "node:test";
import { enrichDetail, type DetailReadOptions } from "../source-enrichment/detail-enricher.ts";
const address = { address: "93.184.216.34", family: 4 };
const page = `<html><head><title>Example Editor</title></head><article>${"The editor launches video rendering and collaborative editing tools. ".repeat(10)}</article></html>`;
const phPage = '<html><title>Product Hunt</title><body>Launch archive <a href="https://official.example/" >Visit website</a></body></html>';
const ph = { providerId: "product-hunt", url: "https://www.producthunt.com/posts/editor", title: "Editor" };
const hf = { providerId: "huggingface", url: "https://huggingface.co/team/editor", title: "Editor" };
const lookup = async () => [address];
for (const mode of ["redirect", "dns"] as const) test(`Product Hunt official website blocks private ${mode} without a private request`, async t => {
  let publicRequests = 0; let privateRequests = 0;
  const original = globalThis.fetch;
  // Old implementation's unsafe fetch would reach the private response; no real network.
  globalThis.fetch = (async value => {
    if (String(value).includes("producthunt.com")) return new Response(phPage);
    privateRequests++; return new Response(page);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  const result = await enrichDetail(ph, {
    lookup: async host => mode === "dns" && host === "official.example" ? [{ address: "10.0.0.1", family: 4 }] : [address],
    request: async url => {
      if (url.hostname === "127.0.0.1" || url.hostname === "10.0.0.1") privateRequests++;
      else publicRequests++;
      return url.hostname.includes("producthunt") ? { status: 200, headers: {}, body: phPage }
        : { status: 302, headers: { location: "http://127.0.0.1/admin" }, body: "" };
    },
  });
  assert.equal(privateRequests, 0);
  assert.ok(publicRequests >= 1, "FIXTURE_NOT_EFFECTIVE");
  assert.equal(result.status, "FETCH_FAILED");
  assert.equal(result.failureCode, mode === "dns" ? "DETAIL_PRIVATE_ADDRESS" : "DETAIL_UNSAFE_REDIRECT");
  assert.equal(result.rawContent, undefined);
});
test("Product Hunt legitimate official website still succeeds through the pinned transport", async () => {
  let calls = 0;
  const result = await enrichDetail(ph, { lookup, request: async (url, pinned, signal, headers) => {
    calls++; assert.deepEqual(pinned,address); assert.equal(signal.aborted,false);
    assert.deepEqual(Object.keys(headers ?? {}).sort(),["Accept","User-Agent"]);
    return {status:200,headers:{},body:url.hostname.includes("producthunt")? phPage:page};
  }});
  assert.equal(calls,2); assert.equal(result.status,"SUCCESS");
  assert.equal(result.canonicalUrl,"https://official.example/");
  assert.match(result.rawContent ?? "",/collaborative editing/);
});
test("Hugging Face README redirect is blocked before any private request", async () => {
  let calls=0;
  const result=await enrichDetail(hf,{lookup,request:async () => {calls++;return {status:302,headers:{location:"http://127.0.0.1/readme"},body:""};}});
  assert.equal(calls,1);assert.equal(result.status,"FETCH_FAILED");assert.equal(result.failureCode,"DETAIL_UNSAFE_REDIRECT");
});
test("Hugging Face fallback page validates DNS after a missing README", async () => {
  let lookups=0;let calls=0;
  const result=await enrichDetail(hf,{lookup:async () => ++lookups===1?[address]:[{address:"10.0.0.1",family:4}],request:async () => {calls++;return {status:404,headers:{},body:""};}});
  assert.equal(calls,1);assert.equal(lookups,2);assert.equal(result.failureCode,"DETAIL_PRIVATE_ADDRESS");
});
test("Hugging Face README preserves usable content with a one MiB streaming cap", async () => {
  let bytes=0;let closed=false;let calls=0;
  async function* body(){try {bytes+=1024;yield Buffer.from("README release editor ".repeat(60).slice(0,1024));for(let i=0;i<100;i++){bytes+=65536;yield Buffer.alloc(65536,97);}}finally{closed=true;}}
  const result=await enrichDetail(hf,{lookup,request:async () => {calls++;return {status:200,headers:{},body:body()};}});
  assert.equal(calls,1);assert.equal(result.status,"SUCCESS");assert.equal(result.contentType,"markdown");assert.ok(bytes<=1048576+65536);assert.equal(closed,true);
});
for (const input of [ph,hf]) test(`${input.providerId} shares one deadline across its reads`, async () => {
  let requests=0;
  const options:DetailReadOptions={lookup:async () => {await new Promise(resolve=>setTimeout(resolve,50));return [address];},request:async () => {requests++;return {status:200,headers:{},body:page};}};
  const result=await enrichDetail({...input,deadlineAt:Date.now()+10},options);
  assert.equal(result.failureCode,"DETAIL_TIMEOUT");await new Promise(resolve=>setTimeout(resolve,70));assert.equal(requests,0);
});

for (const input of [ph,hf]) test(`${input.providerId} does not reset the deadline for its second read`, async () => {
  let lookups=0;let requests=0;
  const result=await enrichDetail({...input,deadlineAt:Date.now()+100},{
    lookup:async () => {lookups++;if(lookups===2) await new Promise(resolve=>setTimeout(resolve,150));return [address];},
    request:async () => {requests++;return input===ph?{status:200,headers:{},body:phPage}:{status:404,headers:{},body:""};},
  });
  assert.equal(result.failureCode,"DETAIL_TIMEOUT");
  await new Promise(resolve=>setTimeout(resolve,170));
  assert.equal(lookups,2);assert.equal(requests,1);
});
test("Hugging Face metadata fallback retains transport failure diagnosis without private content",async () => {
  let requests=0;
  const result=await enrichDetail({...hf,metadata:{snippet:"The team released a video editor with rendering and editing features. ".repeat(8)}},{lookup:async () => [{address:"10.0.0.1",family:4}],request:async()=>{requests++;throw new Error("must not request");}});
  assert.equal(requests,0);assert.equal(result.failureCode,"DETAIL_PRIVATE_ADDRESS");
  assert.equal(result.contentType,"metadata");assert.equal(result.evidenceFrom,"Hugging Face API metadata");
});
