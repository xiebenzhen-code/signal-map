"use client";

import { useState } from "react";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState("");
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);
  const [verifying, setVerifying] = useState(false);

  async function verifyRecovery() {
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash") ?? "";
    const type = params.get("type") ?? "";
    if (!tokenHash || type !== "recovery") {
      setStatus("重置链接无效，请重新请求密码重置。");
      return;
    }
    setVerifying(true);
    setStatus("正在验证重置链接…");
    try {
      const response = await fetch("/api/auth/password-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ token_hash: tokenHash, type }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setStatus(body.error ?? "重置链接无效，请重新请求密码重置。");
        return;
      }
      window.history.replaceState(null, "", "/auth/reset-password");
      setReady(true);
      setStatus("");
    } catch {
      setStatus("暂时无法验证重置链接，请稍后重试");
    } finally {
      setVerifying(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 6 || password !== confirm) {
      setStatus(password !== confirm ? "两次输入的密码不一致" : "请输入至少 6 位新密码");
      return;
    }
    setStatus("正在更新…");
    const response = await fetch("/api/auth/password-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ password }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setStatus(body.error ?? "密码更新失败，请重新请求重置链接"); return; }
    setDone(true);
    setStatus("密码已更新");
  }

  return <main className="signal-shell mx-auto min-h-screen max-w-md px-5 py-16 sm:py-24">
    <p className="signal-eyebrow">个人信息雷达</p>
    <h1 className="signal-display mt-4 text-4xl leading-tight">设置新密码。</h1>
    {done ? <p className="mt-6 text-sm leading-7 text-[#2457ff]">密码已更新，现在可以返回登录。</p> : ready ? <form className="signal-surface mt-8 grid gap-5 rounded-3xl p-6" onSubmit={submit}>
      <label className="grid gap-2 text-sm font-semibold">新密码<input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" className="min-h-12 rounded-xl border bg-white px-4 font-normal" /></label>
      <label className="grid gap-2 text-sm font-semibold">确认新密码<input required minLength={6} type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" className="min-h-12 rounded-xl border bg-white px-4 font-normal" /></label>
      <button className="min-h-12 rounded-xl bg-[#2457ff] font-semibold text-white">更新密码</button>
    </form> : <section className="signal-surface mt-8 grid gap-4 rounded-3xl p-6">
      <p className="text-sm leading-7 text-[#657080]">请确认继续重置密码。确认后，这封邮件里的重置链接会被使用一次。</p>
      <button type="button" onClick={verifyRecovery} disabled={verifying} className="min-h-12 rounded-xl bg-[#2457ff] font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#9aa7ba]">
        {verifying ? "正在验证…" : "继续重置密码"}
      </button>
    </section>}
    {status ? <p role="status" className="mt-4 text-sm leading-7 text-[#a13926]">{status}</p> : null}
    <a href="/control" className="mt-6 block text-center text-sm text-[#657080]">返回登录</a>
  </main>;
}
