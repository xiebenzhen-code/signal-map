import type { Claim, ResearchSignal } from "./types";

const DEFAULT_TRANSLATION_URL =
  "https://translate.googleapis.com/translate_a/single";
const FALLBACK_TRANSLATION_URL =
  "https://api.mymemory.translated.net/get";
const translationCache = new Map<string, string>();
const protectedTerms = [
  "Anthropic",
  "OpenAI",
  "Claude",
  "Codex",
  "Salesforce",
  "Google",
  "Microsoft",
  "GitHub",
  "NVIDIA",
  "Nasdaq",
  "Bloomberg",
  "Reuters",
  "CNBC",
  "Reddit",
  "Xiaohongshu",
];

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function shouldTranslate(text: string) {
  const latinWords = text.match(/[A-Za-z][A-Za-z'-]{1,}/g)?.length || 0;
  const chineseCharacters = text.match(/[\u3400-\u9fff]/g)?.length || 0;
  return latinWords >= 3 && chineseCharacters < 12;
}

function parseGooglePayload(payload: unknown) {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return "";
  return payload[0]
    .map((part) =>
      Array.isArray(part) && typeof part[0] === "string" ? part[0] : "",
    )
    .join("")
    .trim();
}

async function requestGoogle(text: string) {
  const endpoint =
    process.env.TRANSLATION_SERVICE_URL || DEFAULT_TRANSLATION_URL;
  const target = process.env.TRANSLATION_TARGET_LANGUAGE || "zh-CN";
  const params = new URLSearchParams({
    client: "gtx",
    sl: "auto",
    tl: target,
    dt: "t",
    q: text,
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "SignalMapTranslation/0.3",
    },
    body: params,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`primary translation service returned ${response.status}`);
  }
  const translated = parseGooglePayload(await response.json());
  if (!translated) throw new Error("primary translation response was empty");
  return translated;
}

async function requestFallback(text: string) {
  const target = process.env.TRANSLATION_TARGET_LANGUAGE || "zh-CN";
  const endpoint =
    process.env.TRANSLATION_FALLBACK_SERVICE_URL ||
    FALLBACK_TRANSLATION_URL;
  const params = new URLSearchParams({ q: text, langpair: `en|${target}` });
  const response = await fetch(`${endpoint}?${params}`, {
    headers: { "User-Agent": "SignalMapTranslation/0.2" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`fallback translation service returned ${response.status}`);
  }
  const payload = (await response.json()) as {
    responseData?: { translatedText?: string };
  };
  const translated = payload.responseData?.translatedText?.trim();
  if (!translated) throw new Error("fallback translation response was empty");
  return translated;
}

async function translateBatch(text: string) {
  const cached = translationCache.get(text);
  if (cached) return cached;
  let protectedText = text;
  protectedTerms.forEach((term, index) => {
    protectedText = protectedText.replace(
      new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
      `ZXQBRAND${index}QXZ`,
    );
  });
  let translated = "";
  try {
    translated = await requestGoogle(protectedText);
  } catch {
    if (protectedText.length > 450) throw new Error("primary translation batch failed");
    translated = await requestFallback(protectedText);
  }
  protectedTerms.forEach((term, index) => {
    translated = translated.replace(
      new RegExp(`ZXQBRAND\\s*${index}\\s*QXZ`, "gi"),
      term,
    );
  });
  translationCache.set(text, translated);
  return translated;
}

function parseTranslatedBatch(text: string, expected: number) {
  const values = new Map<number, string>();
  const pattern = /§\s*(\d+)\s*§\s*([\s\S]*?)(?=§\s*\d+\s*§|$)/g;
  for (const match of text.matchAll(pattern)) {
    values.set(Number(match[1]), match[2].trim());
  }
  if (values.size !== expected) return null;
  return Array.from({ length: expected }, (_, index) => values.get(index) || "");
}

// POST supports a larger evidence batch, which keeps a full result page to a
// handful of translation requests instead of one request per card.
function makeChunks(values: string[], limit = 6000) {
  const chunks: Array<Array<{ value: string; index: number }>> = [];
  let current: Array<{ value: string; index: number }> = [];
  let length = 0;
  values.forEach((value, index) => {
    const nextLength = value.length + 16;
    if (current.length && length + nextLength > limit) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push({ value, index });
    length += nextLength;
  });
  if (current.length) chunks.push(current);
  return chunks;
}

function fieldsForSignal(signal: ResearchSignal) {
  return [
    signal.title,
    signal.summary,
    ...signal.claims.flatMap((claim) => [
      claim.claimText,
      claim.evidenceSnippet,
    ]),
  ];
}

export async function translateSignalsForPresentation(
  signals: ResearchSignal[],
) {
  const disabled = process.env.TRANSLATION_ENABLED?.toLowerCase() === "false";
  if (disabled || !signals.length) {
    return {
      signals: signals.map((signal) => ({
        ...signal,
        translationStatus: disabled ? ("failed" as const) : ("not_needed" as const),
      })),
      translated: 0,
      failed: disabled ? signals.length : 0,
    };
  }

  const allFields = signals.flatMap(fieldsForSignal);
  const uniqueFields = [
    ...new Set(allFields.filter((field) => shouldTranslate(field))),
  ];
  const translatedByOriginal = new Map<string, string>();
  const failedFields = new Set<string>();

  for (const chunk of makeChunks(uniqueFields)) {
    const batch = chunk
      .map(({ value }, index) => `§${index}§ ${value}`)
      .join("\n\n");
    let values: string[] | null = null;
    for (let attempt = 0; attempt < 2 && !values; attempt += 1) {
      try {
        if (attempt) await wait(450);
        const translatedBatch = await translateBatch(batch);
        values = parseTranslatedBatch(translatedBatch, chunk.length);
      } catch {
        values = null;
      }
    }
    if (values) {
      chunk.forEach(({ value }, index) => {
        translatedByOriginal.set(value, values?.[index] || value);
      });
    } else {
      chunk.forEach(({ value }) => failedFields.add(value));
    }
  }

  const translatedSignals = signals.map((signal) => {
    const fields = fieldsForSignal(signal);
    const output = fields.map(
      (field) => translatedByOriginal.get(field) || field,
    );
    let cursor = 2;
    const claims: Claim[] = signal.claims.map((claim) => {
      const claimText = output[cursor++];
      const evidenceSnippet = output[cursor++];
      return {
        ...claim,
        claimText,
        originalClaimText:
          claimText !== claim.claimText ? claim.claimText : undefined,
        evidenceSnippet,
        originalEvidenceSnippet:
          evidenceSnippet !== claim.evidenceSnippet
            ? claim.evidenceSnippet
            : undefined,
      };
    });
    const signalFailed = fields.some((field) => failedFields.has(field));
    const signalTranslated = fields.some(
      (field, index) => output[index] !== field,
    );
    return {
      ...signal,
      title: output[0],
      originalTitle: output[0] !== signal.title ? signal.title : undefined,
      summary: output[1],
      originalSummary:
        output[1] !== signal.summary ? signal.summary : undefined,
      claims,
      translationStatus: signalFailed
        ? ("failed" as const)
        : signalTranslated
          ? ("translated" as const)
          : ("not_needed" as const),
      translationFailureReason: signalFailed
        ? "远程翻译暂时不可用，已保留原文"
        : undefined,
    } satisfies ResearchSignal;
  });

  return {
    signals: translatedSignals,
    translated: translatedSignals.filter(
      (signal) => signal.translationStatus === "translated",
    ).length,
    failed: translatedSignals.filter(
      (signal) => signal.translationStatus === "failed",
    ).length,
  };
}
