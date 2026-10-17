import { resolveResearchIdentity } from "../auth/request-identity.ts";
import { withSession } from "../auth/session.ts";
import { parseCustomSources } from "../lib/custom-sources.ts";
import { readCustomSource } from "../source-enrichment/custom-source.ts";
import { getSourceDoHResolver } from "../source-enrichment/doh-resolver.ts";

const checksByIdentity = new Map<string, number[]>();
let activeChecks = 0;

export function createSourceCheckHandler(reader: typeof readCustomSource = readCustomSource) {
  return withSession(async (request: Request) => {
    if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const raw = await request.text();
    if (raw.length > 8192) return Response.json({ error: "来源链接过多或过长。" }, { status: 400 });
    let body: { urls?: unknown };
    try { body = JSON.parse(raw); } catch { return Response.json({ error: "无法读取来源链接。" }, { status: 400 }); }
    if (!body || !Array.isArray(body.urls) || body.urls.some(url => typeof url !== "string")) {
      return Response.json({ error: "请提供来源链接列表。" }, { status: 400 });
    }
    const parsed = parseCustomSources(body.urls as string[]);
    if (!parsed.urls.length || parsed.errors.length) {
      return Response.json({ error: parsed.errors[0] ?? "请先填写来源链接。" }, { status: 400 });
    }
    const identity = await resolveResearchIdentity(request);
    const now = Date.now();
    for (const [id, timestamps] of checksByIdentity) {
      if (!timestamps.some(time => now - time < 60000)) checksByIdentity.delete(id);
    }
    const recent = (checksByIdentity.get(identity.id) ?? []).filter(time => now - time < 60000);
    if (recent.length >= 8 || activeChecks >= 3 || checksByIdentity.size >= 500 && !checksByIdentity.has(identity.id)) {
      return Response.json({ error: "检查较频繁，请稍后再试。" }, { status: 429 });
    }
    checksByIdentity.set(identity.id, [...recent, now]);
    activeChecks++;
    try {
      const deadlineAt = Date.now() + 5000;
      // The check endpoint consumes the SAME DoH configuration as the research
      // pipeline: when SOURCE_DOH_URL is set, every host resolves through it.
      const doh = getSourceDoHResolver();
      const lookup = doh.configured ? (name: string) => doh.resolve(name) : undefined;
      const results = await Promise.all(parsed.urls.map(url => reader(url, { deadlineAt, lookup })));
      const checks = results.map(({ content: _content, ...check }) => check);
      const headers = new Headers();
      if (identity.mode === "anonymous" && identity.setCookie) headers.append("Set-Cookie", identity.setCookie);
      return Response.json({ checks }, { headers });
    } finally { activeChecks--; }
  });
}

export const handleSourceCheck = createSourceCheckHandler();
