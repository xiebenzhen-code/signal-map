import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { isPublicSourceAddress, publicSourceUrl, type CustomSourceCheck } from "../lib/custom-sources.ts";

type Address = { address: string; family: number };
type PageResponse = { status: number; headers: Record<string, string | undefined>; body: string };
export type CustomSourceResult = CustomSourceCheck & { content?: string };
type ReadOptions = {
  deadlineAt?: number;
  lookup?: (host: string) => Promise<Address[]>;
  request?: (url: URL, address: Address, signal: AbortSignal) => Promise<PageResponse>;
};
const MAX_BYTES = 512 * 1024;

/** Pin the validated address at socket creation, retaining the original Host/SNI. */
function pinnedRequest(url: URL, address: Address, signal: AbortSignal): Promise<PageResponse> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      signal, agent: false,
      headers: { "User-Agent": "SignalMapResearch/0.4", Accept: "text/html,text/plain" },
      lookup: (_host, options, callback) => {
        if (typeof options === "object" && options.all) callback(null, [address] as never);
        else callback(null, address.address, address.family);
      },
    }, response => {
      const status = response.statusCode ?? 0;
      const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) =>
        [key, Array.isArray(value) ? value.join(", ") : value]));
      if (status !== 200) { response.destroy(); resolve({ status, headers, body: "" }); return; }
      let size = 0;
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) { response.destroy(new Error("PAGE_TOO_LARGE")); return; }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve({ status, headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end();
  });
}

function plainText(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
}

function extractPage(html: string) {
  const title = plainText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  let publishedAt: string | undefined;
  for (const meta of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (/\b(?:property|name)=["'](?:article:published_time|datePublished|date)["']/i.test(meta)) {
      const date = meta.match(/\bcontent=["']([^"']+)["']/i)?.[1];
      if (date && Number.isFinite(Date.parse(date))) { publishedAt = date; break; }
    }
  }
  const cleaned = html.replace(/<(script|style|nav|header|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const semantic = cleaned.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2];
  const content = plainText(semantic ?? cleaned);
  return { title, publishedAt, content };
}

export async function readCustomSource(value: string, options: ReadOptions = {}): Promise<CustomSourceResult> {
  let requestCount = 0;
  const finish = (status: CustomSourceCheck["status"], reason: string): CustomSourceResult =>
    ({ url: publicSourceUrl(value) ?? "", status, reason, requestCount });
  const deadlineAt = Math.min(options.deadlineAt ?? Date.now() + 5000, Date.now() + 5000);
  if (deadlineAt <= Date.now()) return finish("not_searched", "本轮时间不足，尚未读取这个来源。");
  let current = publicSourceUrl(value);
  if (!current) return finish("blocked", "仅支持不含账号密码的公开网页链接。");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = async (): Promise<CustomSourceResult> => {
      for (let redirects = 0; redirects <= 2; redirects++) {
        if (controller.signal.aborted) throw new Error("TIMEOUT");
        const url = new URL(current!);
        const host = url.hostname.replace(/^\[|\]$/g, "");
        const addresses = isIP(host) ? [{ address: host, family: isIP(host) }]
          : await (options.lookup ?? (name => lookup(name, { all: true })))(host);
        if (!addresses.length || addresses.some(item => !isPublicSourceAddress(item.address))) {
          return finish("blocked", "来源解析到非公开地址，未进行抓取。");
        }
        if (controller.signal.aborted) throw new Error("TIMEOUT");
        requestCount++;
        const response = await (options.request ?? pinnedRequest)(url, addresses[0], controller.signal);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.location;
          const next = location ? publicSourceUrl(new URL(location, url).href) : undefined;
          if (!next) return finish("blocked", "来源跳转到不支持的地址，已停止抓取。");
          current = next;
          continue;
        }
        if ([401, 403].includes(response.status)) return finish("login_required", "页面需要登录或限制访问，未读取正文。");
        if (response.status !== 200) return finish("failed", "页面未能读取，请检查链接或稍后再试。");
        const type = response.headers["content-type"] ?? "";
        if (!/text\/html|text\/plain|application\/xhtml\+xml/i.test(type)) {
          return finish("failed", "当前仅支持公开网页正文，不支持这种文件类型。");
        }
        const page = extractPage(response.body);
        if (page.content.length < 160) return finish("too_thin", "页面可访问，但正文太少，暂时不能作为变化依据。");
        return { ...finish("readable", "正文可读取；仍需按相关性、时间和证据进行筛选。"),
          canonicalUrl: url.href, ...page };
      }
      return finish("failed", "页面跳转过多，已停止抓取。");
    };
    return await Promise.race([work(), new Promise<CustomSourceResult>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(finish("failed", "读取超时，请稍后再检查。")); }, Math.max(1, deadlineAt - Date.now()));
    })]);
  } catch {
    return finish("failed", "页面读取失败，可能暂时不可达或正文过大。");
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
