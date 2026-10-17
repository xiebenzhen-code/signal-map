import type { EvidenceBoundSynthesis } from "../evidence-synthesis.ts";
import type { ParsedConclusion, ModelCallObservation, AdapterOptions } from "./types.ts";
import { discardResponseBody } from "../../lib/http-response.ts";

export function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("malformed_response");
  return parsed as Record<string, unknown>;
}
export function asStringArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
export function parseSynthesis(value: string): EvidenceBoundSynthesis {
  const parsed = parseJsonObject(value);
  const conclusions = Array.isArray(parsed.conclusions) ? parsed.conclusions.map((item): ParsedConclusion => {
    if (!item || typeof item !== "object") throw new Error("malformed_response");
    const record = item as Record<string, unknown>;
    const verificationStatus = record.verificationStatus === "verified" || record.verificationStatus === "partially_verified" || record.verificationStatus === "unverified" || record.verificationStatus === "conflicting" ? record.verificationStatus : "unverified";
    const statementType = record.statementType === "FACT" || record.statementType === "INTERPRETATION" || record.statementType === "SIGNAL" ? record.statementType : "SIGNAL";
    return { claim: typeof record.claim === "string" ? record.claim : "", evidenceIds: asStringArray(record.evidenceIds), sourceUrls: asStringArray(record.sourceUrls), confidence: typeof record.confidence === "number" ? record.confidence : 0, verificationStatus, statementType };
  }) : [];
  return { summary: typeof parsed.summary === "string" ? parsed.summary : "No reliable evidence found.", conclusions, unresolvedItems: asStringArray(parsed.unresolvedItems) };
}
export function modelTimeoutMs(env: Record<string, string | undefined> = process.env) {
  const configured = Number(env.MODEL_REQUEST_TIMEOUT_MS || "");
  return Number.isFinite(configured) && configured > 0 ? configured : 8000;
}

export async function callJsonEndpoint(fetchImpl: (input: string, init: RequestInit) => Promise<Response>, endpoint: string, apiKey: string, body: unknown, timeoutMs = modelTimeoutMs(), externalSignal?: AbortSignal,
  observation?: { provider: ModelCallObservation["provider"]; model: string; stage: ModelCallObservation["stage"]; onCall: AdapterOptions["onCall"] }) {
  const started = Date.now();
  let httpStatus: number | null = null;
  let usage: ModelCallObservation["usage"] = null;
  let errorCode: ModelCallObservation["errorCode"] = null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
  let response: Response;
  try {
    response = await fetchImpl(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal });
    httpStatus = response.status;
    if (!response.ok) {
      await discardResponseBody(response);
      if (response.status === 401 || response.status === 403) throw new Error("authentication_error");
      if (response.status === 402) throw new Error("quota_error");
      if (response.status === 429) throw new Error("rate_limit");
      if (response.status === 408) throw new Error("timeout");
      if (response.status >= 500) throw new Error("model_unavailable");
      throw new Error("provider_error");
    }
    const bodyJson = await response.json() as Record<string, unknown>;
    if (bodyJson.usage && typeof bodyJson.usage === "object") {
      const raw = bodyJson.usage as Record<string, unknown>;
      const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
      usage = { inputTokens: count(raw.input_tokens ?? raw.prompt_tokens), outputTokens: count(raw.output_tokens ?? raw.completion_tokens), totalTokens: count(raw.total_tokens) };
    }
    if (typeof bodyJson.output_text === "string") return bodyJson.output_text;
    const choices = Array.isArray(bodyJson.choices) ? bodyJson.choices : [];
    const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>).message : undefined;
    if (message && typeof message === "object" && typeof (message as Record<string, unknown>).content === "string") return (message as Record<string, unknown>).content as string;
    const output = Array.isArray(bodyJson.output) ? bodyJson.output : [];
    const text = output.flatMap((item) => item && typeof item === "object" && Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : []).map((item) => item && typeof item === "object" ? (item as Record<string, unknown>).text : undefined).find((item): item is string => typeof item === "string");
    if (text) return text;
    throw new Error("malformed_response");
  } catch (error) {
    errorCode = signal.aborted || error instanceof Error && error.name === "AbortError" ? "timeout" : normalizeModelError(error);
    if (errorCode === "timeout") throw new Error("timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
    if (observation?.onCall) {
      // Telemetry must never break a research request or expose provider bodies.
      try { observation.onCall({ provider: observation.provider, model: observation.model.replace(/[^a-zA-Z0-9._:/-]/g, "").slice(0, 100), stage: observation.stage,
        durationMs: Date.now() - started, httpStatus, transportStatus: errorCode ? "error" : "completed", errorCode, usage, cost: null }); } catch { /* observer isolation */ }
    }
  }
}
export function normalizeModelError(error: unknown): "authentication_error" | "quota_error" | "rate_limit" | "model_unavailable" | "timeout" | "malformed_response" | "schema_validation_error" | "provider_error" {
  const message = error instanceof Error ? error.message : "";
  if (message === "authentication_error" || message === "quota_error" || message === "rate_limit" || message === "model_unavailable" || message === "timeout" || message === "malformed_response" || message === "schema_validation_error") return message;
  return "provider_error";
}
