import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyApiRequest } from '../backend/api-proxy.ts';

const request = (path = '/api/auth/login') => new Request('https://web.example' + path, {method:'POST', body:'SECRET_PASSWORD', headers:{cookie:'SECRET_COOKIE', 'x-cloudbase-request-id':'4bde908e-4b73-4c36-9f2f-49c68dd1817d'}});
async function capture(enabled, run) {
  const old = process.env.SIGNAL_MAP_PROXY_DIAGNOSTICS;
  const log = console.info;
  const events = [];
  process.env.SIGNAL_MAP_PROXY_DIAGNOSTICS = enabled;
  console.info = line => events.push(JSON.parse(line));
  try { return await run(events); }
  finally { console.info = log; if(old === undefined) delete process.env.SIGNAL_MAP_PROXY_DIAGNOSTICS; else process.env.SIGNAL_MAP_PROXY_DIAGNOSTICS = old; }
}
test('enabled diagnostics preserve cookies/body and never record secret values', async () => capture('1', async events => {
  const headers = new Headers({'content-type':'application/json', 'x-secret-header':'SECRET_HEADER'});
  headers.append('set-cookie','one=SECRET_TOKEN; HttpOnly');
  headers.append('set-cookie','two=SECRET_TOKEN_2; Secure');
  const upstream = new Response('SECRET_RESPONSE', {headers});
  let calls = 0;
  const response = await proxyApiRequest(request(), {upstream:'https://api.example',fetchFn:async()=>{calls++;return upstream;}});
  assert.equal(calls,1);
  assert.equal(response.status,200);
  assert.equal(await response.text(),'SECRET_RESPONSE');
  assert.deepEqual(response.headers.getSetCookie(),headers.getSetCookie());
  assert.deepEqual(events.map(e=>e.stage), ['start','request_body_ready','upstream_headers','response_constructed']);
  assert.equal(events[2].cookieCount,2);
  assert.equal(events[2].requestId,'4bde908e-4b73-4c36-9f2f-49c68dd1817d');
  assert.ok(!JSON.stringify(events).includes('SECRET'));
}));
test('fetch failure records bounded cause and preserves existing 502', async () => capture('1', async events => {
  const response = await proxyApiRequest(request(), {upstream:'https://api.example',fetchFn:async()=>{throw Object.assign(new TypeError('SECRET_URL'),{cause:{code:'ECONNRESET',message:'SECRET_TOKEN'}});}});
  assert.equal(response.status,502);
  assert.equal((await response.json()).code,'API_UPSTREAM_UNAVAILABLE');
  assert.equal(events.at(-1).failedStage,'fetch');
  assert.equal(events.at(-1).causeCode,'ECONNRESET');
  assert.ok(!JSON.stringify(events).includes('SECRET'));
}));
test('disabled and unrelated routes produce no diagnostics', async () => {
  for(const [flag,path] of [['0','/api/auth/login'],['1','/api/control/knowledge']]) await capture(flag,async events=>{
    await proxyApiRequest(request(path),{upstream:'https://api.example',fetchFn:async()=>new Response('ok')});
    assert.deepEqual(events,[]);
  });
});
test('broken logging cannot change proxy response', async () => {
  const old=console.info; const flag=process.env.SIGNAL_MAP_PROXY_DIAGNOSTICS;
  process.env.SIGNAL_MAP_PROXY_DIAGNOSTICS='1'; console.info=()=>{throw new Error('logger failed');};
  try { const r=await proxyApiRequest(request(),{upstream:'https://api.example',fetchFn:async()=>new Response('ok')}); assert.equal(r.status,200); assert.equal(await r.text(),'ok'); }
  finally {console.info=old;if(flag===undefined)delete process.env.SIGNAL_MAP_PROXY_DIAGNOSTICS;else process.env.SIGNAL_MAP_PROXY_DIAGNOSTICS=flag;}
});
