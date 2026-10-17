import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { gzipSync, brotliCompressSync, deflateSync, createGzip, constants as zlibConstants } from "node:zlib";
import { proxyApiRequest } from "../backend/api-proxy.ts";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return "http://127.0.0.1:" + server.address().port;
}
async function stop(server) {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

test("compression: real Node fetch removes decoded encoding/length and preserves response contracts", async t => {
  const fixture = Buffer.from('{"user":null}');
  const codecs = { gzip: gzipSync, br: brotliCompressSync, deflate: deflateSync, identity: value => value };
  const cookies = ["fixture.0=first; Path=/; HttpOnly; Secure; SameSite=Lax",
    "fixture.1=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
    "expiry=local; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/"];
  const publicOrigin = "https://preview.example.invalid";
  let calls = 0;
  const upstream = createServer((req, res) => {
    calls++;
    assert.equal(req.headers.origin, publicOrigin);
    const url = new URL(req.url, "http://fixture.invalid");
    const coding = url.searchParams.get("coding");
    const body = codecs[coding](fixture);
    const status = Number(url.searchParams.get("status"));
    res.writeHead(status, {
      "Content-Type": "application/json", "Cache-Control": "no-store",
      Vary: "Origin, Accept-Encoding", "Access-Control-Allow-Origin": publicOrigin,
      "Set-Cookie": cookies, "Content-Length": String(body.length),
      ...(coding === "identity" ? {} : { "Content-Encoding": coding }),
      ...(status === 302 ? { Location: "/destination" } : {}),
    });
    res.end(body);
  });
  const origin = await listen(upstream);
  t.after(() => stop(upstream));
  for (const [coding, compress] of Object.entries(codecs)) {
    for (const status of [200, 429, 503, 302]) {
      const response = await proxyApiRequest(new Request(publicOrigin +
        `/api/auth/me?coding=${coding}&status=${status}`, {
        headers: { "Accept-Encoding": coding, Origin: publicOrigin },
      }), { upstream: origin });
      assert.equal(response.status, status, `${coding}/${status}`);
      assert.equal(response.headers.get("content-encoding"), null, `${coding}/${status}: decoded body encoding`);
      assert.equal(response.headers.get("content-length"), coding === "identity" ? String(fixture.length) : null,
        `${coding}/${status}: compressed length must not describe decoded bytes (${compress(fixture).length})`);
      assert.equal(response.headers.get("content-type"), "application/json");
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("vary"), "Origin, Accept-Encoding");
      assert.equal(response.headers.get("access-control-allow-origin"), publicOrigin);
      assert.deepEqual(response.headers.getSetCookie(), cookies);
      assert.equal(response.headers.get("location"), status === 302 ? "/destination" : null);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), fixture);
    }
  }
  assert.equal(calls, 16, "redirects stay manual; each matrix request reaches upstream once");
});

test("compression: HEAD/204/304 and injected bodyless responses retain representation metadata", async t => {
  const upstream = createServer((req, res) => {
    const status = req.method === "HEAD" ? 200 : Number(req.url.slice(1));
    res.writeHead(status, { "Content-Encoding": "gzip", "Content-Length": "33",
      "Cache-Control": "no-store", Vary: "Accept-Encoding" });
    res.end();
  });
  const origin = await listen(upstream);
  t.after(() => stop(upstream));
  for (const [method, status] of [["HEAD", 200], ["GET", 204], ["GET", 304]]) {
    const response = await proxyApiRequest(new Request(`https://preview.example.invalid/${status}`, { method }),
      { upstream: origin });
    assert.equal(response.status, status);
    assert.equal(response.body, null);
    assert.equal(response.headers.get("content-encoding"), "gzip");
    assert.equal(response.headers.get("content-length"), "33");
  }
  const bodyless = await proxyApiRequest(new Request("https://preview.example.invalid/empty"), {
    upstream: origin, fetchFn: async () => new Response(null, {
      headers: { "Content-Encoding": "gzip", "Content-Length": "33" },
    }),
  });
  assert.equal(bodyless.body, null);
  assert.equal(bodyless.headers.get("content-encoding"), "gzip");
  assert.equal(bodyless.headers.get("content-length"), "33");
});

test("compression: injected raw bytes are not assumed to be Node-decoded", async () => {
  const bytes = gzipSync(Buffer.from("local compressed fixture"));
  const response = await proxyApiRequest(new Request("https://preview.example.invalid/raw"), {
    upstream: "http://127.0.0.1:8080", fetchFn: async () => new Response(bytes, {
      headers: { "Content-Encoding": "gzip", "Content-Length": String(bytes.length) },
    }),
  });
  assert.equal(response.headers.get("content-encoding"), "gzip");
  assert.equal(response.headers.get("content-length"), String(bytes.length));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test("compression: decoded gzip response remains streaming before upstream completion", async t => {
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const first = '{"fixture":';
  const upstream = createServer(async (_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "gzip",
      "Cache-Control": "no-store" });
    const compressor = createGzip();
    compressor.pipe(res);
    compressor.write(first);
    compressor.flush(zlibConstants.Z_SYNC_FLUSH);
    await finished;
    compressor.end("true}");
  });
  const origin = await listen(upstream);
  t.after(async () => { finish(); await stop(upstream); });
  const response = await proxyApiRequest(new Request("https://preview.example.invalid/stream"), { upstream: origin });
  assert.equal(response.headers.get("content-encoding"), null);
  assert.equal(response.headers.get("content-length"), null);
  const reader = response.body.getReader();
  let timer;
  try {
    const chunk = await Promise.race([reader.read(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("proxy buffered the unfinished stream")), 2000);
    })]);
    assert.equal(chunk.done, false);
    assert.equal(Buffer.from(chunk.value).toString(), first);
    finish();
    let tail = "";
    while (true) { const next = await reader.read(); if (next.done) break; tail += Buffer.from(next.value).toString(); }
    assert.equal(first + tail, '{"fixture":true}');
  } finally { clearTimeout(timer); finish(); reader.releaseLock(); }
});

test("real HTTP proxy → Node API → Supabase substitute keeps public recovery target", async t => {
  const keys = ["NODE_ENV", "SIGNAL_MAP_ALLOWED_ORIGIN", "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "PORT"];
  const previous = keys.map(key => process.env[key]);
  const servers = [];
  t.after(async () => {
    for (const server of servers.reverse()) await stop(server);
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  });
  let calls = 0;
  let redirect;
  let logins = 0;
  let userReads = 0;
  let logouts = 0;
  const fixtureUser = () => ({ id: "local-fixture-user", aud: "authenticated",
    app_metadata: {}, user_metadata: { note: logins === 1 ? "x".repeat(9000) : "short" },
    created_at: "2026-01-01T00:00:00Z" });
  const substitute = createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture.invalid");
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/auth/v1/token") {
      logins++;
      const payload = Buffer.from(JSON.stringify({ sub: "local-fixture-user", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
      res.end(JSON.stringify({ access_token: "eyJhbGciOiJub25lIn0." + payload + ".fixture",
        refresh_token: "local-only", token_type: "bearer", expires_in: 3600, user: fixtureUser() }));
      return;
    }
    if (url.pathname === "/auth/v1/user") { userReads++; res.end(JSON.stringify(fixtureUser())); return; }
    if (url.pathname === "/auth/v1/logout") { logouts++; res.statusCode = 204; res.end(); return; }
    calls++;
    assert.equal(url.pathname, "/auth/v1/recover");
    redirect = url.searchParams.get("redirect_to");
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.equal(JSON.parse(body).email, "fixture@example.invalid");
    res.setHeader("Content-Type", "application/json");
    res.end("{}");
  });
  servers.push(substitute);
  const fixtureOrigin = await listen(substitute);
  process.env.NODE_ENV = "production";
  process.env.SIGNAL_MAP_ALLOWED_ORIGIN = "https://signal.benzhenlab.com";
  process.env.NEXT_PUBLIC_SUPABASE_URL = fixtureOrigin;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "local-fixture-only";
  process.env.PORT = "0";
  // Fresh entry module captures this test's ephemeral port even when other
  // tests have imported the normal Node entry already.
  const { startBackendServer } = await import("../backend/node-server.ts?c1b1-http");
  const api = startBackendServer();
  servers.push(api);
  await once(api, "listening");
  const apiOrigin = "http://127.0.0.1:" + api.address().port;
  const front = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    // External HTTPS URL is supplied by the local frontend adapter.
    // The real Node API then reconstructs an internal HTTP URL.
    const response = await proxyApiRequest(new Request("https://signal.benzhenlab.com" + req.url, {
      method: req.method, headers: req.headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    }), { upstream: apiOrigin });
    res.statusCode = response.status;
    response.headers.forEach((value, key) => { if (key !== "set-cookie") res.setHeader(key, value); });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader("Set-Cookie", cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  servers.push(front);
  const frontOrigin = await listen(front);
  const submit = origin => fetch(frontOrigin + "/api/auth/password-reset", {
    method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}),
      "X-Forwarded-Host": "attacker.invalid", "X-Forwarded-Proto": "http" },
    body: JSON.stringify({ email: "fixture@example.invalid" }),
  });
  try {
    const response = await submit("https://signal.benzhenlab.com");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, status: "reset_requested" });
    assert.equal(redirect, "https://signal.benzhenlab.com/auth/reset-password");
    assert.equal(calls, 1);
    const forgedHost = await fetch(apiOrigin + "/api/auth/password-reset", { method: "POST",
      headers: { Host: "attacker.invalid", Origin: "https://signal.benzhenlab.com", "Content-Type": "application/json" },
      body: JSON.stringify({ email: "fixture@example.invalid" }) });
    assert.equal(forgedHost.status, 200);
    assert.equal(redirect, "https://signal.benzhenlab.com/auth/reset-password");
    assert.equal(calls, 2);
    const authenticate = cookie => fetch(frontOrigin + "/api/auth/login", {
      method: "POST", headers: { Origin: "https://signal.benzhenlab.com", "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ email: "fixture@example.invalid", password: "fixture-password-only" }),
    });
    const large = await authenticate();
    assert.equal(large.status, 200);
    const largeCookies = large.headers.getSetCookie();
    const chunked = largeCookies.filter(value => /sb-.*-auth-token\.\d+=/.test(value));
    assert.ok(chunked.length >= 2);
    for (const cookie of chunked) {
      assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i);
      assert.match(cookie, /SameSite=Lax/i); assert.match(cookie, /Path=\//i);
      assert.doesNotMatch(cookie, /Domain=/i);
    }
    const jar = new Map(largeCookies.map(cookie => cookie.split(";", 1)[0].split(/=(.*)/s).slice(0, 2)));
    const jarHeader = () => [...jar].map(([key, value]) => key + "=" + value).join("; ");
    const restored = await fetch(frontOrigin + "/api/auth/me", { headers: { Cookie: jarHeader() } });
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).user.id, "local-fixture-user");
    const smaller = await authenticate(jarHeader());
    assert.equal(smaller.status, 200);
    const shortened = smaller.headers.getSetCookie();
    assert.ok(shortened.some(cookie => /sb-.*-auth-token\.\d+=;/.test(cookie) && /Max-Age=0/i.test(cookie)));
    for (const cookie of shortened) {
      const pair = cookie.split(";", 1)[0]; const equals = pair.indexOf("=");
      if (/Max-Age=0/i.test(cookie)) jar.delete(pair.slice(0, equals));
      else jar.set(pair.slice(0, equals), pair.slice(equals + 1));
    }
    const loggedOut = await fetch(frontOrigin + "/api/auth/logout", { method: "POST",
      headers: { Origin: "https://signal.benzhenlab.com", Cookie: jarHeader() } });
    assert.equal(loggedOut.status, 200);
    assert.ok(loggedOut.headers.getSetCookie().some(cookie => /sb-.*-auth-token=;/.test(cookie) && /Max-Age=0/i.test(cookie)));
    assert.equal(logins, 2); assert.ok(userReads >= 1); assert.equal(logouts, 1);
    console.log("SDK_HTTP local-login=2; restored=1; local-logout=1; chunk-shrink/delete=PASS (manual jar, not browser)");
    const rejected = await submit("https://attacker.invalid");
    assert.equal(rejected.status, 403);
    assert.equal(calls, 2);
    for (const config of [undefined, "", "bad", "https://signal.benzhenlab.com/path", "http://signal.benzhenlab.com",
      "https://user:secret@signal.benzhenlab.com", "https://signal.benzhenlab.com?x=1",
      "https://signal.benzhenlab.com#x", "https://signal.benzhenlab.com/"]) {
      if (config === undefined) delete process.env.SIGNAL_MAP_ALLOWED_ORIGIN;
      else process.env.SIGNAL_MAP_ALLOWED_ORIGIN = config;
      const closed = await submit();
      assert.equal(closed.status, 503);
      assert.equal(calls, 2);
    }
    process.env.NODE_ENV = "development";
    for (const config of [undefined, "http://localhost:3000"]) {
      if (config === undefined) delete process.env.SIGNAL_MAP_ALLOWED_ORIGIN;
      else process.env.SIGNAL_MAP_ALLOWED_ORIGIN = config;
      const development = await submit();
      assert.equal(development.status, 200);
      assert.equal(redirect, (config ?? apiOrigin) + "/auth/reset-password");
    }
    console.log("HTTP_CHAIN recovery=4 (2 production, 2 development); rejected-origin=1; rejected-config=9");
  } finally {
    await stop(front); await stop(api); await stop(substitute);
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});

test("real HTTP preserves separated chunk/expiry/deletion cookies, statuses and manual Location", async () => {
  const cookies = [
    "session.0=first; Path=/; HttpOnly; Secure; SameSite=Lax",
    "session.1=second; Path=/; HttpOnly; Secure; SameSite=Lax",
    "expires=x; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/",
    "session.2=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
  ];
  let calls = 0;
  const upstream = createServer(async (req, res) => {
    calls++;
    if (req.url === "/destination") { res.end("followed"); return; }
    if (req.url.startsWith("/redirect")) {
      res.writeHead(302, { Location: "/destination", "Set-Cookie": cookies }); res.end(); return;
    }
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/echo?query=%2F");
    assert.equal(req.headers.cookie, "session.0=first; session.1=second");
    assert.equal(req.headers.authorization, "Bearer fixture-only");
    assert.equal(req.headers.origin, "https://signal.benzhenlab.com");
    let body = ""; for await (const chunk of req) body += chunk;
    assert.equal(body, '{"fixture":true}');
    res.writeHead(429, { "Set-Cookie": cookies, "Content-Type": "application/json" });
    res.end('{"error":"fixture-limit"}');
  });
  const origin = await listen(upstream);
  const front = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const response = await proxyApiRequest(new Request("https://signal.benzhenlab.com" + req.url, {
      method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined,
    }), { upstream: origin });
    res.statusCode = response.status;
    response.headers.forEach((value, key) => { if (key !== "set-cookie") res.setHeader(key, value); });
    const outgoingCookies = response.headers.getSetCookie();
    if (outgoingCookies.length) res.setHeader("Set-Cookie", outgoingCookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  const frontOrigin = await listen(front);
  try {
    const response = await fetch(frontOrigin + "/echo?query=%2F", {
      method: "POST", headers: { Cookie: "session.0=first; session.1=second", Authorization: "Bearer fixture-only",
        Origin: "https://signal.benzhenlab.com" }, body: '{"fixture":true}',
    });
    assert.equal(response.status, 429);
    assert.deepEqual(response.headers.getSetCookie(), cookies);
    assert.equal(await response.text(), '{"error":"fixture-limit"}');
    const redirected = await fetch(frontOrigin + "/redirect", { redirect: "manual" });
    assert.equal(redirected.status, 302);
    assert.equal(redirected.headers.get("location"), "/destination");
    assert.deepEqual(redirected.headers.getSetCookie(), cookies);
    assert.equal(calls, 2, "redirect destination was not fetched");
    console.log("HTTP_HEADER_FIXTURE requests=2; Set-Cookie=4; redirect-follow=0");
  } finally { await stop(front); await stop(upstream); }
});
