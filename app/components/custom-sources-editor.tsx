"use client";

import { useRef, useState } from "react";
import { parseCustomSources, type CustomSourceCheck } from "../../lib/custom-sources.ts";

export function CustomSourcesEditor({ value, onChange, onSave, disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  onSave?: (urls: string[]) => Promise<void>;
  disabled?: boolean;
}) {
  const [checks, setChecks] = useState<CustomSourceCheck[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const version = useRef(0);
  const change = (next: string) => {
    version.current++;
    setChecks([]); setMessage(""); onChange(next);
  };
  const check = async () => {
    const parsed = parseCustomSources(value);
    if (parsed.errors.length || !parsed.urls.length) { setMessage(parsed.errors[0] ?? "请先填写来源链接。"); return; }
    const requestVersion = version.current;
    setPending(true); setMessage(""); setChecks([]);
    try {
      const response = await fetch("/api/sources/check", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: parsed.urls }), signal: AbortSignal.timeout(15000),
      });
      const body = await response.json() as { checks?: CustomSourceCheck[]; error?: string };
      if (!response.ok || !Array.isArray(body.checks)) throw new Error(body.error || "来源检查未完成，请稍后再试。");
      if (version.current === requestVersion) setChecks(body.checks);
    } catch (error) {
      if (version.current === requestVersion) setMessage(error instanceof Error && error.name !== "TimeoutError" ? error.message : "检查超时，请稍后再试。");
    } finally { setPending(false); }
  };
  const save = async () => {
    const parsed = parseCustomSources(value);
    if (parsed.errors.length) { setMessage(parsed.errors[0]); return; }
    setPending(true); setMessage("");
    try {
      await onSave?.(parsed.urls);
      onChange(parsed.urls.join("\n"));
      setMessage("来源已保存到当前浏览器的这个过滤器，下次研究时使用。");
    } catch { setMessage("来源保存失败，输入仍保留；请检查浏览器存储后重试。"); }
    finally { setPending(false); }
  };
  return <div className="grid gap-3">
    <label>
      <span className="text-sm font-black">添加你想关注的来源</span>
      <textarea aria-label="来源链接" value={value} disabled={disabled || pending}
        onChange={event => change(event.target.value)} rows={3}
        placeholder={"粘贴公开网页链接，每行一个\n例如：公告页、新闻页或具体文章"}
        className="mt-2 w-full rounded-xl border border-[#dde2e7] bg-white p-3 text-sm leading-6 outline-none focus:border-[#7e9cff]" />
    </label>
    <p className="text-xs leading-5 text-[#727b87]">最多 5 个。添加链接不会自动认定它可信；检查链接不会调用研究模型。来源配置保存在当前浏览器，不会同步到其他设备。</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={disabled || pending || !value.trim()} onClick={() => void check()}
        className="min-h-10 rounded-xl border border-[#dfe3e7] px-4 text-sm font-bold disabled:opacity-45">{pending ? "正在处理…" : "检查链接"}</button>
      {onSave && <button type="button" disabled={disabled || pending} onClick={() => void save()}
        className="min-h-10 rounded-xl border border-[#9eb2ff] px-4 text-sm font-bold text-[#2359ff] disabled:opacity-45">保存来源</button>}
    </div>
    {message && <p role="status" className="text-xs leading-5 text-[#596473]">{message}</p>}
    {checks.length > 0 && <ul className="grid gap-2" aria-label="来源检查结果">{checks.map((result, index) => <li key={`${result.url}-${index}`} className="rounded-xl border border-[#e4e7eb] p-3 text-xs leading-5">
      <p className="break-all font-bold">{result.url}</p><p>{result.reason}</p>
      {result.status === "readable" && !result.publishedAt && <p>未识别到发布日期，暂不能确认是否属于所选时间范围。</p>}
    </li>)}</ul>}
  </div>;
}
