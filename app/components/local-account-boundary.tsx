"use client";

import { useEffect, useState, type ReactNode } from "react";
import { resolveLocalAccount, type LocalAccount } from "../../lib/local-account.ts";

export function LocalAccountBoundary({ children }: { children: (user: LocalAccount) => ReactNode }) {
  const [state, setState] = useState<{ status: "checking" | "ready" | "error"; user: LocalAccount; resolved: boolean }>({ status: "checking", user: null, resolved: false });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    const check = () => {
      const version = ++generation;
      setState((previous) => ({ ...previous, status: "checking" }));
      void resolveLocalAccount().then((user) => {
        if (!disposed && version === generation) setState({ status: "ready", user, resolved: true });
      }).catch(() => {
        if (!disposed && version === generation) setState({ status: "error", user: null, resolved: false });
      });
    };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    check();
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [retry]);
  return <>
    <div style={{ display: state.status === "ready" ? "contents" : "none" }}>
      {state.resolved && children(state.user)}
    </div>
    {state.status !== "ready" && <main className="signal-page mx-auto max-w-[760px] p-8" role="status">
    <p>{state.status === "checking" ? "正在确认账户状态…" : "暂时无法确认账户，未读取本机资料。"}</p>
    {state.status === "error" && <button onClick={() => setRetry((value) => value + 1)}>重新连接</button>}
    </main>}
  </>;
}
