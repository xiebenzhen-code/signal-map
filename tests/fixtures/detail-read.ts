// Test-only bridge: existing fetch fixture bodies, injected through internal parameters.
import assert from "node:assert/strict";
import { afterEach } from "node:test";
import { enrichGenericDetail as generic, enrichDetail as detail, type DetailReadOptions } from "../../source-enrichment/detail-enricher.ts";
import { runResearchPipeline as pipeline } from "../../research/research-pipeline.ts";
export * from "../../source-enrichment/detail-enricher.ts";
export * from "../../source-enrichment/index.ts";
export * from "../../research/research-pipeline.ts";
const realFetch = globalThis.fetch;
let calls = 0;
afterEach(context => { if ("diagnostic" in context) context.diagnostic(`detail injected request calls=${calls}`); calls = 0; });
const network: DetailReadOptions = {
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  request: async (url, address, signal, headers) => {
    calls++;
    assert.notEqual(globalThis.fetch, realFetch, "FIXTURE_NOT_EFFECTIVE: fetch fixture not installed");
    assert.equal(address.address, "93.184.216.34", "FIXTURE_NOT_EFFECTIVE: pin not passed");
    const response = await globalThis.fetch(url.href, { signal, headers, redirect: "manual" });
    return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
  },
};
export const enrichGenericDetail: typeof generic = (input, options) => generic(input, options ?? network);
export const enrichDetail: typeof detail = (input, options) => detail(input, options ?? network);
export const runResearchPipeline: typeof pipeline = (input, progress, debug, plan) =>
  pipeline(input, progress, { ...debug, detailReadOptions: debug?.detailReadOptions ?? network }, plan);
