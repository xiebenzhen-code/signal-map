import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import http from 'node:http';
import { proxyApiRequest } from '../backend/api-proxy.ts';

const loginRequest = (path = '/api/auth/login') => new Request(`https://web.example${path}`, {
  method: 'POST', body: 'SYNTHETIC_PASSWORD', headers: { 'content-type': 'application/json' },
});
async function captured(run) {
  const oldFlag = process.env.SIGNAL_MAP_PROXY_DIAGNOSTICS;
  const oldLog = console.info;
  const events = [];
  process.env.SIGNAL_MAP_PROXY_DIAGNOSTICS = '1';
  console.info = (line) => events.push(JSON.parse(line));
  try { await run(events); assert.ok(!JSON.stringify(events).includes('SYNTHETIC_')); }
  finally {
    console.info = oldLog;
    if (oldFlag === undefined) delete process.env.SIGNAL_MAP_PROXY_DIAGNOSTICS;
    else process.env.SIGNAL_MAP_PROXY_DIAGNOSTICS = oldFlag;
  }
}

test('login body read failure becomes a complete structured 502 without upstream cookies or retry', async () => captured(async (events) => {
  const stream = new ReadableStream({ start(c) { c.error(new Error('SYNTHETIC_TOKEN')); } });
  let calls = 0;
  const response = await proxyApiRequest(loginRequest(), { upstream: 'https://api.example',
    fetchFn: async () => { calls++; return new Response(stream, { headers: { 'set-cookie': 's=SYNTHETIC_TOKEN' } }); } });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, 'API_UPSTREAM_UNAVAILABLE');
  assert.equal(response.headers.getSetCookie().length, 0);
  assert.equal(calls, 1);
  assert.equal(events.at(-1).failedStage, 'response_body');
}));

test('login response over 64 KiB is cancelled and does not escape as a successful response', async () => captured(async (events) => {
  let cancelled = false;
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(65537)); },
    cancel() { cancelled = true; } });
  const response = await proxyApiRequest(loginRequest(), { upstream: 'https://api.example',
    fetchFn: async () => new Response(stream) });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, 'API_UPSTREAM_UNAVAILABLE');
  assert.equal(cancelled, true);
  assert.equal(events.at(-1).errorCode, 'UPSTREAM_BODY_TOO_LARGE');
}));

test('stalled login body returns within its 8 second read deadline even if cancellation never settles', { timeout: 10000 }, async () => captured(async (events) => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } });
  const start = Date.now();
  const response = await proxyApiRequest(loginRequest(), { upstream: 'https://api.example',
    fetchFn: async () => new Response(stream) });
  assert.equal(response.status, 502);
  assert.ok(Date.now() - start < 9500);
  assert.equal(cancelled, true);
  assert.equal(events.at(-1).errorCode, 'UPSTREAM_BODY_TIMEOUT');
  assert.equal((await response.json()).code, 'API_UPSTREAM_UNAVAILABLE');
}));

test('complete login preserves status, body and distinct Cookie lines while dropping transport-specific headers', async () => captured(async () => {
  const headers = new Headers({ 'content-type': 'application/json', 'connection': 'keep-alive, x-hop-only',
    'keep-alive': 'timeout=5', 'x-hop-only': 'remove', 'transfer-encoding': 'chunked', 'content-length': '999' });
  headers.append('set-cookie', 'one=SYNTHETIC_ONE; HttpOnly; Path=/');
  headers.append('set-cookie', 'two=SYNTHETIC_TWO; Secure; SameSite=Lax; Path=/');
  const response = await proxyApiRequest(loginRequest(), { upstream: 'https://api.example',
    fetchFn: async () => new Response('{"ok":true}', { status: 201, headers }) });
  assert.equal(response.status, 201);
  assert.equal(await response.text(), '{"ok":true}');
  assert.deepEqual(response.headers.getSetCookie(), headers.getSetCookie());
  for (const name of ['connection', 'keep-alive', 'x-hop-only', 'transfer-encoding', 'content-length']) {
    assert.equal(response.headers.has(name), false, name);
  }
}));

test('unrelated routes retain streaming semantics', async () => captured(async (events) => {
  const stream = new ReadableStream({ start(c) { c.error(new Error('synthetic stream failure')); } });
  const response = await proxyApiRequest(loginRequest('/api/control/knowledge'), { upstream: 'https://api.example',
    fetchFn: async () => new Response(stream) });
  assert.equal(response.status, 200);
  await assert.rejects(response.text(), /synthetic stream failure/);
  assert.deepEqual(events, []);
}));

test('injected fetch retaining raw compressed bytes is not silently decompressed', async () => captured(async () => {
  const bytes = gzipSync(Buffer.from('{"ok":true}'));
  const response = await proxyApiRequest(loginRequest(), { upstream: 'https://api.example',
    fetchFn: async () => new Response(bytes, { status: 401,
      headers: { 'content-encoding': 'gzip', 'content-type': 'application/json' } }) });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('content-encoding'), 'gzip');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
}));

// Removing login buffering must make this real wire regression fail again.
for (const reset of [false, true]) test(reset
  ? 'real upstream reset after headers is returned as a complete structured 502 by the locked framework'
  : 'real upstream gzip success reaches the client with complete JSON and Cookie', async () => captured(async (events) => {
  const { sendWebResponse } = await import(process.env.SIGNAL_MAP_TEST_VINEXT_ADAPTER ?? 'vinext/server/prod-server');
  let calls = 0;
  const upstream = http.createServer((req, res) => {
    calls++;
    req.resume();
    const bytes = gzipSync(Buffer.from('{"ok":true,"user":"synthetic"}'));
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip',
      'set-cookie': 's=' + 'x'.repeat(3000) + '; HttpOnly; Secure; Path=/', 'transfer-encoding': 'chunked' });
    if (reset) {
      res.write(bytes.subarray(0, 16));
      setTimeout(() => res.destroy(), 40);
    } else res.end(bytes);
  });
  const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  const close = (server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
  const port = await listen(upstream);
  const frontend = http.createServer(async (req, res) => {
    req.resume();
    const response = await proxyApiRequest(loginRequest(), { upstream: `http://127.0.0.1:${port}` });
    await sendWebResponse(response, req, res, true);
  });
  const frontPort = await listen(frontend);
  try {
    const result = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: frontPort, method: 'POST', path: '/api/auth/login',
        agent: false, headers: { 'accept-encoding': 'identity', 'content-length': 0 } }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, complete: res.complete,
          cookieCount: res.headers['set-cookie']?.length || 0, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      });
      req.setTimeout(2000, () => req.destroy(new Error('test timeout')));
      req.on('error', reject);
      req.end();
    });
    assert.equal(result.status, reset ? 502 : 200);
    assert.equal(result.complete, true);
    assert.equal(result.cookieCount, reset ? 0 : 1);
    if (reset) assert.equal(JSON.parse(result.body).code, 'API_UPSTREAM_UNAVAILABLE');
    else assert.equal(JSON.parse(result.body).ok, true);
    assert.equal(calls, 1);
    if (reset) assert.equal(events.at(-1).failedStage, 'response_body');
    else assert.equal(events.at(-1).stage, 'response_constructed');
  } finally { await close(frontend); await close(upstream); }
}));
