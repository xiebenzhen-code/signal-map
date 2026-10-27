import assert from "node:assert/strict";
import test from "node:test";
import { enrichGenericDetail } from "../source-enrichment/detail-enricher.ts";
import { isSafeDetailUrl } from "../source-enrichment/safe-url.ts";

const html = `<html><head><title>Release news</title></head><body><article>${"The team released a new editor with improved rendering and export support. ".repeat(8)}</article></body></html>`;
const input = { providerId: "registered-feeds", url: "http://publisher.example/article", title: "Release news" };
const publicAddress = { address: "93.184.216.34", family: 4 };
type Options = {
  lookup: (host: string) => Promise<Array<{ address: string; family: number }>>;
  request: (url: URL, address: typeof publicAddress, signal: AbortSignal, headers?: Record<string, string>) => Promise<{
    status: number; headers: Record<string, string | undefined>; body: string | AsyncIterable<Uint8Array>;
  }>;
};
// Before implementation the second argument is ignored; no real network is allowed.
const read = enrichGenericDetail as (value: typeof input & { deadlineAt?: number }, options: Options) => ReturnType<typeof enrichGenericDetail>;
const lookup = async () => [publicAddress];

test("detail blocks a public redirect to a private literal before sending it", async () => {
  const requested: string[] = [];
  const result = await read(input, { lookup, request: async url => {
    requested.push(url.href);
    return { status: 302, headers: { location: "http://127.0.0.1/admin" }, body: "" };
  } });
  assert.deepEqual(requested, [input.url]);
  assert.equal(result.status, "FETCH_FAILED");
  assert.equal((result as { failureCode?: string }).failureCode, "DETAIL_UNSAFE_REDIRECT");
  assert.equal(result.rawContent, undefined);
  assert.equal(result.fetchCalls, 1);
});

for (const addresses of [
  [{ address: "127.0.0.1", family: 4 }],
  [publicAddress, { address: "10.0.0.1", family: 4 }],
]) test("detail rejects the entire private or mixed DNS answer set", async () => {
  let requests = 0;
  const result = await read(input, { lookup: async () => addresses, request: async () => {
    requests++; return { status: 200, headers: {}, body: html };
  } });
  assert.equal(requests, 0);
  assert.equal(result.status, "FETCH_FAILED");
  assert.equal((result as { failureCode?: string }).failureCode, "DETAIL_PRIVATE_ADDRESS");
  assert.equal(result.rawContent, undefined);
});

test("detail follows two public redirects, revalidates DNS, pins address and sends no credentials", async () => {
  const hosts: string[] = [];
  const urls: string[] = [];
  const result = await read(input, {
    lookup: async host => { hosts.push(host); return [publicAddress]; },
    request: async (url, address, signal, headers) => {
      urls.push(url.href);
      assert.deepEqual(address, publicAddress);
      assert.equal(signal.aborted, false);
      assert.deepEqual(Object.keys(headers ?? {}).sort(), ["Accept", "User-Agent"]);
      assert.equal(headers?.Cookie, undefined);
      assert.equal(headers?.Authorization, undefined);
      if (urls.length === 1) return { status: 302, headers: { location: "https://publisher.example/article" }, body: "" };
      if (urls.length === 2) return { status: 301, headers: { location: "https://www.publisher.example/article" }, body: "" };
      return { status: 200, headers: {}, body: html };
    },
  });
  assert.equal(result.status, "SUCCESS");
  assert.match(result.rawContent ?? "", /improved rendering/);
  assert.equal(result.canonicalUrl, input.url);
  assert.equal(result.fetchCalls, 1);
  assert.deepEqual(hosts, ["publisher.example", "publisher.example", "www.publisher.example"]);
  assert.equal(urls.length, 3);
});

test("detail stops redirect chains before a fourth request", async () => {
  let requests = 0;
  const result = await read(input, { lookup, request: async () => {
    requests++; return { status: 302, headers: { location: `/next/${requests}` }, body: "" };
  } });
  assert.equal(requests, 3);
  assert.equal((result as { failureCode?: string }).failureCode, "DETAIL_REDIRECT_LIMIT");
  assert.equal(result.fetchCalls, 1);
});

test("detail caps a streaming response at one MiB and closes it without losing usable prose", async () => {
  let bytes = 0;
  let closed = false;
  const chunkSize = 64 * 1024;
  async function* chunks() {
    try {
      bytes += Buffer.byteLength(html); yield Buffer.from(html);
      for (let i = 0; i < 100; i++) { bytes += chunkSize; yield Buffer.alloc(chunkSize, 97); }
    } finally { closed = true; }
  }
  const result = await read(input, { lookup, request: async () => ({ status: 200, headers: {}, body: chunks() }) });
  assert.equal(result.status, "SUCCESS");
  assert.match(result.rawContent ?? "", /improved rendering/);
  assert.ok(bytes <= 1024 * 1024 + chunkSize);
  assert.equal(closed, true);
});

test("detail reports DNS failures distinctly, without leaking resolver errors or issuing requests", async () => {
  let requests = 0;
  const result = await read(input, { lookup: async () => { throw new Error("secret internal resolver address"); }, request: async () => {
    requests++; return { status: 200, headers: {}, body: html };
  } });
  assert.equal(requests, 0);
  assert.equal(result.status, "FETCH_FAILED");
  assert.equal((result as { failureCode?: string }).failureCode, "DETAIL_DNS_FAILED");
  assert.doesNotMatch(JSON.stringify(result), /secret internal/);
});

test("detail revalidates a redirected hostname before its socket is opened", async () => {
  let requests = 0;
  const result = await read(input, { lookup: async host => host === "publisher.example" ? [publicAddress] : [{ address: "192.168.1.1", family: 4 }], request: async () => {
    requests++; return { status: 302, headers: { location: "https://other.example/article" }, body: "" };
  } });
  assert.equal(requests, 1);
  assert.equal((result as { failureCode?: string }).failureCode, "DETAIL_PRIVATE_ADDRESS");
});

test("detail deadline includes DNS and prevents a late lookup from opening a socket", async () => {
  let requests = 0;
  const result = await read({ ...input, deadlineAt: Date.now() + 15 }, {
    lookup: async () => { await new Promise(resolve => setTimeout(resolve, 60)); return [publicAddress]; },
    request: async () => { requests++; return { status: 200, headers: {}, body: html }; },
  });
  assert.equal((result as { failureCode?: string }).failureCode, "DETAIL_TIMEOUT");
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(requests, 0);
});

test("detail precheck rejects dotted localhost and its subdomains", () => {
  for (const host of ["localhost.", "foo.localhost", "foo.localhost."]) {
    assert.equal(isSafeDetailUrl(`http://${host}/`), false);
  }
});
